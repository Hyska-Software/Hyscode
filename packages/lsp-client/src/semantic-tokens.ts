// ─── Semantic Tokens ──────────────────────────────────────────────────────────
// VS Code-compatible semantic token legend + decode/remap helpers.
// Used to bridge LSP `textDocument/semanticTokens` responses to Monaco's
// `registerDocumentSemanticTokensProvider` (Uint32Array, 5 ints per token).

export const SEMANTIC_TOKEN_TYPES: string[] = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
  'label',
  'constant',
  'lifetime',
  'annotation',
  'attribute',
  'property.readonly',
];

export const SEMANTIC_TOKEN_MODIFIERS: string[] = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
];

export interface DecodedSemanticToken {
  line: number;
  character: number;
  length: number;
  type: string;
  typeIndex: number;
  modifiers: string[];
  modifierBits: number;
}

/** Aliases from older / server-specific names to our canonical legend. */
const TOKEN_TYPE_ALIASES: Record<string, string> = {
  member: 'property',
  annotation: 'attribute',
  decorator: 'attribute',
  annotationType: 'attribute',
  lifetimeParam: 'lifetime',
  selfType: 'type',
  builtin: 'function',
};

export function resolveCanonicalTokenType(raw: string): string {
  if (SEMANTIC_TOKEN_TYPES.includes(raw)) return raw;
  const alias = TOKEN_TYPE_ALIASES[raw];
  if (alias && SEMANTIC_TOKEN_TYPES.includes(alias)) return alias;
  // Common LSP superset mappings — keep richness, don't collapse to variable
  // unless truly unknown.
  switch (raw) {
    case 'generic':
    case 'typeAlias':
      return 'type';
    case 'namespaceAlias':
      return 'namespace';
    case 'functionCall':
      return 'function';
    case 'methodCall':
      return 'method';
    case 'macroCall':
      return 'macro';
    case 'stringEscape':
      return 'string';
    case 'boolean':
      return 'number';
    default:
      return 'variable';
  }
}

/**
 * Decode LSP relative-encoded `data` (5 ints per token) into absolute positions.
 * Unknown type indices fall back to `variable` so a misbehaving server never
 * breaks highlighting.
 */
export function decodeSemanticTokens(
  data: number[] | Uint32Array,
  legendTypes: string[],
  legendModifiers: string[],
): DecodedSemanticToken[] {
  const out: DecodedSemanticToken[] = [];
  let line = 0;
  let character = 0;
  const arr = Array.from(data);
  for (let i = 0; i + 4 < arr.length; i += 5) {
    const deltaLine = arr[i] ?? 0;
    const deltaChar = arr[i + 1] ?? 0;
    const length = arr[i + 2] ?? 0;
    const typeIdx = arr[i + 3] ?? 0;
    const modBits = arr[i + 4] ?? 0;
    line += deltaLine;
    character = deltaLine === 0 ? character + deltaChar : deltaChar;
    if (length <= 0) continue;
    const rawType = legendTypes[typeIdx] ?? 'variable';
    const type = resolveCanonicalTokenType(rawType);
    const modifiers: string[] = [];
    legendModifiers.forEach((m, bit) => {
      if ((modBits & (1 << bit)) !== 0) modifiers.push(m);
    });
    out.push({
      line,
      character,
      length,
      type,
      typeIndex: typeIdx,
      modifiers,
      modifierBits: modBits,
    });
  }
  return out;
}

/**
 * Remap server-encoded tokens to our canonical legend indices.
 * Returns a Uint32Array ready for Monaco (`deltaLine, deltaChar, length,
 * targetTypeIdx, targetModifierBits`).
 */
export function remapSemanticTokensToLegend(
  data: number[] | Uint32Array,
  serverTypes: string[],
  serverModifiers: string[],
  targetTypes: string[] = SEMANTIC_TOKEN_TYPES,
  targetModifiers: string[] = SEMANTIC_TOKEN_MODIFIERS,
): Uint32Array {
  const decoded = decodeSemanticTokens(data, serverTypes, serverModifiers);
  const out = new Uint32Array(decoded.length * 5);
  let prevLine = 0;
  let prevChar = 0;
  decoded.forEach((t, idx) => {
    const targetTypeIdx = targetTypes.indexOf(t.type);
    const safeTypeIdx = targetTypeIdx >= 0 ? targetTypeIdx : targetTypes.indexOf('variable');
    let targetBits = 0;
    for (const m of t.modifiers) {
      const bit = targetModifiers.indexOf(m);
      if (bit >= 0 && bit < 31) targetBits |= 1 << bit;
    }
    const base = idx * 5;
    out[base] = t.line - prevLine;
    out[base + 1] = t.line === prevLine ? t.character - prevChar : t.character;
    out[base + 2] = t.length;
    out[base + 3] = safeTypeIdx;
    out[base + 4] = targetBits;
    prevLine = t.line;
    prevChar = t.character;
  });
  return out;
}

/** Convert delta edits payloads (number[] per edit) to Monaco's edit shape. */
export function toMonacoSemanticEdits(
  edits: Array<{ start: number; deleteCount: number; data?: number[] }>,
  serverTypes: string[],
  serverModifiers: string[],
  targetTypes: string[] = SEMANTIC_TOKEN_TYPES,
  targetModifiers: string[] = SEMANTIC_TOKEN_MODIFIERS,
): Array<{ start: number; deleteCount: number; data?: Uint32Array }> {
  return edits.map((e) => ({
    start: e.start,
    deleteCount: e.deleteCount,
    data: e.data
      ? remapSemanticTokensToLegend(
          e.data,
          serverTypes,
          serverModifiers,
          targetTypes,
          targetModifiers,
        )
      : undefined,
  }));
}
