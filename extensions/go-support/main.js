/**
 * go-support — Extensão Go para HysCode
 * Language Server: gopls (https://pkg.go.dev/golang.org/x/tools/gopls)
 * Suporte: Go 1.21+, módulos, workspaces, generics, LSP completo
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

  // ── Build & Run ───────────────────────────────────────────────────────────

  register('go.run', () => {
    run('go run .');
  });

  register('go.build', () => {
    run('go build ./...');
  });

  register('go.install', async () => {
    const pkg = await api.window.showInputBox({
      prompt: 'Pacote para instalar (ex: github.com/user/repo@latest)',
      placeholder: './... para instalar o projeto atual',
    });
    if (!pkg) return;
    run(`go install ${pkg}`);
  });

  register('go.generate', () => {
    run('go generate ./...');
  });

  // ── Testing ───────────────────────────────────────────────────────────────

  register('go.test', () => {
    run('go test ./...');
  });

  register('go.testFile', async () => {
    const timeout = await api.settings?.get?.('go.testTimeout') ?? '30s';
    const file = await api.editor?.getCurrentFile?.() ?? '';
    if (file) {
      const pkg = file.substring(0, file.lastIndexOf('/') + 1) || '.';
      run(`go test -v -timeout ${timeout} ${pkg}`);
    } else {
      run(`go test -v -timeout ${timeout} ./...`);
    }
  });

  register('go.testVerbose', () => {
    run('go test -v -count=1 ./...');
  });

  register('go.bench', () => {
    run('go test -bench=. -benchmem ./...');
  });

  // ── Code Quality ─────────────────────────────────────────────────────────

  register('go.fmt', () => {
    run('gofmt -w .');
  });

  register('go.vet', () => {
    run('go vet ./...');
  });

  register('go.lint', () => {
    run('staticcheck ./...');
  });

  // ── gopls install ─────────────────────────────────────────────────────────

  register('go.installGopls', async () => {
    const choice = await api.window.showInformationMessage(
      'Instalar/atualizar gopls (language server Go)?',
      'Instalar', 'Cancelar'
    );
    if (choice !== 'Instalar') return;
    run('go install golang.org/x/tools/gopls@latest');
    api.notifications?.info?.('gopls sendo instalado — aguarde o terminal concluir...');
  });

  // ── go mod ───────────────────────────────────────────────────────────────

  register('gomod.init', async () => {
    const moduleName = await api.window.showInputBox({
      prompt: 'Nome do módulo Go',
      placeholder: 'github.com/usuario/projeto',
    });
    if (!moduleName) return;
    run(`go mod init ${moduleName}`);
  });

  register('gomod.tidy', () => {
    run('go mod tidy');
  });

  register('gomod.download', () => {
    run('go mod download');
  });

  register('gomod.vendor', () => {
    run('go mod vendor');
  });

  register('gomod.get', async () => {
    const dep = await api.window.showInputBox({
      prompt: 'Dependência para adicionar',
      placeholder: 'github.com/pkg/errors@latest',
    });
    if (!dep) return;
    run(`go get ${dep}`);
  });

  register('gomod.upgrade', async () => {
    const choice = await api.window.showInformationMessage(
      'Atualizar todas as dependências para as versões mais recentes?',
      'Atualizar', 'Cancelar'
    );
    if (choice !== 'Atualizar') return;
    run('go get -u ./... && go mod tidy');
  });

  // ── go work ───────────────────────────────────────────────────────────────

  register('gowork.init', async () => {
    const dirs = await api.window.showInputBox({
      prompt: 'Diretórios dos módulos (separados por espaço)',
      placeholder: '. ./module1 ./module2',
    });
    if (!dirs) return;
    run(`go work init ${dirs}`);
  });

  register('gowork.use', async () => {
    const dir = await api.window.showInputBox({
      prompt: 'Diretório do módulo para adicionar ao workspace',
      placeholder: './my-module',
    });
    if (!dir) return;
    run(`go work use ${dir}`);
  });

  register('gowork.sync', () => {
    run('go work sync');
  });

  // ── Scaffolding ───────────────────────────────────────────────────────────

  register('go.newProject', async () => {
    const moduleName = await api.window.showInputBox({
      prompt: 'Nome do módulo Go (usado em go mod init)',
      placeholder: 'github.com/usuario/projeto',
    });
    if (!moduleName) return;

    const template = await api.window.showQuickPick(
      [
        { label: 'CLI', description: 'Aplicação de linha de comando' },
        { label: 'HTTP Server', description: 'Servidor HTTP simples' },
        { label: 'Library', description: 'Biblioteca/package reutilizável' },
        { label: 'Minimal', description: 'Apenas main.go e go.mod' },
      ],
      { placeholder: 'Tipo de projeto' }
    );
    if (!template) return;

    const projectName = moduleName.split('/').pop() ?? 'app';

    // Cria estrutura baseada no template
    const files = buildProjectFiles(moduleName, projectName, template.label);

    for (const [path, content] of Object.entries(files)) {
      await api.workspace.createFile(path, content);
    }

    run(`go mod init ${moduleName}`);

    api.notifications?.info?.(`Projeto Go "${projectName}" criado!`);
  });

  register('go.newFile', async () => {
    const kinds = [
      { label: 'main', description: 'Arquivo com func main()' },
      { label: 'package', description: 'Arquivo de package simples' },
      { label: 'struct', description: 'Package com struct e construtor' },
      { label: 'interface', description: 'Package com interface' },
      { label: 'http-handler', description: 'Handlers HTTP' },
      { label: 'test', description: 'Arquivo de testes (*_test.go)' },
    ];

    const kind = await api.window.showQuickPick(kinds, {
      placeholder: 'Tipo de arquivo Go',
    });
    if (!kind) return;

    const fileName = await api.window.showInputBox({
      prompt: 'Nome do arquivo (sem .go)',
      placeholder: kind.label === 'test' ? 'server_test' : kind.label,
    });
    if (!fileName) return;

    const pkgName = await api.window.showInputBox({
      prompt: 'Nome do package',
      placeholder: 'main',
    });
    if (!pkgName) return;

    const content = buildFileContent(kind.label, pkgName, fileName);
    const suffix = kind.label === 'test' ? '_test.go' : '.go';
    const filePath = fileName.endsWith('_test') || kind.label === 'test'
      ? `${fileName}.go`
      : `${fileName}${suffix}`;

    await api.workspace.createFile(filePath, content);
    await api.editor?.openFile?.(filePath);
  });

  // ── Status bar ────────────────────────────────────────────────────────────

  try {
    const statusBar = api.window.createStatusBarItem({
      id: 'go-support.indicator',
      text: '$(symbol-class) Go',
      tooltip: 'Go Support — gopls ativo',
      command: 'go.build',
      alignment: 'right',
      priority: 50,
    });
    disposables.push(statusBar);
  } catch {
    // Status bar API não disponível nesta versão — ignora silenciosamente
  }

  // Settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('go-support.settings', {
      sections: [
        {
          title: 'On Save',
          items: [
            { type: 'toggle', key: 'formatOnSave', label: 'Format on Save', description: 'Run gofmt automatically on save', defaultValue: true },
            { type: 'toggle', key: 'vetOnSave', label: 'Vet on Save', description: 'Run go vet on save', defaultValue: true },
            { type: 'toggle', key: 'buildOnSave', label: 'Build on Save', description: 'Detect compile errors on save', defaultValue: false },
            { type: 'toggle', key: 'lintOnSave', label: 'Lint on Save', description: 'Run staticcheck on save', defaultValue: false },
          ],
        },
        {
          title: 'gopls',
          items: [
            { type: 'toggle', key: 'goplsEnabled', label: 'Enable gopls', description: 'Use gopls as the Go language server', defaultValue: true },
            { type: 'text', key: 'goplsPath', label: 'gopls Path', description: 'Path to gopls binary', placeholder: 'gopls', defaultValue: 'gopls' },
            { type: 'toggle', key: 'staticcheckEnabled', label: 'Enable Staticcheck', description: 'Enable staticcheck analysis via gopls', defaultValue: true },
          ],
        },
        {
          title: 'Environment',
          items: [
            { type: 'text', key: 'gopath', label: 'GOPATH', description: 'Custom GOPATH (empty = system default)', placeholder: '', defaultValue: '' },
            { type: 'text', key: 'goroot', label: 'GOROOT', description: 'Custom GOROOT (empty = system default)', placeholder: '', defaultValue: '' },
            { type: 'text', key: 'testTimeout', label: 'Test Timeout', description: 'Default timeout for go test', placeholder: '30s', defaultValue: '30s' },
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
// Scaffold helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna os arquivos do projeto conforme o template.
 * @param {string} module
 * @param {string} name
 * @param {string} template
 * @returns {Record<string, string>}
 */
