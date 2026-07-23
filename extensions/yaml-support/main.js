/**
 * yaml-support — Extensão YAML para HysCode
 * Language Server: yaml-language-server (Red Hat)
 * Suporte: YAML 1.1/1.2, schemas JSON Schema Store, Kubernetes, Docker Compose, GitHub Actions
 */

'use strict';

/** @type {import('../extension-api/src').HysCodeAPI | null} */
let api = null;

/** @type {Array<() => void>} */
let disposables = [];

function run(cmd) {
  api.terminal.sendToActive(cmd);
}

function register(id, handler) {
  const d = api.commands.register(id, handler);
  disposables.push(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context) {
  api = context._api || globalThis.hyscode;

  // ── Format ────────────────────────────────────────────────────────────────

  register('yaml.format', () => {
    api.notifications?.info?.('Formatação YAML executada pelo language server');
  });

  // ── Validate ──────────────────────────────────────────────────────────────

  register('yaml.validate', () => {
    api.notifications?.info?.('Validação YAML ativa via yaml-language-server');
  });

  // ── Assign schema ─────────────────────────────────────────────────────────

  register('yaml.assignSchema', async () => {
    const schemas = [
      { label: 'Kubernetes', description: 'kubernetes' },
      { label: 'Docker Compose', description: 'https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json' },
      { label: 'GitHub Actions Workflow', description: 'https://json.schemastore.org/github-workflow.json' },
      { label: 'GitHub Actions Action', description: 'https://json.schemastore.org/github-action.json' },
      { label: 'Ansible Playbook', description: 'https://raw.githubusercontent.com/ansible/ansible-lint/main/src/ansiblelint/schemas/ansible.json' },
      { label: 'Helm Chart.yaml', description: 'https://json.schemastore.org/chart.json' },
      { label: 'OpenAPI 3.0', description: 'https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/schemas/v3.0/schema.json' },
      { label: 'Custom URL...', description: 'custom' },
    ];

    const choice = await api.window.showQuickPick(schemas, {
      placeholder: 'Selecionar schema para o arquivo YAML',
    });
    if (!choice) return;

    let schemaUrl = choice.description;

    if (schemaUrl === 'custom') {
      schemaUrl = await api.window.showInputBox({
        prompt: 'URL ou caminho do schema JSON/YAML',
        placeholder: 'https://json.schemastore.org/...',
      });
      if (!schemaUrl) return;
    }

    const modeline = `# yaml-language-server: $schema=${schemaUrl}`;
    await api.editor?.insertText?.(modeline + '\n');
    api.notifications?.info?.(`Schema associado: ${choice.label}`);
  });

  // ── New YAML file ─────────────────────────────────────────────────────────

  register('yaml.newFile', async () => {
    const templates = [
      { label: 'Blank', description: 'Arquivo YAML vazio' },
      { label: 'Docker Compose', description: 'docker-compose.yml' },
      { label: 'GitHub Actions', description: '.github/workflows/ci.yml' },
      { label: 'Kubernetes Deployment', description: 'deployment.yaml' },
      { label: '.env config', description: 'config.yaml' },
    ];

    const choice = await api.window.showQuickPick(templates, {
      placeholder: 'Tipo de arquivo YAML',
    });
    if (!choice) return;

    const contents = getTemplateContent(choice.label);
    const filename = getTemplateFilename(choice.label);

    await api.workspace.createFile(filename, contents);
    await api.editor?.openFile?.(filename);
  });

  // ── Install server ────────────────────────────────────────────────────────

  register('yaml.installServer', async () => {
    const choice = await api.window.showInformationMessage(
      'Instalar/atualizar yaml-language-server globalmente?',
      'Instalar', 'Cancelar'
    );
    if (choice !== 'Instalar') return;
    run('npm install -g yaml-language-server');
  });

  // ── Convert JSON to YAML ──────────────────────────────────────────────────

  register('yaml.convertJsonToYaml', async () => {
    const sel = api.editor?.getSelection?.();
    if (!sel || !sel.text) {
      api.notifications?.warning?.('Selecione um trecho JSON no editor');
      return;
    }

    try {
      const json = JSON.parse(sel.text);
      const yaml = jsonToYaml(json, 0);
      await api.editor.replaceSelection(yaml);
      api.notifications?.info?.('JSON convertido para YAML');
    } catch {
      api.notifications?.error?.('Texto selecionado não é JSON válido');
    }
  });

  // ── Sort keys ─────────────────────────────────────────────────────────────

  register('yaml.sortKeys', () => {
    api.notifications?.info?.('Ordenação de chaves YAML solicitada — disponível via yaml-language-server com yaml.keyOrdering: true');
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  try {
    const statusBar = api.window.createStatusBarItem({
      id: 'yaml-support.indicator',
      text: '$(symbol-file) YAML',
      tooltip: 'YAML Support — yaml-language-server',
      command: 'yaml.validate',
      alignment: 'right',
      priority: 45,
    });
    disposables.push(statusBar);
  } catch {
    // ignore
  }

  // Settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('yaml-support.settings', {
      sections: [
        {
          title: 'Editor',
          items: [
            { type: 'toggle', key: 'validate', label: 'Validation', description: 'Enable YAML schema validation', defaultValue: true },
            { type: 'toggle', key: 'hover', label: 'Hover Info', description: 'Show info on mouse hover', defaultValue: true },
            { type: 'toggle', key: 'completion', label: 'Auto-complete', description: 'Enable YAML auto-complete', defaultValue: true },
          ],
        },
        {
          title: 'Formatting',
          items: [
            { type: 'toggle', key: 'format.enable', label: 'Enable Formatter', description: 'Enable YAML formatter', defaultValue: true },
            { type: 'toggle', key: 'format.singleQuote', label: 'Single Quotes', description: 'Use single quotes instead of double', defaultValue: false },
            { type: 'toggle', key: 'format.bracketSpacing', label: 'Bracket Spacing', description: 'Spaces inside flow object braces', defaultValue: true },
            { type: 'number', key: 'format.printWidth', label: 'Print Width', description: 'Max line width before wrapping', defaultValue: 120, min: 40, max: 300 },
          ],
        },
        {
          title: 'Schemas',
          items: [
            { type: 'toggle', key: 'schemaStore.enable', label: 'Schema Store', description: 'Auto-download schemas from JSON Schema Store', defaultValue: true },
            { type: 'select', key: 'yamlVersion', label: 'YAML Version', description: 'YAML specification version', defaultValue: '1.2', options: [{ value: '1.1', label: '1.1' }, { value: '1.2', label: '1.2' }] },
            { type: 'toggle', key: 'keyOrdering', label: 'Key Ordering', description: 'Force alphabetical key ordering', defaultValue: false },
          ],
        },
      ],
    });
  }
}
  disposables.forEach(d => {
    if (typeof d === 'function') d();
    else if (d && typeof d.dispose === 'function') d.dispose();
  });
  disposables = [];
  api = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTemplateFilename(label) {
  switch (label) {
    case 'Docker Compose': return 'docker-compose.yml';
    case 'GitHub Actions': return '.github/workflows/ci.yml';
    case 'Kubernetes Deployment': return 'deployment.yaml';
    case '.env config': return 'config.yaml';
    default: return 'untitled.yaml';
  }
}

