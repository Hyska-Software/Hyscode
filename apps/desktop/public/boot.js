(function () {
  'use strict';

  var root = document.getElementById('root');

  if (!root) {
    return;
  }

  var messages = [
    'Loading HysCode',
    'Preparing HysCode',
    'Starting HysCode',
    'Opening HysCode',
  ];
  var messageIndex = 0;
  var messageTimer = null;

  var styles = document.createElement('style');
  styles.id = 'hyscode-boot-style';
  styles.textContent = [
    ':root { color-scheme: dark; }',
    'html, body { min-height: 100%; background: #18191d; }',
    'body { margin: 0; overflow: hidden; user-select: none; -webkit-user-select: none; background: #18191d; color: #ececf1; font-family: "Geist Sans", "Segoe UI", system-ui, sans-serif; }',
    '#root { min-height: 100vh; }',
    '[data-hyscode-boot-screen] { position: relative; box-sizing: border-box; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: #18191d; }',
    '[data-hyscode-boot-drag-region] { position: absolute; inset: 0 120px auto 0; height: 40px; cursor: default; }',
    '[data-hyscode-boot-window-controls] { position: absolute; top: 0; right: 0; display: flex; align-items: flex-start; }',
    '[data-hyscode-boot-window-button] { appearance: none; display: grid; width: 36px; height: 32px; place-items: center; border: 0; border-radius: 0; color: rgba(236, 236, 241, 0.62); background: transparent; cursor: pointer; transition: background 160ms ease, color 160ms ease, transform 160ms ease; }',
    '[data-hyscode-boot-window-button]:hover { color: #ececf1; background: rgba(236, 236, 241, 0.10); }',
    '[data-hyscode-boot-window-button]:active { transform: scale(0.94); }',
    '[data-hyscode-boot-window-button]:focus-visible { outline: 2px solid #7de2c7; outline-offset: -3px; }',
    '[data-hyscode-boot-window-button="close"]:hover { color: #ffffff; background: #c94b4b; }',
    '[data-hyscode-boot-title] { margin: 0; color: #ececf1; font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }',
    '[data-hyscode-boot-track] { position: relative; width: min(240px, calc(100vw - 48px)); height: 3px; overflow: hidden; border-radius: 999px; background: rgba(236, 236, 241, 0.12); }',
    '[data-hyscode-boot-bar] { position: absolute; top: 0; bottom: 0; left: 0; width: 36%; border-radius: 999px; background: #10a37f; animation: hyscode-boot-progress 1.25s cubic-bezier(0.4, 0, 0.2, 1) infinite; will-change: transform; }',
    '@keyframes hyscode-boot-progress { 0% { transform: translateX(-140%); } 100% { transform: translateX(390%); } }',
    '@media (prefers-reduced-motion: reduce) { [data-hyscode-boot-bar] { animation: none; opacity: 0.7; transform: translateX(0); } }',
  ].join('');
  document.head.appendChild(styles);

  function createElement(tagName, attributes, text) {
    var element = document.createElement(tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      element.setAttribute(name, attributes[name]);
    });
    if (text) {
      element.textContent = text;
    }
    return element;
  }

  function renderLoading() {
    var screen = createElement('main', {
      'data-hyscode-boot-screen': '',
      role: 'status',
      'aria-live': 'polite',
      'aria-busy': 'true',
    });
    var dragRegion = createElement('header', {
      'data-hyscode-boot-drag-region': '',
      'data-tauri-drag-region': '',
      'aria-hidden': 'true',
    });
    var controls = createElement('div', {
      'data-hyscode-boot-window-controls': '',
      role: 'group',
      'aria-label': 'Window controls',
    });
    var title = createElement('p', { 'data-hyscode-boot-title': '' }, messages[messageIndex]);
    var track = createElement('div', { 'data-hyscode-boot-track': '', 'aria-hidden': 'true' });
    track.appendChild(createElement('span', { 'data-hyscode-boot-bar': '' }));
    screen.appendChild(dragRegion);
    screen.appendChild(controls);
    screen.appendChild(title);
    screen.appendChild(track);
    root.appendChild(screen);

    messageTimer = window.setInterval(function () {
      messageIndex = (messageIndex + 1) % messages.length;
      title.textContent = messages[messageIndex];
    }, 1600);
  }

  window.__hyscodeBoot = {
    ready: function () {
      if (messageTimer !== null) {
        window.clearInterval(messageTimer);
        messageTimer = null;
      }
      var loading = root.querySelector('[data-hyscode-boot-screen]');
      if (loading) {
        window.dispatchEvent(new CustomEvent('hyscode:boot-ready'));
        loading.remove();
      }
    },
  };

  renderLoading();
})();