function buildProjectFiles(module, name, template) {
  switch (template) {
    case 'HTTP Server':
      return {
        'main.go': [
          'package main',
          '',
          'import (',
          '\t"log/slog"',
          '\t"net/http"',
          '\t"os"',
          ')',
          '',
          'func main() {',
          '\tlogger := slog.New(slog.NewJSONHandler(os.Stdout, nil))',
          '\tslog.SetDefault(logger)',
          '',
          '\tmux := http.NewServeMux()',
          '',
          '\tmux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {',
          '\t\tw.WriteHeader(http.StatusOK)',
          '\t\t_, _ = w.Write([]byte("ok"))',
          '\t})',
          '',
          '\tserver := &http.Server{',
          '\t\tAddr:    ":8080",',
          '\t\tHandler: mux,',
          '\t}',
          '',
          '\tslog.Info("server starting", "addr", server.Addr)',
          '\tif err := server.ListenAndServe(); err != nil {',
          '\t\tslog.Error("server error", "error", err)',
          '\t\tos.Exit(1)',
          '\t}',
          '}',
        ].join('\n'),
      };

    case 'CLI':
      return {
        'main.go': [
          'package main',
          '',
          'import (',
          '\t"flag"',
          '\t"fmt"',
          '\t"os"',
          ')',
          '',
          'func main() {',
          '\tverbose := flag.Bool("verbose", false, "verbose output")',
          '\tflag.Parse()',
          '',
          '\tif *verbose {',
          '\t\tfmt.Fprintln(os.Stderr, "verbose mode enabled")',
          '\t}',
          '',
          '\targs := flag.Args()',
          '\tif len(args) == 0 {',
          '\t\tfmt.Fprintln(os.Stderr, "usage: ' + name + ' [options] <args>")',
          '\t\tos.Exit(1)',
          '\t}',
          '',
          '\t// TODO: implement',
          '\tfmt.Println("Hello from ' + name + '")',
          '}',
        ].join('\n'),
      };

    case 'Library':
      return {
        [`${name}.go`]: [
          `package ${name}`,
          '',
          '// Package ' + name + ' provides ...',
          '',
          '// TODO: implement',
        ].join('\n'),
        [`${name}_test.go`]: [
          `package ${name}_test`,
          '',
          'import (',
          `\t"testing"`,
          '',
          `\t"${module}"`,
          ')',
          '',
          `func TestExample(t *testing.T) {`,
          `\t_ = ${name}.Example`,
          '}',
        ].join('\n'),
      };

    default: // Minimal
      return {
        'main.go': [
          'package main',
          '',
          'import "fmt"',
          '',
          'func main() {',
          `\tfmt.Println("Hello, Go!")`,
          '}',
        ].join('\n'),
      };
  }
}

