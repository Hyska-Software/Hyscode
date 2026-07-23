// Svelte Support Extension — main.js
// Provides runtime commands for Svelte 5 and SvelteKit development

export function activate(context) {
  console.log('[svelte-support] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[svelte-support] HysCode API not available');
    return;
  }

  if (!api.commands) return;

  // ── Helper: run terminal command ────────────────────────────────────────────
  async function runCmd(cmd) {
    if (api.terminal && api.terminal.sendToActive) {
      await api.terminal.sendToActive(cmd);
    }
  }

  // ── Wrap Selection with {#if} ───────────────────────────────────────────────
  api.commands.register('svelte.wrapWithIf', async () => {
    if (!api.editor) return;
    const selection = api.editor.getSelection?.();
    if (!selection) return;
    const text = selection.text || '';
    const indented = text.split('\n').map(l => '  ' + l).join('\n');
    api.editor.replaceSelection?.(`{#if condition}\n${indented}\n{/if}`);
  });

  // ── Wrap Selection with {#each} ─────────────────────────────────────────────
  api.commands.register('svelte.wrapWithEach', async () => {
    if (!api.editor) return;
    const selection = api.editor.getSelection?.();
    if (!selection) return;
    const text = selection.text || '';
    const indented = text.split('\n').map(l => '  ' + l).join('\n');
    api.editor.replaceSelection?.(`{#each items as item (item.id)}\n${indented}\n{/each}`);
  });

  // ── New Component ───────────────────────────────────────────────────────────
  api.commands.register('svelte.newComponent', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Component name',
      placeHolder: 'MyComponent',
    });
    if (!name) return;

    const content = `<script lang="ts">
  interface Props {
    // props
  }

  let {}: Props = $props();
</script>

<div>
  ${name}
</div>

<style>
</style>
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.svelte`, content);
    }
  });

  // ── New Page (+page.svelte) ─────────────────────────────────────────────────
  api.commands.register('svelte.newPage', async () => {
    const route = await api.window?.showInputBox?.({
      prompt: 'Route path (e.g. about, blog/[slug])',
      placeHolder: 'about',
    });
    if (!route) return;

    const pageContent = `<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>${route}</title>
</svelte:head>

<main>
  <h1>${route}</h1>
</main>
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`src/routes/${route}/+page.svelte`, pageContent);
    }
  });

  // ── New Layout (+layout.svelte) ─────────────────────────────────────────────
  api.commands.register('svelte.newLayout', async () => {
    const route = await api.window?.showInputBox?.({
      prompt: 'Route path for layout (leave empty for root)',
      placeHolder: '',
    });

    const path = route ? `src/routes/${route}` : 'src/routes';
    const content = `<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="layout">
  {@render children()}
</div>
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${path}/+layout.svelte`, content);
    }
  });

  // ── New Server Load (+page.server.ts) ───────────────────────────────────────
  api.commands.register('svelte.newServerLoad', async () => {
    const route = await api.window?.showInputBox?.({
      prompt: 'Route path for server load',
      placeHolder: 'about',
    });
    if (!route) return;

    const content = `import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
  return {
  };
};
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`src/routes/${route}/+page.server.ts`, content);
    }
  });

  // ── New API Route (+server.ts) ──────────────────────────────────────────────
  api.commands.register('svelte.newApiRoute', async () => {
    const route = await api.window?.showInputBox?.({
      prompt: 'API route path (e.g. api/users)',
      placeHolder: 'api/data',
    });
    if (!route) return;

    const content = `import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
  return json({ });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  return json({ }, { status: 201 });
};
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`src/routes/${route}/+server.ts`, content);
    }
  });

  // ── New SvelteKit Project ───────────────────────────────────────────────────
  api.commands.register('svelte.newProject', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Project name',
      placeHolder: 'my-svelte-app',
    });
    if (!name) return;
    await runCmd(`npx sv create ${name}`);
  });

  // ── Dev Server ──────────────────────────────────────────────────────────────
  api.commands.register('svelte.dev', async () => {
    console.log('[svelte-support] Dev server');
    await runCmd('npm run dev');
  });

  // ── Build ───────────────────────────────────────────────────────────────────
  api.commands.register('svelte.build', async () => {
    console.log('[svelte-support] Build');
    await runCmd('npm run build');
  });

  // ── Preview ─────────────────────────────────────────────────────────────────
  api.commands.register('svelte.preview', async () => {
    console.log('[svelte-support] Preview');
    await runCmd('npm run preview');
  });

  // ── Test (Vitest) ───────────────────────────────────────────────────────────
  api.commands.register('svelte.test', async () => {
    console.log('[svelte-support] Test');
    await runCmd('npx vitest');
  });

  // ── Svelte Check ────────────────────────────────────────────────────────────
  api.commands.register('svelte.check', async () => {
    console.log('[svelte-support] Check');
    await runCmd('npx svelte-check');
  });

  // ── Add Package ─────────────────────────────────────────────────────────────
  api.commands.register('svelte.addPackage', async () => {
    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package name',
      placeHolder: '@sveltejs/adapter-auto',
    });
    if (!pkg) return;

    const dev = await api.window?.showQuickPick?.([
      { label: 'Dependency', value: '' },
      { label: 'Dev Dependency', value: '-D' },
    ], { placeHolder: 'Install as...' });

    const flag = dev?.value || '';
    await runCmd(`npm install ${flag} ${pkg}`.trim());
  });

  console.log('[svelte-support] Commands registered');

  // Settings tab
  if (api && api.settings?.updateTabContent) {
    api.settings.updateTabContent('svelte-support.settings', {
      sections: [
        {
          title: 'Components',
          items: [
            { type: 'select', key: 'defaultScriptLang', label: 'Script Language', description: 'Language for the <script> block', defaultValue: 'ts', options: [{ value: 'ts', label: 'TypeScript' }, { value: 'js', label: 'JavaScript' }] },
            { type: 'select', key: 'defaultStyleLang', label: 'Style Language', description: 'Language for the <style> block', defaultValue: 'css', options: [{ value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' }, { value: 'sass', label: 'Sass' }, { value: 'less', label: 'Less' }] },
            { type: 'toggle', key: 'checkOnSave', label: 'Check on Save', description: 'Run svelte-check on file save', defaultValue: false },
          ],
        },
        {
          title: 'Snippets',
          items: [
            { type: 'toggle', key: 'snippets.enabled', label: 'Enable Snippets', description: 'Enable Svelte code snippets', defaultValue: true },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[svelte-support] Extension deactivated');
}
