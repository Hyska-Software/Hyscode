import { getCurrentWindow } from '@tauri-apps/api/window';

type IconKind = 'minimize' | 'maximize' | 'restore' | 'close';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const appendLine = (svg: SVGSVGElement, x1: string, y1: string, x2: string, y2: string): void => {
  const line = document.createElementNS(SVG_NAMESPACE, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  svg.appendChild(line);
};

const appendRect = (svg: SVGSVGElement, x: string, y: string, width: string, height: string): void => {
  const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', width);
  rect.setAttribute('height', height);
  svg.appendChild(rect);
};

const appendPath = (svg: SVGSVGElement, d: string): void => {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
};

const createIcon = (kind: IconKind): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  if (kind === 'minimize') {
    appendLine(svg, '5', '12', '19', '12');
  } else if (kind === 'maximize') {
    appendRect(svg, '5.5', '5.5', '13', '13');
  } else if (kind === 'restore') {
    appendRect(svg, '7', '7', '11', '11');
    appendPath(svg, 'M9 7V5h10v10h-2');
  } else {
    appendLine(svg, '6', '6', '18', '18');
    appendLine(svg, '18', '6', '6', '18');
  }

  return svg;
};

const createButton = (
  label: string,
  kind: IconKind,
  onClick: () => Promise<void>,
  variant?: 'close',
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.hyscodeBootWindowButton = variant ?? 'default';
  button.appendChild(createIcon(kind));
  button.addEventListener('click', () => {
    void onClick().catch((error: unknown) => {
      console.error(`Failed to ${label.toLowerCase()} window:`, error);
    });
  });
  return button;
};

const controls = document.querySelector<HTMLElement>('[data-hyscode-boot-window-controls]');

if (controls && '__TAURI_INTERNALS__' in window) {
  const appWindow = getCurrentWindow();
  let isMaximized = false;
  let unlistenResize: (() => void) | null = null;
  let disposed = false;

  const updateMaximizeButton = (): void => {
    const maximizeButton = controls.querySelector<HTMLButtonElement>('[data-hyscode-boot-window-button="maximize"]');
    if (!maximizeButton) return;

    const label = isMaximized ? 'Restore' : 'Maximize';
    maximizeButton.title = label;
    maximizeButton.setAttribute('aria-label', label);
    maximizeButton.replaceChildren(createIcon(isMaximized ? 'restore' : 'maximize'));
  };

  const refreshMaximizedState = async (): Promise<void> => {
    try {
      const maximized = await appWindow.isMaximized();
      if (!disposed) {
        isMaximized = maximized;
        updateMaximizeButton();
      }
    } catch (error: unknown) {
      console.error('Failed to read the window maximize state:', error);
    }
  };

  const minimize = (): Promise<void> => appWindow.minimize();
  const toggleMaximize = async (): Promise<void> => {
    await appWindow.toggleMaximize();
    await refreshMaximizedState();
  };
  const close = (): Promise<void> => appWindow.close();

  controls.append(
    createButton('Minimize', 'minimize', minimize),
    createButton('Maximize', 'maximize', toggleMaximize),
    createButton('Close', 'close', close, 'close'),
  );

  const handleBootReady = (): void => {
    disposed = true;
    unlistenResize?.();
    unlistenResize = null;
    window.removeEventListener('hyscode:boot-ready', handleBootReady);
  };

  window.addEventListener('hyscode:boot-ready', handleBootReady);

  void refreshMaximizedState();
  void appWindow
    .onResized(() => {
      void refreshMaximizedState();
    })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenResize = unlisten;
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to observe window resize events:', error);
    });
}
