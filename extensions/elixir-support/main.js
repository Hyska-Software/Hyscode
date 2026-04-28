/**
 * elixir-support — Extensão Elixir & Phoenix para HysCode
 * Language Server: ElixirLS (https://github.com/elixir-lsp/elixir-ls)
 * Suporte: Elixir 1.14+, Phoenix, LiveView, HEEx, Ecto, Mix, OTP
 */

'use strict';

/** @type {import('../extension-api/src').HysCodeAPI | null} */
let api = null;

/** @type {Array<() => void>} */
let disposables = [];

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa um comando no terminal ativo.
 * @param {string} cmd
 */
function run(cmd) {
  api.terminal.sendToActive(cmd);
}

/**
 * Registra um comando e adiciona à lista de disposables.
 * @param {string} id
 * @param {() => void | Promise<void>} handler
 */
function register(id, handler) {
  const d = api.commands.register(id, handler);
  disposables.push(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context) {
  api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[elixir-support] HysCode API not available');
    return;
  }

  console.log('[elixir-support] Extension activated');

  // ── Elixir Core ───────────────────────────────────────────────────────────

  register('elixir.run', () => {
    const file = api.editor?.getActiveFile?.() || '';
    if (file) {
      run(`elixir "${file}"`);
    } else {
      run('elixir .');
    }
  });

  register('elixir.iex', () => {
    run('iex');
  });

  register('elixir.iexMix', () => {
    run('iex -S mix');
  });

  // ── Mix Core ──────────────────────────────────────────────────────────────

  register('mix.compile', () => {
    run('mix compile');
  });

  register('mix.run', () => {
    run('mix run');
  });

  // ── Testing ───────────────────────────────────────────────────────────────

  register('mix.test', () => {
    run('mix test');
  });

  register('mix.testFile', async () => {
    const file = api.editor?.getActiveFile?.() || '';
    if (file && file.endsWith('_test.exs')) {
      run(`mix test "${file}"`);
    } else if (file && file.endsWith('.ex')) {
      const testFile = file.replace('/lib/', '/test/').replace('.ex', '_test.exs');
      run(`mix test "${testFile}"`);
    } else {
      run('mix test');
    }
  });

  register('mix.testWatch', () => {
    run('mix test.watch');
  });

  // ── Formatting & Quality ──────────────────────────────────────────────────

  register('mix.fmt', () => {
    run('mix format');
  });

  register('mix.fmtCheck', () => {
    run('mix format --check-formatted');
  });

  register('mix.credo', () => {
    run('mix credo');
  });

  register('mix.credoStrict', () => {
    run('mix credo --strict');
  });

  register('mix.dialyzer', () => {
    run('mix dialyzer');
  });

  // ── Dependencies ──────────────────────────────────────────────────────────

  register('mix.depsGet', () => {
    run('mix deps.get');
  });

  register('mix.depsUpdate', async () => {
    const dep = await api.window.showInputBox({
      prompt: 'Nome do pacote para atualizar',
      placeholder: 'phoenix ou vazio para --all',
    });
    if (dep === undefined) return;
    run(dep ? `mix deps.update ${dep}` : 'mix deps.update --all');
  });

  register('mix.depsUpdateAll', async () => {
    const choice = await api.window.showInformationMessage(
      'Atualizar todas as dependências?',
      'Atualizar', 'Cancelar'
    );
    if (choice !== 'Atualizar') return;
    run('mix deps.update --all');
  });

  register('mix.depsCompile', () => {
    run('mix deps.compile');
  });

  register('mix.depsList', () => {
    run('mix deps');
  });

  // ── Scaffolding ───────────────────────────────────────────────────────────

  register('mix.new', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome do projeto Elixir',
      placeholder: 'my_app',
    });
    if (!name) return;

    const kind = await api.window.showQuickPick(
      [
        { label: 'Padrão', description: 'Aplicação OTP básica (mix new)' },
        { label: 'Umbrella', description: 'Projeto guarda-chuva (mix new --umbrella)' },
        { label: 'Supervisor', description: 'Com árvore de supervisão (mix new --sup)' },
      ],
      { placeholder: 'Tipo de projeto' }
    );
    if (!kind) return;

    if (kind.label === 'Umbrella') {
      run(`mix new ${name} --umbrella`);
    } else if (kind.label === 'Supervisor') {
      run(`mix new ${name} --sup`);
    } else {
      run(`mix new ${name}`);
    }
  });

  register('mix.phxNew', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome do projeto Phoenix',
      placeholder: 'my_app',
    });
    if (!name) return;

    const options = await api.window.showQuickPick(
      [
        { label: 'Padrão', description: 'Phoenix completo com HTML, LiveView e Ecto' },
        { label: 'API-only', description: 'Sem HTML/LiveView (--no-html --no-live)' },
        { label: 'LiveView apenas', description: 'Com LiveView, sem assets webpack' },
        { label: 'Sem Ecto', description: 'Phoenix sem banco de dados (--no-ecto)' },
      ],
      { placeholder: 'Configuração do projeto Phoenix' }
    );
    if (!options) return;

    let flags = '';
    if (options.label === 'API-only') flags = ' --no-html --no-live --no-assets';
    else if (options.label === 'LiveView apenas') flags = ' --no-webpack';
    else if (options.label === 'Sem Ecto') flags = ' --no-ecto';

    run(`mix phx.new ${name}${flags}`);
  });

  // ── Phoenix ───────────────────────────────────────────────────────────────

  register('mix.phxServer', () => {
    run('mix phx.server');
  });

  register('mix.phxRoutes', () => {
    run('mix phx.routes');
  });

  register('mix.phxDigest', () => {
    run('mix phx.digest');
  });

  // ── Ecto ──────────────────────────────────────────────────────────────────

  register('mix.ectoCreate', () => {
    run('mix ecto.create');
  });

  register('mix.ectoDrop', async () => {
    const choice = await api.window.showInformationMessage(
      'Destruir o banco de dados? Esta operação não pode ser desfeita.',
      'Destruir', 'Cancelar'
    );
    if (choice !== 'Destruir') return;
    run('mix ecto.drop');
  });

  register('mix.ectoMigrate', () => {
    run('mix ecto.migrate');
  });

  register('mix.ectoRollback', async () => {
    const steps = await api.window.showInputBox({
      prompt: 'Número de migrações para reverter',
      placeholder: '1',
      value: '1',
    });
    if (steps === undefined) return;
    const n = parseInt(steps, 10);
    run(`mix ecto.rollback${n > 1 ? ` --step ${n}` : ''}`);
  });

  register('mix.ectoReset', async () => {
    const choice = await api.window.showInformationMessage(
      'Resetar banco de dados (drop + create + migrate)?',
      'Resetar', 'Cancelar'
    );
    if (choice !== 'Resetar') return;
    run('mix ecto.reset');
  });

  register('mix.ectoSetup', () => {
    run('mix ecto.setup');
  });

  register('mix.ectoGenMigration', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome da migration (snake_case)',
      placeholder: 'create_users_table',
    });
    if (!name) return;
    run(`mix ecto.gen.migration ${name}`);
  });

  // ── Release ───────────────────────────────────────────────────────────────

  register('mix.release', async () => {
    const name = await api.window.showInputBox({
      prompt: 'Nome do release (vazio = padrão do mix.exs)',
      placeholder: '',
    });
    if (name === undefined) return;
    run(name ? `mix release ${name}` : 'mix release');
  });

  register('mix.releaseInit', () => {
    run('mix release.init');
  });

  // ── ElixirLS install ──────────────────────────────────────────────────────

  register('mix.installElixirLS', async () => {
    const choice = await api.window.showInformationMessage(
      'Instalar/atualizar ElixirLS via Mix? (requer elixir-ls instalado globalmente)',
      'Abrir instruções', 'Cancelar'
    );
    if (choice !== 'Abrir instruções') return;
    api.notifications?.info?.(
      'ElixirLS: baixe em https://github.com/elixir-lsp/elixir-ls/releases e adicione ao PATH como "elixir-ls".'
    );
  });

  // ── New Elixir File ───────────────────────────────────────────────────────

  register('elixir.newFile', async () => {
    const kinds = [
      { label: 'Module',         description: 'Módulo Elixir básico' },
      { label: 'GenServer',      description: 'GenServer com callbacks' },
      { label: 'Supervisor',     description: 'Supervisor OTP' },
      { label: 'Agent',          description: 'Agent para estado simples' },
      { label: 'Ecto Schema',    description: 'Schema Ecto com changeset' },
      { label: 'Phoenix Context', description: 'Context Phoenix com CRUD' },
      { label: 'LiveView',       description: 'Phoenix LiveView' },
      { label: 'LiveComponent',  description: 'Phoenix LiveComponent' },
      { label: 'Controller',     description: 'Phoenix Controller' },
      { label: 'Mix Task',       description: 'Mix custom task' },
      { label: 'Test',           description: 'Módulo de testes ExUnit' },
    ];

    const kind = await api.window.showQuickPick(kinds, {
      placeholder: 'Tipo de arquivo Elixir',
    });
    if (!kind) return;

    const moduleName = await api.window.showInputBox({
      prompt: 'Nome completo do módulo (ex: MyApp.Users)',
      placeholder: 'MyApp.Module',
    });
    if (!moduleName) return;

    const content = buildFileContent(kind.label, moduleName);
    const fileName = moduleToFileName(moduleName);

    await api.workspace.createFile(fileName, content);
    await api.editor?.openFile?.(fileName);
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  try {
    const statusBar = api.window.createStatusBarItem({
      id: 'elixir-support.indicator',
      text: '💧 Elixir',
      tooltip: 'Elixir Support — ElixirLS ativo',
      command: 'elixir.iexMix',
      alignment: 'right',
      priority: 47,
    });
    disposables.push(statusBar);
  } catch {
    // Status bar API não disponível nesta versão
  }

  // ── Settings tab ──────────────────────────────────────────────────────────

  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('elixir-support.settings', {
      sections: [
        {
          title: 'On Save',
          items: [
            { type: 'toggle', key: 'formatOnSave', label: 'Format on Save', description: 'Run mix format on save', defaultValue: true },
            { type: 'toggle', key: 'credoOnSave', label: 'Credo on Save', description: 'Run mix credo on save', defaultValue: false },
          ],
        },
        {
          title: 'ElixirLS',
          items: [
            { type: 'text', key: 'elixirLSPath', label: 'ElixirLS Path', description: 'Path to elixir-ls binary', placeholder: 'elixir-ls', defaultValue: 'elixir-ls' },
            { type: 'toggle', key: 'dialyzerEnabled', label: 'Enable Dialyzer', description: 'Enable Dialyzer type analysis via ElixirLS', defaultValue: true },
            { type: 'toggle', key: 'fetchDepsOnOpen', label: 'Fetch Deps on Open', description: 'Run mix deps.get when workspace opens', defaultValue: false },
          ],
        },
        {
          title: 'Environment',
          items: [
            { type: 'text', key: 'elixirPath', label: 'Elixir Path', description: 'Path to elixir binary', placeholder: 'elixir', defaultValue: 'elixir' },
            { type: 'text', key: 'mixPath', label: 'Mix Path', description: 'Path to mix binary', placeholder: 'mix', defaultValue: 'mix' },
            {
              type: 'select',
              key: 'mixEnv',
              label: 'MIX_ENV',
              description: 'Default Mix environment',
              options: ['dev', 'test', 'prod'],
              defaultValue: 'dev',
            },
          ],
        },
      ],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deactivate
// ─────────────────────────────────────────────────────────────────────────────

export function deactivate() {
  disposables.forEach(d => {
    if (typeof d === 'function') d();
    else if (d && typeof d.dispose === 'function') d.dispose();
  });
  disposables = [];
  api = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scaffold helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte nome de módulo Elixir para caminho de arquivo.
 * MyApp.Users.Schema -> lib/my_app/users/schema.ex
 * @param {string} moduleName
 * @returns {string}
 */
function moduleToFileName(moduleName) {
  const parts = moduleName.split('.');
  const fileParts = parts.map(p =>
    p.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
      .replace(/^_/, '')
  );
  return `lib/${fileParts.join('/')}.ex`;
}

/**
 * Gera conteúdo de arquivo por tipo.
 * @param {string} kind
 * @param {string} moduleName
 * @returns {string}
 */
function buildFileContent(kind, moduleName) {
  const appName = moduleName.split('.')[0];

  switch (kind) {
    case 'GenServer':
      return [
        `defmodule ${moduleName} do`,
        `  @moduledoc """`,
        `  GenServer para ${moduleName}.`,
        `  """`,
        `  use GenServer`,
        ``,
        `  # ─── Client API ────────────────────────────────────────────────────`,
        ``,
        `  def start_link(opts \\\\ []) do`,
        `    GenServer.start_link(__MODULE__, opts, name: __MODULE__)`,
        `  end`,
        ``,
        `  # ─── Server Callbacks ───────────────────────────────────────────────`,
        ``,
        `  @impl true`,
        `  def init(_opts) do`,
        `    {:ok, %{}}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_call(_msg, _from, state) do`,
        `    {:reply, :ok, state}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_cast(_msg, state) do`,
        `    {:noreply, state}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_info(_msg, state) do`,
        `    {:noreply, state}`,
        `  end`,
        `end`,
      ].join('\n');

    case 'Supervisor':
      return [
        `defmodule ${moduleName} do`,
        `  use Supervisor`,
        ``,
        `  def start_link(init_arg) do`,
        `    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)`,
        `  end`,
        ``,
        `  @impl true`,
        `  def init(_init_arg) do`,
        `    children = [`,
        `      # {${appName}.Worker, []}`,
        `    ]`,
        ``,
        `    Supervisor.init(children, strategy: :one_for_one)`,
        `  end`,
        `end`,
      ].join('\n');

    case 'Agent':
      return [
        `defmodule ${moduleName} do`,
        `  use Agent`,
        ``,
        `  def start_link(initial_value \\\\ %{}) do`,
        `    Agent.start_link(fn -> initial_value end, name: __MODULE__)`,
        `  end`,
        ``,
        `  def get do`,
        `    Agent.get(__MODULE__, & &1)`,
        `  end`,
        ``,
        `  def update(fun) do`,
        `    Agent.update(__MODULE__, fun)`,
        `  end`,
        `end`,
      ].join('\n');

    case 'Ecto Schema': {
      const table = moduleName.split('.').pop()
        .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
        .replace(/^_/, '') + 's';
      return [
        `defmodule ${moduleName} do`,
        `  use Ecto.Schema`,
        `  import Ecto.Changeset`,
        ``,
        `  @primary_key {:id, :binary_id, autogenerate: true}`,
        `  @foreign_key_type :binary_id`,
        ``,
        `  schema "${table}" do`,
        `    field :name, :string`,
        ``,
        `    timestamps(type: :utc_datetime_usec)`,
        `  end`,
        ``,
        `  @doc false`,
        `  def changeset(schema, attrs) do`,
        `    schema`,
        `    |> cast(attrs, [:name])`,
        `    |> validate_required([:name])`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'Phoenix Context': {
      const resource = moduleName.split('.').pop();
      const resourceSnake = resource
        .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
        .replace(/^_/, '');
      return [
        `defmodule ${moduleName} do`,
        `  @moduledoc """`,
        `  The ${resource} context.`,
        `  """`,
        ``,
        `  import Ecto.Query, warn: false`,
        `  alias ${appName}.Repo`,
        `  alias ${moduleName}.${resource}`,
        ``,
        `  def list_${resourceSnake}s do`,
        `    Repo.all(${resource})`,
        `  end`,
        ``,
        `  def get_${resourceSnake}!(id), do: Repo.get!(${resource}, id)`,
        ``,
        `  def create_${resourceSnake}(attrs \\\\ %{}) do`,
        `    %${resource}{}`,
        `    |> ${resource}.changeset(attrs)`,
        `    |> Repo.insert()`,
        `  end`,
        ``,
        `  def update_${resourceSnake}(%${resource}{} = ${resourceSnake}, attrs) do`,
        `    ${resourceSnake}`,
        `    |> ${resource}.changeset(attrs)`,
        `    |> Repo.update()`,
        `  end`,
        ``,
        `  def delete_${resourceSnake}(%${resource}{} = ${resourceSnake}) do`,
        `    Repo.delete(${resourceSnake})`,
        `  end`,
        ``,
        `  def change_${resourceSnake}(%${resource}{} = ${resourceSnake}, attrs \\\\ %{}) do`,
        `    ${resource}.changeset(${resourceSnake}, attrs)`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'LiveView': {
      const web = `${appName}Web`;
      return [
        `defmodule ${moduleName} do`,
        `  use ${web}, :live_view`,
        ``,
        `  @impl true`,
        `  def mount(_params, _session, socket) do`,
        `    {:ok, socket}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_params(_params, _url, socket) do`,
        `    {:noreply, socket}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_event(event, params, socket) do`,
        `    {:noreply, socket}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def render(assigns) do`,
        `    ~H"""`,
        `    <div>`,
        `      <!-- conteúdo -->`,
        `    </div>`,
        `    """`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'LiveComponent': {
      const web = `${appName}Web`;
      return [
        `defmodule ${moduleName} do`,
        `  use ${web}, :live_component`,
        ``,
        `  @impl true`,
        `  def update(assigns, socket) do`,
        `    {:ok, assign(socket, assigns)}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def handle_event(event, params, socket) do`,
        `    {:noreply, socket}`,
        `  end`,
        ``,
        `  @impl true`,
        `  def render(assigns) do`,
        `    ~H"""`,
        `    <div id={@id}>`,
        `      <!-- conteúdo -->`,
        `    </div>`,
        `    """`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'Controller': {
      const web = `${appName}Web`;
      const resource = moduleName.split('.').pop().replace('Controller', '');
      const resourceSnake = resource
        .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
        .replace(/^_/, '');
      return [
        `defmodule ${moduleName} do`,
        `  use ${web}, :controller`,
        ``,
        `  def index(conn, _params) do`,
        `    render(conn, :index, ${resourceSnake}s: [])`,
        `  end`,
        ``,
        `  def show(conn, %{"id" => id}) do`,
        `    render(conn, :show, ${resourceSnake}: nil)`,
        `  end`,
        ``,
        `  def new(conn, _params) do`,
        `    render(conn, :new)`,
        `  end`,
        ``,
        `  def create(conn, %{"${resourceSnake}" => params}) do`,
        `    redirect(conn, to: ~p"/${resourceSnake}s")`,
        `  end`,
        ``,
        `  def edit(conn, %{"id" => id}) do`,
        `    render(conn, :edit)`,
        `  end`,
        ``,
        `  def update(conn, %{"id" => id, "${resourceSnake}" => params}) do`,
        `    redirect(conn, to: ~p"/${resourceSnake}s/#{id}")`,
        `  end`,
        ``,
        `  def delete(conn, %{"id" => id}) do`,
        `    redirect(conn, to: ~p"/${resourceSnake}s")`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'Mix Task': {
      const taskName = moduleName.replace(/^Mix\.Tasks\./, '');
      return [
        `defmodule Mix.Tasks.${taskName} do`,
        `  use Mix.Task`,
        ``,
        `  @shortdoc "Descrição curta do task"`,
        ``,
        `  @moduledoc """`,
        `  Documentação do Mix task ${taskName}.`,
        `  """`,
        ``,
        `  @impl Mix.Task`,
        `  def run(args) do`,
        `    # implementação`,
        `  end`,
        `end`,
      ].join('\n');
    }

    case 'Test': {
      const testedModule = moduleName.replace(/Test$/, '');
      return [
        `defmodule ${moduleName} do`,
        `  use ExUnit.Case, async: true`,
        ``,
        `  alias ${testedModule}`,
        ``,
        `  describe "${testedModule}" do`,
        `    test "example test" do`,
        `      assert true`,
        `    end`,
        `  end`,
        `end`,
      ].join('\n');
    }

    default: // Module
      return [
        `defmodule ${moduleName} do`,
        `  @moduledoc """`,
        `  Documentação do módulo ${moduleName}.`,
        `  """`,
        ``,
        `  # TODO: implementar`,
        `end`,
      ].join('\n');
  }
}
