import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@hyscode/extension-host': path.resolve(__dirname, '../../packages/extension-host/src'),
      '@hyscode/extension-api': path.resolve(__dirname, '../../packages/extension-api/src'),
      '@hyscode/lsp-client': path.resolve(__dirname, '../../packages/lsp-client/src'),
      '@hyscode/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@hyscode/ai-providers': path.resolve(__dirname, '../../packages/ai-providers/src'),
      '@hyscode/agent-harness': path.resolve(__dirname, '../../packages/agent-harness/src'),
      '@hyscode/mcp-client': path.resolve(__dirname, '../../packages/mcp-client/src'),
      '@hyscode/skills': path.resolve(__dirname, '../../packages/skills/src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
