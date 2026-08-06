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
});