/**
 * Conteúdo de arquivo por tipo.
 * @param {string} kind
 * @param {string} pkg
 * @param {string} name
 * @returns {string}
 */
function buildFileContent(kind, pkg, name) {
  const typeName = name.charAt(0).toUpperCase() + name.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase());

  switch (kind) {
    case 'main':
      return [
        'package main',
        '',
        'import "fmt"',
        '',
        'func main() {',
        '\tfmt.Println("Hello, Go!")',
        '}',
      ].join('\n');

    case 'struct':
      return [
        `package ${pkg}`,
        '',
        `// ${typeName} represents a ...`,
        `type ${typeName} struct {`,
        '\t// TODO: add fields',
        '}',
        '',
        `// New${typeName} creates a new ${typeName}.`,
        `func New${typeName}() *${typeName} {`,
        `\treturn &${typeName}{}`,
        '}',
      ].join('\n');

    case 'interface':
      return [
        `package ${pkg}`,
        '',
        `// ${typeName} defines the ${typeName} interface.`,
        `type ${typeName} interface {`,
        '\t// TODO: add methods',
        '}',
      ].join('\n');

    case 'http-handler':
      return [
        `package ${pkg}`,
        '',
        'import (',
        '\t"encoding/json"',
        '\t"net/http"',
        ')',
        '',
        `func Register${typeName}Routes(mux *http.ServeMux) {`,
        `\tmux.HandleFunc("GET /${name}", ${name}List)`,
        `\tmux.HandleFunc("POST /${name}", ${name}Create)`,
        '}',
        '',
        `func ${name}List(w http.ResponseWriter, r *http.Request) {`,
        '\tw.Header().Set("Content-Type", "application/json")',
        '\t_ = json.NewEncoder(w).Encode([]any{})',
        '}',
        '',
        `func ${name}Create(w http.ResponseWriter, r *http.Request) {`,
        '\tw.WriteHeader(http.StatusCreated)',
        '}',
      ].join('\n');

    case 'test':
      return [
        `package ${pkg}`,
        '',
        'import "testing"',
        '',
        `func Test${typeName}(t *testing.T) {`,
        '\tt.Run("TODO", func(t *testing.T) {',
        '\t\t// arrange',
        '\t\t// act',
        '\t\t// assert',
        '\t})',
        '}',
      ].join('\n');

    default: // package
      return [
        `package ${pkg}`,
        '',
        '// TODO: implement',
      ].join('\n');
  }
}
