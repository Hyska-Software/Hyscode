/**
 * django-support — Extensão Django para HysCode
 * Comandos manage.py, templates, DRF, scaffolding
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

function py() {
  return api.settings?.get?.('django.pythonPath') || 'python';
}

function manage() {
  return api.settings?.get?.('django.managePyPath') || 'manage.py';
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context) {
  api = context._api || globalThis.hyscode;

  // ── Run server ────────────────────────────────────────────────────────────

  register('django.runServer', async () => {
    const port = api.settings?.get?.('django.defaultPort') || 8000;
    run(`${py()} ${manage()} runserver ${port}`);
  });

  // ── Migrations ────────────────────────────────────────────────────────────

  register('django.makeMigrations', async () => {
    const app = await api.window.showInputBox({
      prompt: 'App name (vazio para todas)',
      placeholder: 'myapp',
    });
    const cmd = app
      ? `${py()} ${manage()} makemigrations ${app}`
      : `${py()} ${manage()} makemigrations`;
    run(cmd);
  });

  register('django.migrate', () => {
    run(`${py()} ${manage()} migrate`);
  });

  // ── Superuser ─────────────────────────────────────────────────────────────

  register('django.createSuperUser', () => {
    run(`${py()} ${manage()} createsuperuser`);
  });

  register('django.createsuperuser', () => {
    run(`${py()} ${manage()} createsuperuser`);
  });

  // ── Start app / project ───────────────────────────────────────────────────

  register('django.startApp', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome da nova app',
      placeholder: 'accounts',
    });
    if (!name) return;
    run(`${py()} ${manage()} startapp ${name}`);
    api.notifications?.info?.(`App "${name}" criada. Adicione em INSTALLED_APPS.`);
  });

  register('django.startProject', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome do projeto Django',
      placeholder: 'myproject',
    });
    if (!name) return;
    run(`django-admin startproject ${name}`);
  });

  // ── Static / Shell / Test / Check ─────────────────────────────────────────

  register('django.collectStatic', () => {
    run(`${py()} ${manage()} collectstatic --noinput`);
  });

  register('django.shell', async () => {
    const shells = [
      { label: 'Default shell', description: 'shell' },
      { label: 'Shell Plus (django-extensions)', description: 'shell_plus' },
      { label: 'IPython shell', description: 'shell -i ipython' },
    ];
    const choice = await api.window.showQuickPick(shells, {
      placeholder: 'Tipo de shell',
    });
    if (!choice) return;
    run(`${py()} ${manage()} ${choice.description}`);
  });

  register('django.test', async () => {
    const framework = api.settings?.get?.('django.testFramework') || 'unittest';
    const app = await api.window.showInputBox({
      prompt: 'App ou módulo para testar (vazio para todos)',
      placeholder: 'myapp.tests',
    });

    if (framework === 'pytest') {
      run(app ? `pytest ${app}` : 'pytest');
    } else {
      run(app ? `${py()} ${manage()} test ${app}` : `${py()} ${manage()} test`);
    }
  });

  register('django.check', () => {
    run(`${py()} ${manage()} check`);
  });

  // ── Data dump / load ──────────────────────────────────────────────────────

  register('django.dumpData', async () => {
    const app = await api.window.showInputBox({
      prompt: 'App ou model (ex: myapp, myapp.MyModel)',
      placeholder: 'myapp',
    });
    if (!app) return;
    const format = await api.window.showQuickPick(
      [{ label: 'json' }, { label: 'yaml' }, { label: 'xml' }],
      { placeholder: 'Formato de saída' },
    );
    if (!format) return;
    run(`${py()} ${manage()} dumpdata ${app} --indent 2 --format ${format.label} > ${app.replace('.', '_')}_data.${format.label}`);
  });

  register('django.loadData', async () => {
    const fixture = await api.window.showInputBox({
      prompt: 'Caminho do fixture',
      placeholder: 'fixtures/data.json',
    });
    if (!fixture) return;
    run(`${py()} ${manage()} loaddata ${fixture}`);
  });

  // ── Show URLs ─────────────────────────────────────────────────────────────

  register('django.showUrls', () => {
    run(`${py()} ${manage()} show_urls 2>/dev/null || ${py()} ${manage()} show_urls 2>nul || echo "Instale django-extensions: pip install django-extensions"`);
  });

  // ── New template file ─────────────────────────────────────────────────────

  register('django.newTemplate', async () => {
    const templates = [
      { label: 'Base template', description: 'base' },
      { label: 'Child template', description: 'child' },
      { label: 'List template', description: 'list' },
      { label: 'Detail template', description: 'detail' },
      { label: 'Form template', description: 'form' },
      { label: 'Blank', description: 'blank' },
    ];

    const choice = await api.window.showQuickPick(templates, {
      placeholder: 'Tipo de template',
    });
    if (!choice) return;

    const filename = await api.window.showInputBox({
      prompt: 'Caminho do template',
      placeholder: 'templates/myapp/index.html',
    });
    if (!filename) return;

    const content = getTemplateContent(choice.description);
    await api.workspace.createFile(filename, content);
    await api.editor?.openFile?.(filename);
  });

  // ── Scaffold new app ──────────────────────────────────────────────────────

  register('django.newApp', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome da app para scaffold',
      placeholder: 'blog',
    });
    if (!name) return;

    const progress = api.notifications?.progress?.(`Scaffolding ${name}...`);
    try {
      run(`${py()} ${manage()} startapp ${name}`);
      api.notifications?.info?.(`App "${name}" criada! Lembre de adicioná-la em INSTALLED_APPS.`);
    } finally {
      progress?.done?.();
    }
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  try {
    const statusBar = api.window.createStatusBarItem({
      id: 'django-support.indicator',
      text: '$(server-process) Django',
      tooltip: 'Django Support',
      command: 'django.runServer',
      alignment: 'right',
      priority: 40,
    });
    disposables.push(statusBar);
  } catch {
    // ignore
  }

  // Settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('django-support.settings', {
      sections: [
        {
          title: 'Project',
          items: [
            { type: 'text', key: 'managePyPath', label: 'manage.py Path', description: 'Path to manage.py', placeholder: 'manage.py', defaultValue: 'manage.py' },
            { type: 'text', key: 'pythonPath', label: 'Python Command', description: 'Python interpreter command', placeholder: 'python', defaultValue: 'python' },
            { type: 'number', key: 'defaultPort', label: 'Default Port', description: 'Default port for runserver', defaultValue: 8000, min: 1024, max: 65535 },
            { type: 'toggle', key: 'autoActivateVenv', label: 'Auto Activate Venv', description: 'Auto-activate virtualenv if detected', defaultValue: true },
          ],
        },
        {
          title: 'Tests',
          items: [
            { type: 'select', key: 'testFramework', label: 'Test Framework', description: 'Testing framework to use', defaultValue: 'unittest', options: [{ value: 'unittest', label: 'unittest' }, { value: 'pytest', label: 'pytest' }] },
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
// Template helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTemplateContent(type) {
  switch (type) {
    case 'base':
      return [
        '{% load static %}',
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>{% block title %}My Site{% endblock %}</title>',
        '  <link rel="stylesheet" href="{% static \'css/style.css\' %}">',
        '  {% block extra_css %}{% endblock %}',
        '</head>',
        '<body>',
        '  <header>',
        '    {% block header %}{% endblock %}',
        '  </header>',
        '',
        '  <main>',
        '    {% block content %}{% endblock %}',
        '  </main>',
        '',
        '  <footer>',
        '    {% block footer %}{% endblock %}',
        '  </footer>',
        '',
        '  <script src="{% static \'js/main.js\' %}"></script>',
        '  {% block extra_js %}{% endblock %}',
        '</body>',
        '</html>',
      ].join('\n');

    case 'child':
      return [
        '{% extends "base.html" %}',
        '{% load static %}',
        '',
        '{% block title %}Page Title{% endblock %}',
        '',
        '{% block content %}',
        '',
        '{% endblock %}',
      ].join('\n');

    case 'list':
      return [
        '{% extends "base.html" %}',
        '',
        '{% block content %}',
        '<h1>Items</h1>',
        '',
        '{% for item in items %}',
        '  <div>',
        '    <a href="{% url \'detail\' item.pk %}">{{ item }}</a>',
        '  </div>',
        '{% empty %}',
        '  <p>No items found.</p>',
        '{% endfor %}',
        '',
        '{% if is_paginated %}',
        '  <nav>',
        '    {% if page_obj.has_previous %}',
        '      <a href="?page={{ page_obj.previous_page_number }}">Previous</a>',
        '    {% endif %}',
        '    <span>Page {{ page_obj.number }} of {{ page_obj.paginator.num_pages }}</span>',
        '    {% if page_obj.has_next %}',
        '      <a href="?page={{ page_obj.next_page_number }}">Next</a>',
        '    {% endif %}',
        '  </nav>',
        '{% endif %}',
        '{% endblock %}',
      ].join('\n');

    case 'detail':
      return [
        '{% extends "base.html" %}',
        '',
        '{% block content %}',
        '<h1>{{ object }}</h1>',
        '',
        '<div>',
        '  {{ object.description }}',
        '</div>',
        '',
        '<a href="{% url \'list\' %}">Back to list</a>',
        '{% endblock %}',
      ].join('\n');

    case 'form':
      return [
        '{% extends "base.html" %}',
        '',
        '{% block content %}',
        '<h1>{{ title }}</h1>',
        '',
        '<form method="post">',
        '  {% csrf_token %}',
        '  {{ form.as_p }}',
        '  <button type="submit">Save</button>',
        '</form>',
        '{% endblock %}',
      ].join('\n');

    default:
      return [
        '{% extends "base.html" %}',
        '',
        '{% block content %}',
        '',
        '{% endblock %}',
      ].join('\n');
  }
}
