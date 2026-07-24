import { useSettingsStore } from '../../../stores';
import type {
  WordWrap,
  LineNumbers,
  CursorStyle,
  RenderWhitespace,
  AutoSave,
  AutoClosingBrackets,
  AutoClosingQuotes,
} from '../../../stores/settings-store';
import { SettingRow, SettingSection, SettingSelect, SettingSlider, SettingTextInput, SettingToggle } from '../controls';

export function EditorTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      {/* Font */}
      <SettingSection title="Font">
        <SettingRow label="Font Family">
          <SettingTextInput
            value={store.fontFamily}
            onChange={(v) => store.set('fontFamily', v)}
            placeholder="Geist Mono"
          />
        </SettingRow>
        <SettingRow label="Font Size">
          <SettingSlider
            value={store.fontSize}
            onChange={(v) => store.set('fontSize', v)}
            min={8}
            max={32}
          />
        </SettingRow>
        <SettingRow label="Line Height">
          <SettingSlider
            value={store.lineHeight}
            onChange={(v) => store.set('lineHeight', v)}
            min={1}
            max={3}
            step={0.1}
          />
        </SettingRow>
      </SettingSection>

      {/* Editing */}
      <SettingSection title="Editing">
        <SettingRow label="Tab Size">
          <SettingSlider
            value={store.tabSize}
            onChange={(v) => store.set('tabSize', v)}
            min={1}
            max={8}
          />
        </SettingRow>
        <SettingRow label="Insert Spaces">
          <SettingToggle
            checked={store.insertSpaces}
            onChange={(v) => store.set('insertSpaces', v)}
          />
        </SettingRow>
        <SettingRow label="Word Wrap">
          <SettingSelect<WordWrap>
            value={store.wordWrap}
            onChange={(v) => store.set('wordWrap', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
              { value: 'wordWrapColumn', label: 'Word Wrap Column' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Cursor Style">
          <SettingSelect<CursorStyle>
            value={store.cursorStyle}
            onChange={(v) => store.set('cursorStyle', v)}
            options={[
              { value: 'line', label: 'Line' },
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Render Whitespace">
          <SettingSelect<RenderWhitespace>
            value={store.renderWhitespace}
            onChange={(v) => store.set('renderWhitespace', v)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'boundary', label: 'Boundary' },
              { value: 'all', label: 'All' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Auto Save">
          <SettingSelect<AutoSave>
            value={store.autoSave}
            onChange={(v) => store.set('autoSave', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'afterDelay', label: 'After Delay' },
              { value: 'onFocusChange', label: 'On Focus Change' },
            ]}
          />
        </SettingRow>
        {store.autoSave === 'afterDelay' && (
          <SettingRow label="Auto Save Delay (ms)">
            <SettingSlider
              value={store.autoSaveDelay}
              onChange={(v) => store.set('autoSaveDelay', v)}
              min={100}
              max={10000}
              step={100}
            />
          </SettingRow>
        )}
      </SettingSection>

      {/* Display */}
      <SettingSection title="Display">
        <SettingRow label="Line Numbers">
          <SettingSelect<LineNumbers>
            value={store.lineNumbers}
            onChange={(v) => store.set('lineNumbers', v)}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
              { value: 'relative', label: 'Relative' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Minimap">
          <SettingToggle
            checked={store.minimap}
            onChange={(v) => store.set('minimap', v)}
          />
        </SettingRow>
        <SettingRow label="Bracket Pair Colorization">
          <SettingToggle
            checked={store.bracketPairColorization}
            onChange={(v) => store.set('bracketPairColorization', v)}
          />
        </SettingRow>
        <SettingRow label="Scroll Beyond Last Line">
          <SettingToggle
            checked={store.scrollBeyondLastLine}
            onChange={(v) => store.set('scrollBeyondLastLine', v)}
          />
        </SettingRow>
        <SettingRow label="Smooth Scrolling">
          <SettingToggle
            checked={store.smoothScrolling}
            onChange={(v) => store.set('smoothScrolling', v)}
          />
        </SettingRow>
        <SettingRow label="Git Blame Inline">
          <SettingToggle
            checked={store.gitBlameInline}
            onChange={(v) => store.set('gitBlameInline', v)}
          />
        </SettingRow>
      </SettingSection>

      {/* Advanced */}
      <SettingSection title="Advanced">
        <SettingRow label="Auto Close Brackets">
          <SettingSelect<AutoClosingBrackets>
            value={store.autoClosingBrackets}
            onChange={(v) => store.set('autoClosingBrackets', v)}
            options={[
              { value: 'languageDefined', label: 'Language Default' },
              { value: 'always', label: 'Always' },
              { value: 'beforeWhitespace', label: 'Before Whitespace' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Auto Close Quotes">
          <SettingSelect<AutoClosingQuotes>
            value={store.autoClosingQuotes}
            onChange={(v) => store.set('autoClosingQuotes', v)}
            options={[
              { value: 'languageDefined', label: 'Language Default' },
              { value: 'always', label: 'Always' },
              { value: 'beforeWhitespace', label: 'Before Whitespace' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Format on Paste">
          <SettingToggle
            checked={store.formatOnPaste}
            onChange={(v) => store.set('formatOnPaste', v)}
          />
        </SettingRow>
        <SettingRow label="Format on Type">
          <SettingToggle
            checked={store.formatOnType}
            onChange={(v) => store.set('formatOnType', v)}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
