// Vue Support Extension — main.js
// Provides runtime commands for Vue 3 development

export function activate(context) {
  console.log('[vue-support] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[vue-support] HysCode API not available');
    return;
  }

  if (!api.commands) return;

  // ── Helper: run terminal command ────────────────────────────────────────────
  async function runCmd(cmd) {
    if (api.terminal && api.terminal.sendToActive) {
      await api.terminal.sendToActive(cmd);
    }
  }

  // ── Wrap Selection with <template> ──────────────────────────────────────────
  api.commands.register('vue.wrapWithTemplate', async () => {
    if (!api.editor) return;
    const selection = api.editor.getSelection?.();
    if (!selection) return;
    const text = selection.text || '';
    const indented = text.split('\n').map(l => '  ' + l).join('\n');
    api.editor.replaceSelection?.(`<template>\n${indented}\n</template>`);
  });

  // ── Wrap Selection with <Transition> ────────────────────────────────────────
  api.commands.register('vue.wrapWithTransition', async () => {
    if (!api.editor) return;
    const selection = api.editor.getSelection?.();
    if (!selection) return;
    const text = selection.text || '';
    const indented = text.split('\n').map(l => '  ' + l).join('\n');
    api.editor.replaceSelection?.(`<Transition name="fade">\n${indented}\n</Transition>`);
  });

  // ── New Component ───────────────────────────────────────────────────────────
  api.commands.register('vue.newComponent', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Component name',
      placeHolder: 'MyComponent',
    });
    if (!name) return;

    const content = `<script setup lang="ts">
</script>

<template>
  <div>
    ${name}
  </div>
</template>

<style scoped>
</style>
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.vue`, content);
    }
  });

  // ── New Composable ──────────────────────────────────────────────────────────
  api.commands.register('vue.newComposable', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Composable name (without "use" prefix)',
      placeHolder: 'Counter',
    });
    if (!name) return;

    const fnName = 'use' + name.charAt(0).toUpperCase() + name.slice(1);
    const content = `import { ref, computed } from 'vue';

export function ${fnName}() {
  // state

  // getters

  // actions

  return {
  };
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`composables/${fnName}.ts`, content);
    }
  });

  // ── New Pinia Store ─────────────────────────────────────────────────────────
  api.commands.register('vue.newStore', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Store name',
      placeHolder: 'counter',
    });
    if (!name) return;

    const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
    const content = `import { ref, computed } from 'vue';
import { defineStore } from 'pinia';

export const use${pascalName}Store = defineStore('${name}', () => {
  // state
  const items = ref<string[]>([]);

  // getters
  const count = computed(() => items.value.length);

  // actions
  function add(item: string) {
    items.value.push(item);
  }

  return { items, count, add };
});
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`stores/${name}.ts`, content);
    }
  });

  // ── New Page ────────────────────────────────────────────────────────────────
  api.commands.register('vue.newPage', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Page name',
      placeHolder: 'AboutView',
    });
    if (!name) return;

    const content = `<script setup lang="ts">
</script>

<template>
  <main>
    <h1>${name}</h1>
  </main>
</template>

<style scoped>
</style>
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`views/${name}.vue`, content);
    }
  });

  // ── New Vue Project ─────────────────────────────────────────────────────────
  api.commands.register('vue.newProject', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Project name',
      placeHolder: 'my-vue-app',
    });
    if (!name) return;
    await runCmd(`npm create vue@latest ${name}`);
  });

  // ── Dev Server ──────────────────────────────────────────────────────────────
  api.commands.register('vue.dev', async () => {
    console.log('[vue-support] Dev server');
    await runCmd('npm run dev');
  });

  // ── Build ───────────────────────────────────────────────────────────────────
  api.commands.register('vue.build', async () => {
    console.log('[vue-support] Build');
    await runCmd('npm run build');
  });

  // ── Preview ─────────────────────────────────────────────────────────────────
  api.commands.register('vue.preview', async () => {
    console.log('[vue-support] Preview');
    await runCmd('npm run preview');
  });

  // ── Test (Vitest) ───────────────────────────────────────────────────────────
  api.commands.register('vue.test', async () => {
    console.log('[vue-support] Test');
    await runCmd('npx vitest');
  });

  // ── Lint ────────────────────────────────────────────────────────────────────
  api.commands.register('vue.lint', async () => {
    console.log('[vue-support] Lint');
    await runCmd('npm run lint');
  });

  // ── Add Package ─────────────────────────────────────────────────────────────
  api.commands.register('vue.addPackage', async () => {
    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package name',
      placeHolder: 'pinia',
    });
    if (!pkg) return;

    const dev = await api.window?.showQuickPick?.([
      { label: 'Dependency', value: '' },
      { label: 'Dev Dependency', value: '-D' },
    ], { placeHolder: 'Install as...' });

    const flag = dev?.value || '';
    await runCmd(`npm install ${flag} ${pkg}`.trim());
  });

  console.log('[vue-support] Commands registered');

  // Settings tab
  if (api && api.settings?.updateTabContent) {
    api.settings.updateTabContent('vue-support.settings', {
      sections: [
        {
          title: 'Single File Components',
          items: [
            { type: 'select', key: 'defaultScriptLang', label: 'Script Language', description: 'Language for the <script> block', defaultValue: 'ts', options: [{ value: 'ts', label: 'TypeScript' }, { value: 'js', label: 'JavaScript' }] },
            { type: 'select', key: 'defaultStyleLang', label: 'Style Language', description: 'Language for the <style> block', defaultValue: 'scss', options: [{ value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' }, { value: 'sass', label: 'Sass' }, { value: 'less', label: 'Less' }] },
            { type: 'toggle', key: 'styleScoped', label: 'Scoped Styles', description: "Add 'scoped' to <style> by default", defaultValue: true },
          ],
        },
        {
          title: 'Snippets',
          items: [
            { type: 'toggle', key: 'snippets.enabled', label: 'Enable Snippets', description: 'Enable Vue code snippets', defaultValue: true },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[vue-support] Extension deactivated');
}
