// Angular Support Extension — main.js
// Provides runtime commands for Angular development

const NG_SCHEMATICS = [
  { label: 'Component', value: 'component' },
  { label: 'Service', value: 'service' },
  { label: 'Directive', value: 'directive' },
  { label: 'Pipe', value: 'pipe' },
  { label: 'Guard', value: 'guard' },
  { label: 'Interceptor', value: 'interceptor' },
  { label: 'Resolver', value: 'resolver' },
  { label: 'Module', value: 'module' },
  { label: 'Class', value: 'class' },
  { label: 'Interface', value: 'interface' },
  { label: 'Enum', value: 'enum' },
  { label: 'Library', value: 'library' },
];

export function activate(context) {
  console.log('[angular-support] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[angular-support] HysCode API not available');
    return;
  }

  if (!api.commands) return;

  // ── Helper: run Angular CLI command ─────────────────────────────────────────
  async function runNg(args) {
    if (api.terminal && api.terminal.sendToActive) {
      await api.terminal.sendToActive(`npx ng ${args}`);
    }
  }

  // ── New Component ───────────────────────────────────────────────────────────
  api.commands.register('angular.newComponent', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Component name',
      placeHolder: 'my-component',
    });
    if (!name) return;

    const content = `import { Component } from '@angular/core';

@Component({
  selector: 'app-${name}',
  standalone: true,
  imports: [],
  template: \`
    <p>${name} works!</p>
  \`,
  styles: \`\`
})
export class ${toPascalCase(name)}Component {
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}/${name}.component.ts`, content);
    }
  });

  // ── New Service ─────────────────────────────────────────────────────────────
  api.commands.register('angular.newService', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Service name',
      placeHolder: 'my-service',
    });
    if (!name) return;

    const content = `import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ${toPascalCase(name)}Service {
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.service.ts`, content);
    }
  });

  // ── New Directive ───────────────────────────────────────────────────────────
  api.commands.register('angular.newDirective', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Directive name',
      placeHolder: 'highlight',
    });
    if (!name) return;

    const content = `import { Directive, ElementRef, inject } from '@angular/core';

@Directive({
  selector: '[app${toPascalCase(name)}]',
  standalone: true
})
export class ${toPascalCase(name)}Directive {
  private el = inject(ElementRef);
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.directive.ts`, content);
    }
  });

  // ── New Pipe ────────────────────────────────────────────────────────────────
  api.commands.register('angular.newPipe', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Pipe name',
      placeHolder: 'format-date',
    });
    if (!name) return;

    const camelName = toCamelCase(name);
    const content = `import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: '${camelName}',
  standalone: true
})
export class ${toPascalCase(name)}Pipe implements PipeTransform {
  transform(value: unknown, ...args: unknown[]): unknown {
    return value;
  }
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.pipe.ts`, content);
    }
  });

  // ── New Guard ───────────────────────────────────────────────────────────────
  api.commands.register('angular.newGuard', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Guard name',
      placeHolder: 'auth',
    });
    if (!name) return;

    const content = `import { CanActivateFn } from '@angular/router';

export const ${toCamelCase(name)}Guard: CanActivateFn = (route, state) => {
  // TODO: implement guard logic
  return true;
};
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.guard.ts`, content);
    }
  });

  // ── New Interceptor ─────────────────────────────────────────────────────────
  api.commands.register('angular.newInterceptor', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Interceptor name',
      placeHolder: 'auth',
    });
    if (!name) return;

    const content = `import { HttpInterceptorFn } from '@angular/common/http';

export const ${toCamelCase(name)}Interceptor: HttpInterceptorFn = (req, next) => {
  const modifiedReq = req.clone({
    setHeaders: {}
  });
  return next(modifiedReq);
};
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.interceptor.ts`, content);
    }
  });

  // ── New Angular Project ─────────────────────────────────────────────────────
  api.commands.register('angular.newProject', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Project name',
      placeHolder: 'my-angular-app',
    });
    if (!name) return;

    const style = await api.window?.showQuickPick?.([
      { label: 'SCSS', value: 'scss' },
      { label: 'CSS', value: 'css' },
      { label: 'Sass', value: 'sass' },
      { label: 'Less', value: 'less' },
    ], { placeHolder: 'Select stylesheet format' });

    const styleFlag = style ? ` --style ${style.value}` : '';
    await runNg(`new ${name} --standalone${styleFlag}`);
  });

  // ── Serve (Dev Server) ──────────────────────────────────────────────────────
  api.commands.register('angular.serve', async () => {
    console.log('[angular-support] Serve');
    await runNg('serve');
  });

  // ── Build ───────────────────────────────────────────────────────────────────
  api.commands.register('angular.build', async () => {
    const config = await api.window?.showQuickPick?.([
      { label: 'Development', value: 'development' },
      { label: 'Production', value: 'production' },
    ], { placeHolder: 'Build configuration' });
    if (!config) return;
    await runNg(`build --configuration ${config.value}`);
  });

  // ── Test ────────────────────────────────────────────────────────────────────
  api.commands.register('angular.test', async () => {
    console.log('[angular-support] Test');
    await runNg('test');
  });

  // ── Lint ────────────────────────────────────────────────────────────────────
  api.commands.register('angular.lint', async () => {
    console.log('[angular-support] Lint');
    await runNg('lint');
  });

  // ── Generate (ng generate) ──────────────────────────────────────────────────
  api.commands.register('angular.generate', async () => {
    const schematic = await api.window?.showQuickPick?.(
      NG_SCHEMATICS,
      { placeHolder: 'Select schematic to generate' }
    );
    if (!schematic) return;

    const name = await api.window?.showInputBox?.({
      prompt: `Name for the ${schematic.label}`,
      placeHolder: `my-${schematic.value}`,
    });
    if (!name) return;

    await runNg(`generate ${schematic.value} ${name}`);
  });

  // ── Add Package (ng add) ────────────────────────────────────────────────────
  api.commands.register('angular.addPackage', async () => {
    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package name (e.g. @angular/material)',
      placeHolder: '@angular/material',
    });
    if (!pkg) return;
    await runNg(`add ${pkg}`);
  });

  // ── Update Angular ──────────────────────────────────────────────────────────
  api.commands.register('angular.update', async () => {
    await runNg('update');
  });

  console.log('[angular-support] Commands registered');

  // Settings tab
  if (api && api.settings?.updateTabContent) {
    api.settings.updateTabContent('angular-support.settings', {
      sections: [
        {
          title: 'Components',
          items: [
            { type: 'select', key: 'defaultComponentStyle', label: 'Default Style', description: 'CSS preprocessor for new components', defaultValue: 'scss', options: [{ value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' }, { value: 'sass', label: 'Sass' }, { value: 'less', label: 'Less' }] },
            { type: 'toggle', key: 'standalone', label: 'Standalone by Default', description: 'Generate standalone components (Angular 19+)', defaultValue: true },
          ],
        },
        {
          title: 'CLI',
          items: [
            { type: 'text', key: 'cliPath', label: 'Angular CLI Path', description: 'Path to Angular CLI (empty = npx/global)', placeholder: '', defaultValue: '' },
          ],
        },
        {
          title: 'Snippets',
          items: [
            { type: 'toggle', key: 'snippets.enabled', label: 'Enable Snippets', description: 'Enable Angular code snippets', defaultValue: true },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[angular-support] Extension deactivated');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function toPascalCase(str) {
  return str
    .split(/[-_]+/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
