// Vitest resolution aid for @hyscode/* workspace packages.
// Windows sandboxes that cannot traverse NTFS junction symlinks fail Vite
// module resolution inside workspaces; these aliases point at the real
// source trees instead of node_modules links. Harmless where links resolve
// normally (aliases reference the same files).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sibling = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hyscode/agent-harness': sibling('agent-harness'),
      '@hyscode/ai-providers': sibling('ai-providers'),
      '@hyscode/mcp-client': sibling('mcp-client'),
      '@hyscode/theme': sibling('theme'),
      '@hyscode/skills': sibling('skills'),
    },
  },
  test: {
    exclude: ['**/.kilo/**', '**/.hyscode/**', '**/node_modules/**', '**/dist/**'],
  },
});