function getTemplateContent(label) {
  switch (label) {
    case 'Docker Compose':
      return [
        '# yaml-language-server: $schema=https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json',
        '',
        'services:',
        '  app:',
        '    image: node:22-alpine',
        '    ports:',
        '      - "3000:3000"',
        '    volumes:',
        '      - .:/app',
        '',
      ].join('\n');

    case 'GitHub Actions':
      return [
        '# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json',
        '',
        'name: CI',
        '',
        'on:',
        '  push:',
        '    branches: [main]',
        '  pull_request:',
        '    branches: [main]',
        '',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - name: Run tests',
        '        run: echo "Add your test command"',
        '',
      ].join('\n');

    case 'Kubernetes Deployment':
      return [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata:',
        '  name: my-app',
        '  labels:',
        '    app: my-app',
        'spec:',
        '  replicas: 3',
        '  selector:',
        '    matchLabels:',
        '      app: my-app',
        '  template:',
        '    metadata:',
        '      labels:',
        '        app: my-app',
        '    spec:',
        '      containers:',
        '        - name: my-app',
        '          image: nginx:latest',
        '          ports:',
        '            - containerPort: 80',
        '',
      ].join('\n');

    case '.env config':
      return [
        '# Application Configuration',
        '',
        'app:',
        '  name: my-app',
        '  port: 3000',
        '  env: development',
        '',
        'database:',
        '  host: localhost',
        '  port: 5432',
        '  name: mydb',
        '',
      ].join('\n');

    default:
      return '---\n';
  }
}

/**
 * Converte um objeto JSON para string YAML (simplificado).
 * @param {any} obj
 * @param {number} indent
 * @returns {string}
 */
function jsonToYaml(obj, indent) {
  const pad = '  '.repeat(indent);

  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj.toString();
  if (typeof obj === 'number') return obj.toString();
  if (typeof obj === 'string') {
    if (obj.includes('\n')) return `|\n${obj.split('\n').map(l => pad + '  ' + l).join('\n')}`;
    if (/[:#{}[\],&*?|>!%@`]/.test(obj) || obj === '') return `"${obj}"`;
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      const val = jsonToYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null) {
        return `${pad}- ${val.trimStart()}`;
      }
      return `${pad}- ${val}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    return keys.map(key => {
      const val = obj[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        return `${pad}${key}:\n${jsonToYaml(val, indent + 1)}`;
      }
      if (Array.isArray(val)) {
        return `${pad}${key}:\n${jsonToYaml(val, indent + 1)}`;
      }
      return `${pad}${key}: ${jsonToYaml(val, indent)}`;
    }).join('\n');
  }

  return String(obj);
}
