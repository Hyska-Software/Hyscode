// Flutter & Dart Extension — main.js
// Provides runtime commands for Flutter development

export function activate(context) {
  console.log('[flutter-dart] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[flutter-dart] HysCode API not available');
    return;
  }

  // ── Hot Reload ──────────────────────────────────────────────────────────────
  if (api.commands) {
    api.commands.register('flutter.hotReload', async () => {
      console.log('[flutter-dart] Hot Reload triggered');
      // Send 'r' to the active Flutter PTY session to trigger hot reload
      if (api.terminal && api.terminal.sendToActive) {
        await api.terminal.sendToActive('r');
      }
    });

    // ── Hot Restart ─────────────────────────────────────────────────────────────
    api.commands.register('flutter.hotRestart', async () => {
      console.log('[flutter-dart] Hot Restart triggered');
      // Send 'R' to the active Flutter PTY session to trigger hot restart
      if (api.terminal && api.terminal.sendToActive) {
        await api.terminal.sendToActive('R');
      }
    });

    // ── New Stateless Widget ────────────────────────────────────────────────────
    api.commands.register('flutter.newStatelessWidget', async () => {
      const name = await api.window?.showInputBox?.({
        prompt: 'Widget name',
        placeHolder: 'MyWidget',
      });
      if (!name) return;

      const content = `import 'package:flutter/material.dart';

class ${name} extends StatelessWidget {
  const ${name}({super.key});

  @override
  Widget build(BuildContext context) {
    return const Placeholder();
  }
}
`;
      const snakeName = name.replace(/([A-Z])/g, (m, c, i) =>
        (i > 0 ? '_' : '') + c.toLowerCase()
      );
      if (api.workspace && api.workspace.createFile) {
        await api.workspace.createFile(`lib/${snakeName}.dart`, content);
      }
    });

    // ── New Stateful Widget ─────────────────────────────────────────────────────
    api.commands.register('flutter.newStatefulWidget', async () => {
      const name = await api.window?.showInputBox?.({
        prompt: 'Widget name',
        placeHolder: 'MyWidget',
      });
      if (!name) return;

      const content = `import 'package:flutter/material.dart';

class ${name} extends StatefulWidget {
  const ${name}({super.key});

  @override
  State<${name}> createState() => _${name}State();
}

class _${name}State extends State<${name}> {
  @override
  Widget build(BuildContext context) {
    return const Placeholder();
  }
}
`;
      const snakeName = name.replace(/([A-Z])/g, (m, c, i) =>
        (i > 0 ? '_' : '') + c.toLowerCase()
      );
      if (api.workspace && api.workspace.createFile) {
        await api.workspace.createFile(`lib/${snakeName}.dart`, content);
      }
    });

    // ── New Flutter Project ─────────────────────────────────────────────────────
    api.commands.register('flutter.newProject', async () => {
      console.log('[flutter-dart] New Project — use terminal: flutter create <name>');
      if (api.terminal && api.terminal.sendToActive) {
        const name = await api.window?.showInputBox?.({
          prompt: 'Project name',
          placeHolder: 'my_app',
        });
        if (name) {
          await api.terminal.sendToActive(`flutter create ${name}`);
        }
      }
    });

    // ── Run Build Runner ────────────────────────────────────────────────────────
    api.commands.register('flutter.runBuildRunner', async () => {
      console.log('[flutter-dart] Build Runner');
      if (api.terminal && api.terminal.sendToActive) {
        await api.terminal.sendToActive(
          'dart run build_runner build --delete-conflicting-outputs'
        );
      }
    });

    // ── Pub Get ─────────────────────────────────────────────────────────────────
    api.commands.register('flutter.pubGet', async () => {
      console.log('[flutter-dart] Pub Get');
      if (api.terminal && api.terminal.sendToActive) {
        await api.terminal.sendToActive('flutter pub get');
      }
    });
  }

  console.log('[flutter-dart] Commands registered');

  // Settings tab
  if (api && api.settings?.updateTabContent) {
    api.settings.updateTabContent('flutter-dart.settings', {
      sections: [
        {
          title: 'Flutter',
          items: [
            { type: 'text', key: 'sdkPath', label: 'Flutter SDK Path', description: 'Path to Flutter SDK (empty = use $PATH)', placeholder: '/path/to/flutter', defaultValue: '' },
            { type: 'toggle', key: 'enableHotReloadOnSave', label: 'Hot Reload on Save', description: 'Automatically trigger hot reload on .dart file save', defaultValue: true },
          ],
        },
        {
          title: 'Dart',
          items: [
            { type: 'number', key: 'lineLength', label: 'Line Length', description: 'Max line length for Dart formatting', defaultValue: 80, min: 40, max: 200 },
            { type: 'toggle', key: 'enableLinting', label: 'Enable Linting', description: 'Enable Dart lint analysis', defaultValue: true },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[flutter-dart] Extension deactivated');
}
