// request-forge — main.js
// HTTP client for HysCode: parse .http files, send requests, view responses

'use strict';

/** @type {import('../../packages/extension-api/src').HyscodeAPI | null} */
let h = null;

/** @type {Array<RequestHistoryItem>} */
let history = [];

/** @type {ResponseData|null} */
let lastResponse = null;

/** @type {Record<string, Record<string, string>>} */
let environments = {};
let activeEnv = '';
let searchQuery = '';
let isSending = false;

/**
 * @typedef {{ method: string, url: string, headers: Record<string,string>, body: string, name?: string }} ParsedRequest
 * @typedef {{ status: number, statusText: string, headers: Record<string,string>, body: string, duration: number, url: string, method: string, timestamp: Date }} ResponseData
 * @typedef {{ request: ParsedRequest, response: ResponseData|null, error: string|null, timestamp: Date }} RequestHistoryItem
 */

// ── HTTP methods meta ─────────────────────────────────────────────────────────
const METHOD_COLORS = {
  GET:    '#4ade80',
  POST:   '#60a5fa',
  PUT:    '#facc15',
  PATCH:  '#fb923c',
  DELETE: '#f87171',
  HEAD:   '#a78bfa',
  OPTIONS:'#94a3b8',
};

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context, api) {
  h = api || context._api || globalThis.hyscode;
  if (!h) { console.warn('[request-forge] HysCode API unavailable'); return; }

  console.log('[request-forge] activated');

  activeEnv = (await h.settings.get('requestForge.defaultEnvironment', '')) ?? '';
  await loadEnvironments();

  // ── Commands ──────────────────────────────────────────────────────────────

  h.commands.register('requestForge.sendRequest', async () => {
    if (isSending) {
      h.window.showWarningMessage('Request Forge: já existe uma requisição em andamento.');
      return;
    }

    const filePath = h.editor.activeFilePath;
    if (!filePath) {
      h.window.showWarningMessage('Request Forge: nenhum arquivo .http/.rest ativo.');
      return;
    }

    if (!isRequestFile(filePath)) {
      h.window.showWarningMessage('Request Forge: abra um arquivo .http ou .rest para enviar requisições.');
      return;
    }

    let source;
    try {
      source = await h.workspace.readFile(filePath);
    } catch (err) {
      h.window.showErrorMessage(`Request Forge: erro ao ler arquivo — ${err.message}`);
      return;
    }

    const requests = parseHttpFile(source, getEnvVars());
    if (requests.length === 0) {
      h.window.showWarningMessage('Request Forge: nenhuma requisição encontrada no arquivo.');
      return;
    }

    let req = requests[0];

    // If multiple requests, ask user to choose
    if (requests.length > 1) {
      const choice = await h.window.showQuickPick(
        requests.map((r, i) => ({
          label: `${r.method} ${r.url}`,
          description: r.name || `Requisição #${i + 1}`,
        })),
        { placeholder: 'Selecionar requisição para enviar' }
      );
      if (!choice) return;
      req = requests.find(r => `${r.method} ${r.url}` === choice.label) || req;
    }

    await sendRequest(req);
  });

  h.commands.register('requestForge.newRequestFile', async () => {
    const rootPath = h.workspace.rootPath || '.';
    const name = await h.window.showInputBox({
      prompt: 'Nome do arquivo de requisição (sem extensão)',
      placeholder: 'api-requests',
    });
    if (!name) return;

    const filePath = `${rootPath}/${name}.http`;
    const template = buildRequestTemplate();

    try {
      await h.workspace.writeFile(filePath, template);
      await h.editor.openFile(filePath);
      h.notifications.showInfo(`Request Forge: arquivo criado — ${name}.http`);
    } catch (err) {
      h.window.showErrorMessage(`Request Forge: erro ao criar arquivo — ${err.message}`);
    }
  });

  h.commands.register('requestForge.manageEnvs', async () => {
    const envNames = Object.keys(environments);
    const choice = await h.window.showQuickPick(
      [
        { label: '$(add) Novo ambiente', description: 'Criar ambiente' },
        ...envNames.map(n => ({ label: n, description: n === activeEnv ? 'ativo' : '' })),
      ],
      { placeholder: 'Gerenciar ambientes' }
    );

    if (!choice) return;

    if (choice.label.includes('Novo ambiente')) {
      const envName = await h.window.showInputBox({ prompt: 'Nome do novo ambiente', placeholder: 'production' });
      if (!envName) return;
      environments[envName] = { BASE_URL: 'https://api.example.com' };
      await saveEnvironments();
      h.notifications.showInfo(`Ambiente "${envName}" criado.`);
    } else {
      activeEnv = choice.label;
      await h.settings.set('requestForge.defaultEnvironment', activeEnv);
      h.notifications.showInfo(`Ambiente ativo: ${activeEnv}`);
    }
    await refreshPanel();
  });

  h.commands.register('requestForge.switchEnv', async () => {
    const envNames = Object.keys(environments);
    if (envNames.length === 0) {
      h.window.showInformationMessage('Request Forge: nenhum ambiente configurado. Use "Manage Environments".');
      return;
    }
    const choice = await h.window.showQuickPick(
      [{ label: '(nenhum)', description: 'Sem variáveis de ambiente' }, ...envNames.map(n => ({ label: n }))],
      { placeholder: 'Selecionar ambiente ativo' }
    );
    if (choice) {
      activeEnv = choice.label === '(nenhum)' ? '' : choice.label;
      await h.settings.set('requestForge.defaultEnvironment', activeEnv);
      h.notifications.showInfo(`Ambiente: ${activeEnv || '(nenhum)'}`);
      await refreshPanel();
    }
  });

  h.commands.register('requestForge.clearHistory', async () => {
    history = [];
    lastResponse = null;
    await refreshPanel();
    h.notifications.showInfo('Request Forge: histórico limpo.');
  });

  h.commands.register('requestForge.copyResponse', async () => {
    if (!lastResponse) {
      h.window.showWarningMessage('Request Forge: nenhuma resposta para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(lastResponse.body);
      h.notifications.showInfo('Body da resposta copiado.');
    } catch {
      h.window.showInformationMessage(lastResponse.body.substring(0, 200));
    }
  });

  h.commands.register('requestForge.saveResponse', async () => {
    if (!lastResponse) {
      h.window.showWarningMessage('Request Forge: nenhuma resposta para salvar.');
      return;
    }
    const rootPath = h.workspace.rootPath || '.';
    const ext = detectResponseExtension(lastResponse);
    const fileName = `response-${Date.now()}.${ext}`;
    const filePath = `${rootPath}/${fileName}`;
    try {
      await h.workspace.writeFile(filePath, lastResponse.body);
      await h.editor.openFile(filePath);
      h.notifications.showInfo(`Resposta salva: ${fileName}`);
    } catch (err) {
      h.window.showErrorMessage(`Erro ao salvar resposta: ${err.message}`);
    }
  });

  h.commands.register('requestForge.cancelRequest', () => {
    if (!isSending) {
      h.window.showInformationMessage('Request Forge: nenhuma requisição em andamento.');
      return;
    }
    isSending = false;
    h.notifications.showWarning('Request Forge: requisição cancelada.');
    refreshPanel();
  });

  // ── Open history item ─────────────────────────────────────────────────────

  h.commands.register('requestForge.openHistoryItem', async (idx) => {
    const item = history[Number(idx)];
    if (!item) return;
    if (item.response) {
      lastResponse = item.response;
      await refreshPanel();
    }
  });

  // ── Views ─────────────────────────────────────────────────────────────────

  h.views.onDidChangeSearch('requestForge.panel', (query) => {
    searchQuery = query.toLowerCase();
    refreshPanel();
  });

  h.views.onDidChangeVisibility('requestForge.panel', (visible) => {
    if (visible) refreshPanel();
  });

  // ── Settings tab ──────────────────────────────────────────────────────────

  h.settings.onTabVisible('request-forge.settings', () => registerSettingsTab());
  registerSettingsTab();

  // ── Initial render ────────────────────────────────────────────────────────

  await refreshPanel();

  console.log('[request-forge] commands registered');
}

// ── HTTP file parser ──────────────────────────────────────────────────────────

/**
 * Parses a .http/.rest file into an array of ParsedRequest objects.
 *
 * Format:
 *   ### Optional request name
 *   METHOD URL HTTP/1.1
 *   Header-Name: value
 *
 *   Body (optional)
 *
 *   ### Next request
 *   ...
 */
function parseHttpFile(source, envVars = {}) {
  const requests = [];
  // Split by ### separator
  const blocks = source.split(/^###[^\n]*$/m);

  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (lines.length === 0) continue;

    // First non-empty, non-comment line: METHOD URL [HTTP/version]
    const firstLine = lines[0];
    const methodMatch = firstLine.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s+(\S+)/i);
    if (!methodMatch) continue;

    const method = methodMatch[1].toUpperCase();
    const url = resolveEnvVars(methodMatch[2], envVars);

    const headers = {};
    let bodyStart = -1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') {
        bodyStart = i + 1;
        break;
      }
      const headerMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (headerMatch) {
        headers[headerMatch[1].trim()] = resolveEnvVars(headerMatch[2].trim(), envVars);
      }
    }

    const body = bodyStart >= 0
      ? resolveEnvVars(lines.slice(bodyStart).join('\n').trim(), envVars)
      : '';

    requests.push({ method, url, headers, body });
  }

  return requests;
}

