import { detectLanguage } from '@hyscode/lsp-client';

/**
 * Returns the Monaco tokenizer language ID used by the right-panel Preview.
 *
 * This intentionally uses detectLanguage instead of detectLspLanguage: Monaco
 * tokenizers use `typescript`/`javascript` for TSX/JSX, while the LSP uses the
 * `typescriptreact`/`javascriptreact` IDs for server protocol messages.
 */
export function detectPreviewLanguage(filePath: string): string {
  return detectLanguage(filePath);
}
