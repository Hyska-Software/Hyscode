import { describe, expect, it } from 'vitest';
import { parseKeys } from './input';

describe('TUI terminal input decoder', () => {
  it('decodes navigation, control keys, unicode, and bracketed paste', () => {
    expect(parseKeys('\u001b[A\u001b[3~\u0003\u0001\u0005Olá')).toEqual([
      { type: 'up' },
      { type: 'delete' },
      { type: 'ctrl', value: 'c' },
      { type: 'home' },
      { type: 'end' },
      { type: 'character', value: 'O' },
      { type: 'character', value: 'l' },
      { type: 'character', value: 'á' },
    ]);
    expect(parseKeys('\u001b[200~linha 1\nlinha 2\u001b[201~')).toEqual([{ type: 'character', value: 'linha 1\nlinha 2' }]);
    expect(parseKeys('\u001b[27;2;13~')).toEqual([{ type: 'shift_enter' }]);
    expect(parseKeys('\u001b[Z\u0014')).toEqual([{ type: 'shift_tab' }, { type: 'ctrl', value: 't' }]);
  });

  it('decodes SGR and legacy mouse wheel events without leaking escape bytes into chat', () => {
    expect(parseKeys('\u001b[<64;12;8M\u001b[<65;12;8M')).toEqual([
      { type: 'mouse', action: 'scroll_up', x: 12, y: 8 },
      { type: 'mouse', action: 'scroll_down', x: 12, y: 8 },
    ]);

    const legacyWheelUp = `\u001b[M${String.fromCharCode(32 + 64, 32 + 4, 32 + 5)}`;
    expect(parseKeys(legacyWheelUp)).toEqual([{ type: 'mouse', action: 'scroll_up', x: 4, y: 5 }]);
    expect(parseKeys('\u001bOB')).toEqual([{ type: 'down' }]);
  });
});