function resolveEnvVars(text, envVars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);
}

// ── HTTP request sender ───────────────────────────────────────────────────────

async function sendRequest(req) {
  isSending = true;
  lastResponse = null;

  // Show sending state
  h.views.setViewBadge('requestForge.panel', { count: 1, tooltip: 'Enviando...' });
  await renderSendingView(req);

  const timeout = (await h.settings.get('requestForge.timeout', 30000)) ?? 30000;
  const start = Date.now();

  let controller;
  let timeoutId;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions = {
      method: req.method,
      headers: req.headers,
      signal: controller.signal,
    };

    if (req.body && !['GET', 'HEAD'].includes(req.method)) {
      fetchOptions.body = req.body;
    }

    const res = await fetch(req.url, fetchOptions);
    const duration = Date.now() - start;

    const responseHeaders = {};
    res.headers.forEach((val, key) => { responseHeaders[key] = val; });

    const bodyText = await res.text();
    const prettify = (await h.settings.get('requestForge.prettifyResponse', true)) ?? true;
    const body = prettify ? prettyBody(bodyText, responseHeaders['content-type'] || '') : bodyText;

    lastResponse = {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body,
      duration,
      url: req.url,
      method: req.method,
      timestamp: new Date(),
    };

    history.unshift({ request: req, response: lastResponse, error: null, timestamp: new Date() });
    await trimHistory();

    h.notifications.showInfo(`Request Forge: ${res.status} ${res.statusText} — ${duration}ms`);

  } catch (err) {
    const duration = Date.now() - start;
    const errorMsg = err.name === 'AbortError' ? 'Tempo limite excedido' : String(err.message || err);

    lastResponse = null;
    history.unshift({ request: req, response: null, error: errorMsg, timestamp: new Date() });
    await trimHistory();

    h.window.showErrorMessage(`Request Forge: ${errorMsg}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    isSending = false;
    h.views.setViewBadge('requestForge.panel', null);
    await refreshPanel();
  }
}

// ── Panel rendering ───────────────────────────────────────────────────────────

async function renderSendingView(req) {
  if (!h?.views) return;
  h.views.updateView('requestForge.panel', {
    type: 'sections',
    sections: [
      {
        id: 'sending',
        title: 'Enviando...',
        type: 'progress',
        progress: { label: `${req.method} ${req.url}` },
      },
    ],
  });
}

async function refreshPanel() {
  if (!h?.views) return;

  const sections = [];
  const envNames = Object.keys(environments);
  const envVars = getEnvVars();
  const envVarCount = Object.keys(envVars).length;

  // Stats section
  sections.push({
    id: 'stats',
    title: 'Status',
    type: 'stats',
    stats: [
      { label: 'Ambiente', value: activeEnv || '(nenhum)',    icon: '$(settings-gear)', color: '#a78bfa' },
      { label: 'Variáveis', value: envVarCount,               icon: '$(symbol-variable)', color: '#60a5fa' },
      { label: 'Histórico', value: history.length,            icon: '$(history)', color: '#facc15' },
      { label: 'Status', value: isSending ? 'Enviando' : 'Pronto', icon: '$(globe)', color: isSending ? '#fb923c' : '#4ade80' },
    ],
  });

  // Actions
  sections.push({
    id: 'actions',
    title: 'Ações',
    type: 'actions',
    actions: [
      { id: 'send',    label: 'Enviar',       icon: '$(play)',          command: 'requestForge.sendRequest' },
      { id: 'new',     label: 'Novo arquivo', icon: '$(new-file)',      command: 'requestForge.newRequestFile' },
      { id: 'env',     label: 'Ambientes',    icon: '$(settings-gear)', command: 'requestForge.manageEnvs' },
      { id: 'clear',   label: 'Limpar',       icon: '$(trash)',         command: 'requestForge.clearHistory' },
    ],
  });

  // Last response
  if (lastResponse) {
    const statusColor = lastResponse.status < 300 ? '#4ade80' : lastResponse.status < 400 ? '#facc15' : '#f87171';
    sections.push({
      id: 'response',
      title: `Resposta — ${lastResponse.status} ${lastResponse.statusText}`,
      badge: String(lastResponse.status),
      badgeColor: statusColor,
      type: 'list',
      collapsible: true,
      collapsed: false,
      items: [
        {
          id: 'res-meta',
          label: `${lastResponse.method} ${lastResponse.url}`,
          description: `${lastResponse.status} · ${lastResponse.duration}ms`,
          icon: '$(globe)',
          iconColor: METHOD_COLORS[lastResponse.method] || '#94a3b8',
        },
        {
          id: 'res-headers',
          label: 'Headers',
          description: `${Object.keys(lastResponse.headers).length} header(s)`,
          icon: '$(list-flat)',
          children: Object.entries(lastResponse.headers).slice(0, 10).map(([k, v]) => ({
            id: `hdr-${k}`,
            label: k,
            description: v,
            icon: '$(symbol-property)',
          })),
        },
        {
          id: 'res-body',
          label: 'Body',
          description: `${lastResponse.body.length} chars`,
          icon: '$(file-code)',
          tooltip: lastResponse.body.substring(0, 500),
          command: 'requestForge.copyResponse',
        },
      ],
    });
  }

  // History
  const filteredHistory = history.filter((item, i) => {
    if (!searchQuery) return true;
    return `${item.request.method} ${item.request.url}`.toLowerCase().includes(searchQuery);
  });

  if (filteredHistory.length > 0) {
    sections.push({
      id: 'history',
      title: `Histórico (${filteredHistory.length})`,
      type: 'list',
      collapsible: true,
      collapsed: lastResponse !== null,
      items: filteredHistory.slice(0, 20).map((item, i) => {
        const status = item.response?.status;
        const color  = item.error ? '#f87171' : status < 300 ? '#4ade80' : status < 400 ? '#facc15' : '#f87171';
        return {
          id: `hist-${i}`,
          label: `${item.request.method} ${item.request.url}`,
          description: item.error
            ? item.error
            : `${status} · ${item.response?.duration}ms`,
          icon: item.error ? '$(error)' : '$(check)',
          iconColor: color,
          tooltip: `${item.request.method} ${item.request.url}\n${item.timestamp.toLocaleTimeString()}`,
          command: 'requestForge.openHistoryItem',
          commandArgs: [i],
        };
      }),
    });
  }

  h.views.updateView('requestForge.panel', {
    type: 'sections',
    searchable: true,
    searchPlaceholder: 'Filtrar histórico...',
    toolbar: [
      { id: 'send',    label: 'Enviar',    icon: '$(play)',          tooltip: 'Enviar Requisição', command: 'requestForge.sendRequest' },
      { id: 'new',     label: 'Novo',      icon: '$(new-file)',      tooltip: 'Novo arquivo .http', command: 'requestForge.newRequestFile' },
      { id: 'env',     label: 'Ambiente',  icon: '$(settings-gear)', tooltip: 'Trocar ambiente',   command: 'requestForge.switchEnv' },
    ],
    sections,
    footer: { text: activeEnv ? `🌍 ${activeEnv}` : 'Request Forge', command: 'requestForge.switchEnv' },
  });
}

// ── Environment management ────────────────────────────────────────────────────

function getEnvVars() {
  return environments[activeEnv] || {};
}

async function loadEnvironments() {
  try {
    const rootPath = h.workspace.rootPath;
    if (!rootPath) return;
    const envFile = `${rootPath}/.request-forge-envs.json`;
    const raw = await h.workspace.readFile(envFile);
    environments = JSON.parse(raw);
  } catch {
    environments = {};
  }
}

async function saveEnvironments() {
  try {
    const rootPath = h.workspace.rootPath;
    if (!rootPath) return;
    const envFile = `${rootPath}/.request-forge-envs.json`;
    await h.workspace.writeFile(envFile, JSON.stringify(environments, null, 2));
  } catch (err) {
    console.warn('[request-forge] Could not save environments:', err);
  }
}

async function trimHistory() {
  const max = (await h.settings.get('requestForge.maxHistoryItems', 100)) ?? 100;
  if (history.length > max) history.splice(max);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRequestFile(filePath) {
  return /\.(http|rest)$/i.test(filePath);
}

function prettyBody(body, contentType) {
  if (contentType.includes('json')) {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { /* ignore */ }
  }
  return body;
}

function detectResponseExtension(response) {
  const ct = response.headers['content-type'] || '';
  if (ct.includes('json'))  return 'json';
  if (ct.includes('xml'))   return 'xml';
  if (ct.includes('html'))  return 'html';
  if (ct.includes('text'))  return 'txt';
  return 'txt';
}

function buildRequestTemplate() {
  return `### GET Request Example
GET https://jsonplaceholder.typicode.com/todos/1 HTTP/1.1
Accept: application/json

###

### POST Request Example
POST https://jsonplaceholder.typicode.com/todos HTTP/1.1
Content-Type: application/json
Accept: application/json

{
  "title": "My Task",
  "completed": false,
  "userId": 1
}

###

### Request with variable
GET {{BASE_URL}}/users HTTP/1.1
Authorization: Bearer {{TOKEN}}

`;
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function registerSettingsTab() {
  h.settings.updateTabContent('request-forge.settings', {
    sections: [
      {
        id: 'general',
        title: 'Geral',
        items: [
          { id: 'timeout',       type: 'number', settingKey: 'requestForge.timeout',             label: 'Timeout (ms)',           default: 30000, min: 1000, max: 120000, step: 1000 },
          { id: 'followRedirect',type: 'toggle', settingKey: 'requestForge.followRedirects',     label: 'Seguir Redirecionamentos', default: true },
          { id: 'prettify',      type: 'toggle', settingKey: 'requestForge.prettifyResponse',    label: 'Formatar Resposta JSON',  default: true },
          { id: 'saveHistory',   type: 'toggle', settingKey: 'requestForge.saveHistory',         label: 'Salvar Histórico',        default: true },
          { id: 'maxHistory',    type: 'number', settingKey: 'requestForge.maxHistoryItems',     label: 'Máx. itens no histórico', default: 100, min: 10, max: 1000 },
        ],
      },
      {
        id: 'environments',
        title: 'Ambientes',
        items: [
          { id: 'manageEnvs',  type: 'button', label: 'Gerenciar ambientes', buttonLabel: 'Gerenciar', command: 'requestForge.manageEnvs' },
          { id: 'switchEnv',   type: 'button', label: 'Trocar ambiente',     buttonLabel: 'Trocar',    command: 'requestForge.switchEnv' },
        ],
      },
      {
        id: 'actions',
        title: 'Ações',
        items: [
          { id: 'newFile',     type: 'button', label: 'Novo arquivo .http', buttonLabel: 'Novo arquivo', command: 'requestForge.newRequestFile' },
          { id: 'clearHistory',type: 'button', label: 'Limpar histórico',   buttonLabel: 'Limpar',       command: 'requestForge.clearHistory', variant: 'danger' },
        ],
      },
    ],
  });
}

// ── Deactivate ────────────────────────────────────────────────────────────────

export function deactivate() {
  console.log('[request-forge] deactivated');
  history = [];
  lastResponse = null;
  environments = {};
}
