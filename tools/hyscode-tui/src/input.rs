use std::io;
use std::time::Duration;

use crossterm::event::KeyEvent;

#[cfg(not(windows))]
use crossterm::event::Event;

pub enum InputEvent {
    Key(KeyEvent),
    #[cfg_attr(windows, allow(dead_code))]
    Paste(String),
}

pub fn poll(timeout: Duration) -> io::Result<Option<InputEvent>> {
    #[cfg(windows)]
    {
        windows::poll(timeout)
    }

    #[cfg(not(windows))]
    {
        if crossterm::event::poll(timeout)? {
            return Ok(match crossterm::event::read()? {
                Event::Key(key) => Some(InputEvent::Key(key)),
                Event::Paste(text) => Some(InputEvent::Paste(text)),
                _ => None,
            });
        }
        Ok(None)
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
    use crossterm_winapi::{Console, ControlKeyState, Handle, InputRecord};
    use winapi::um::winuser::{
        GetForegroundWindow, GetKeyboardLayout, GetWindowThreadProcessId, MapVirtualKeyExW,
        ToUnicodeEx,
    };

    use super::InputEvent;

    const LEFT_ALT_PRESSED: u32 = 0x0002;
    const LEFT_CTRL_PRESSED: u32 = 0x0008;
    const RIGHT_ALT_PRESSED: u32 = 0x0001;
    const RIGHT_CTRL_PRESSED: u32 = 0x0004;
    const SHIFT_PRESSED: u32 = 0x0010;
    const CAPSLOCK_ON: u32 = 0x0080;

    const VK_ABNT_C1: u16 = 0xC1;
    const VK_BACK: u16 = 0x08;
    const VK_CONTROL: u16 = 0x11;
    const VK_DELETE: u16 = 0x2E;
    const VK_DOWN: u16 = 0x28;
    const VK_END: u16 = 0x23;
    const VK_ESCAPE: u16 = 0x1B;
    const VK_F1: u16 = 0x70;
    const VK_F24: u16 = 0x87;
    const VK_HOME: u16 = 0x24;
    const VK_INSERT: u16 = 0x2D;
    const VK_LEFT: u16 = 0x25;
    const VK_MENU: u16 = 0x12;
    const VK_NEXT: u16 = 0x22;
    const VK_PRIOR: u16 = 0x21;
    const VK_RETURN: u16 = 0x0D;
    const VK_RIGHT: u16 = 0x27;
    const VK_SHIFT: u16 = 0x10;
    const VK_TAB: u16 = 0x09;
    const VK_UP: u16 = 0x26;

    pub fn poll(timeout: Duration) -> io::Result<Option<InputEvent>> {
        let console = Console::from(Handle::current_in_handle()?);
        let deadline = Instant::now() + timeout;

        loop {
            if console.number_of_console_input_events()? > 0 {
                if let Some(event) = decode_record(console.read_single_input_event()?) {
                    return Ok(Some(event));
                }
                continue;
            }

            if Instant::now() >= deadline {
                return Ok(None);
            }

            let remaining = deadline.saturating_duration_since(Instant::now());
            sleep(remaining.min(Duration::from_millis(5)));
        }
    }

    fn decode_record(record: InputRecord) -> Option<InputEvent> {
        match record {
            InputRecord::KeyEvent(record) => decode_key_event(&record).map(InputEvent::Key),
            _ => None,
        }
    }

    fn decode_key_event(record: &crossterm_winapi::KeyEventRecord) -> Option<KeyEvent> {
        let modifiers = modifiers_from_state(&record.control_key_state);
        let code = match record.virtual_key_code {
            VK_SHIFT | VK_CONTROL | VK_MENU => return None,
            VK_BACK => KeyCode::Backspace,
            VK_ESCAPE => KeyCode::Esc,
            VK_RETURN => KeyCode::Enter,
            VK_F1..=VK_F24 => KeyCode::F((record.virtual_key_code - VK_F1 + 1) as u8),
            VK_LEFT => KeyCode::Left,
            VK_UP => KeyCode::Up,
            VK_RIGHT => KeyCode::Right,
            VK_DOWN => KeyCode::Down,
            VK_PRIOR => KeyCode::PageUp,
            VK_NEXT => KeyCode::PageDown,
            VK_HOME => KeyCode::Home,
            VK_END => KeyCode::End,
            VK_DELETE => KeyCode::Delete,
            VK_INSERT => KeyCode::Insert,
            VK_TAB if modifiers.contains(KeyModifiers::SHIFT) => KeyCode::BackTab,
            VK_TAB => KeyCode::Tab,
            _ => KeyCode::Char(decode_character(record, modifiers)?),
        };
        let kind = if record.key_down {
            KeyEventKind::Press
        } else {
            KeyEventKind::Release
        };
        Some(KeyEvent::new_with_kind(code, modifiers, kind))
    }

    fn modifiers_from_state(state: &ControlKeyState) -> KeyModifiers {
        let mut modifiers = KeyModifiers::empty();
        if state.has_state(SHIFT_PRESSED) {
            modifiers |= KeyModifiers::SHIFT;
        }
        if state.has_state(LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED) {
            modifiers |= KeyModifiers::ALT;
        }
        if state.has_state(LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED) {
            modifiers |= KeyModifiers::CONTROL;
        }
        modifiers
    }

    fn decode_character(
        record: &crossterm_winapi::KeyEventRecord,
        modifiers: KeyModifiers,
    ) -> Option<char> {
        decode_character_fields(record.virtual_key_code, record.u_char, modifiers)
            .or_else(|| native_character(record, modifiers))
    }

    fn decode_character_fields(
        virtual_key_code: u16,
        unicode_character: u16,
        modifiers: KeyModifiers,
    ) -> Option<char> {
        // VK_ABNT_C1 is the physical slash key on Brazilian ABNT/ABNT2 keyboards. Windows can
        // deliver this record with an empty UnicodeChar, which Crossterm 0.28 drops after its
        // foreground-layout lookup. Preserve the physical key before any layout conversion.
        if virtual_key_code == VK_ABNT_C1 {
            return Some(if modifiers.contains(KeyModifiers::SHIFT) {
                '?'
            } else {
                '/'
            });
        }

        if unicode_character > 0x1F {
            return char::from_u32(unicode_character as u32);
        }

        // Windows reports Ctrl-letter combinations as control characters. Keep the original
        // letter so the TUI's Ctrl-C/Ctrl-U/Ctrl-W shortcuts continue to work.
        if modifiers.contains(KeyModifiers::CONTROL) && (0x41..=0x5A).contains(&virtual_key_code) {
            return char::from_u32(virtual_key_code as u32 + 0x20);
        }

        None
    }

    fn native_character(
        record: &crossterm_winapi::KeyEventRecord,
        modifiers: KeyModifiers,
    ) -> Option<char> {
        let keyboard_layout = unsafe {
            let current_thread_layout = GetKeyboardLayout(0);
            if !current_thread_layout.is_null() {
                current_thread_layout
            } else {
                let foreground_window = GetForegroundWindow();
                let foreground_thread =
                    GetWindowThreadProcessId(foreground_window, std::ptr::null_mut());
                GetKeyboardLayout(foreground_thread)
            }
        };
        let scan_code = if record.virtual_scan_code != 0 {
            record.virtual_scan_code as u32
        } else {
            unsafe { MapVirtualKeyExW(record.virtual_key_code as u32, 0, keyboard_layout) }
        };
        if scan_code == 0 {
            return None;
        }

        let mut key_state = [0u8; 256];
        if modifiers.contains(KeyModifiers::SHIFT) {
            key_state[VK_SHIFT as usize] = 0x80;
        }
        if modifiers.contains(KeyModifiers::CONTROL) {
            key_state[VK_CONTROL as usize] = 0x80;
        }
        if modifiers.contains(KeyModifiers::ALT) {
            key_state[VK_MENU as usize] = 0x80;
        }
        if record.control_key_state.has_state(CAPSLOCK_ON) {
            key_state[0x14] = 0x01;
        }

        let mut buffer = [0u16; 8];
        let result = unsafe {
            ToUnicodeEx(
                record.virtual_key_code as u32,
                scan_code,
                key_state.as_ptr(),
                buffer.as_mut_ptr(),
                buffer.len() as i32,
                0x4,
                keyboard_layout,
            )
        };
        if result < 1 {
            return None;
        }

        let mut characters = char::decode_utf16(buffer.into_iter().take(result as usize));
        let character = characters.next()?.ok()?;
        if characters.next().is_some() {
            return None;
        }
        Some(character)
    }

    #[cfg(test)]
    mod tests {
        use crossterm::event::KeyModifiers;

        use super::{decode_character_fields, VK_ABNT_C1};

        #[test]
        fn maps_the_brazilian_physical_slash_key_without_unicode_payload() {
            assert_eq!(
                decode_character_fields(VK_ABNT_C1, 0, KeyModifiers::NONE),
                Some('/')
            );
        }

        #[test]
        fn maps_shifted_brazilian_slash_to_question_mark() {
            assert_eq!(
                decode_character_fields(VK_ABNT_C1, 0, KeyModifiers::SHIFT),
                Some('?')
            );
        }

        #[test]
        fn preserves_control_letters_for_shortcuts() {
            assert_eq!(
                decode_character_fields(0x43, 0x03, KeyModifiers::CONTROL),
                Some('c')
            );
        }
    }
}
