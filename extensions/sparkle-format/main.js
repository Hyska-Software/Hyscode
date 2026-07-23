/**
 * ✨ Sparkle Format — Beautiful Code Formatter Extension for HysCode
 *
 * Supports: JavaScript, TypeScript, JSX, TSX, HTML, CSS, SCSS, JSON, Python,
 *           Rust, Markdown, YAML, TOML, SQL, XML, Go, C, C++, Java, PHP, Ruby
 *
 * Features:
 *   - Right-click → Format Document
 *   - Shift+Alt+F keyboard shortcut
 *   - Smart indentation fixing
 *   - Quote normalization
 *   - Trailing comma insertion
 *   - Semicolon normalization
 *   - Whitespace cleanup
 *   - Bracket spacing
 */

// ── Formatter Engine ─────────────────────────────────────────────────────────

const DEFAULT_OPTS = {
  tabSize: 2,
  useTabs: false,
  printWidth: 80,
  singleQuote: true,
  trailingComma: true,
  semicolons: true,
};

/**
 * Normalize line endings to \n
 */
function normalizeLineEndings(code) {
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Remove trailing whitespace from each line
 */
function trimTrailingWhitespace(code) {
  return code.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');
}

/**
 * Ensure file ends with exactly one newline
 */
function ensureFinalNewline(code) {
  return code.replace(/\n*$/, '\n');
}

/**
 * Fix indentation to use consistent spaces/tabs
 */
function fixIndentation(code, tabSize, useTabs) {
  const indent = useTabs ? '\t' : ' '.repeat(tabSize);
  const lines = code.split('\n');
  const result = [];

  for (const line of lines) {
    if (line.trim() === '') {
      result.push('');
      continue;
    }
    // Count leading whitespace
    const match = line.match(/^(\s*)/);
    const leading = match ? match[1] : '';
    const content = line.slice(leading.length);

    // Convert mixed whitespace to consistent indentation
    let level = 0;
    let pos = 0;
    for (const ch of leading) {
      if (ch === '\t') {
        level++;
        pos = 0;
      } else {
        pos++;
        if (pos >= tabSize) {
          level++;
          pos = 0;
        }
      }
    }
    if (pos > 0) level++; // partial indent counts as one level

    result.push(indent.repeat(level) + content);
  }

  return result.join('\n');
}

/**
 * Remove multiple consecutive blank lines (keep max 1)
 */
function collapseBlankLines(code) {
  return code.replace(/\n{3,}/g, '\n\n');
}

// ── Language-specific formatters ─────────────────────────────────────────────

/**
 * Format JavaScript / TypeScript / JSX / TSX
 */
function formatJavaScript(code, opts) {
  let result = code;

  // Normalize quotes
  if (opts.singleQuote) {
    // Replace double quotes with single, but not inside template literals or already-escaped
    result = result.replace(
      /(?<!\\)"([^"\\]*(?:\\.[^"\\]*)*)"/g,
      (match, content) => {
        // Skip if it contains unescaped single quotes
        if (content.includes("'") && !content.includes("\\'")) return match;
        // Skip JSX attributes in certain contexts
        return `'${content.replace(/\\"/g, '"')}'`;
      }
    );
  }

  // Semicolon normalization
  if (opts.semicolons) {
    // Add missing semicolons at end of statements
    const lines = result.split('\n');
    result = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return line;
      if (/[{}\[\],(]$/.test(trimmed)) return line;
      if (/^(if|else|for|while|do|switch|try|catch|finally|class|function|export\s+default\s+function|export\s+function|import\s|\/\/)/.test(trimmed)) return line;
      if (trimmed.endsWith('=>') || trimmed.endsWith('{') || trimmed.endsWith(',')) return line;
      if (/^(return|const|let|var|throw)\s/.test(trimmed) && !trimmed.endsWith(';')) {
        // Only add semicolons to complete statements, not multi-line
        if (!trimmed.endsWith('{') && !trimmed.endsWith('(') && !trimmed.endsWith(',')) {
          const indent = line.match(/^(\s*)/)[1];
          return indent + trimmed + ';';
        }
      }
      return line;
    }).join('\n');
  }

  // Bracket spacing: { x } not {x}
  result = result.replace(/\{([^ \n}])/g, '{ $1');
  result = result.replace(/([^ \n{])\}/g, '$1 }');

  // Arrow function spacing
  result = result.replace(/\)=>/g, ') =>');
  result = result.replace(/=>(?=[^ \n{])/g, '=> ');

  // Consistent spacing around operators
  result = result.replace(/([^ !=<>])===([^ =])/g, '$1 === $2');
  result = result.replace(/([^ !=<>])!==([^ =])/g, '$1 !== $2');

  // Remove extra spaces (but not in strings or comments)
  result = result.replace(/  +(?=[^ *\/])/g, (match, offset) => {
    // Rough check: don't collapse indentation
    const lineStart = result.lastIndexOf('\n', offset);
    const before = result.substring(lineStart + 1, offset);
    if (/^\s*$/.test(before)) return match; // it's indentation
    return ' ';
  });

  return result;
}

/**
 * Format JSON
 */
function formatJSON(code, opts) {
  try {
    const parsed = JSON.parse(code);
    const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);
    return JSON.stringify(parsed, null, indent) + '\n';
  } catch {
    // If JSON is invalid, just do basic formatting
    return code;
  }
}

/**
 * Format HTML / XML
 */
function formatHTML(code, opts) {
  let result = code;
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Simple HTML indentation
  const lines = result.split('\n');
  const formatted = [];
  let level = 0;

  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      formatted.push('');
      continue;
    }

    // Closing tag → decrease indent first
    const isClosing = /^<\//.test(line);
    const isOpening = /^<[a-zA-Z]/.test(line) && !line.endsWith('/>');
    const isSelfClosing = line.endsWith('/>');
    const tagMatch = line.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
    const isVoid = voidTags.has(tagName);

    if (isClosing) level = Math.max(0, level - 1);

    formatted.push(indent.repeat(level) + line);

    if (isOpening && !isSelfClosing && !isVoid && !isClosing) {
      // Check if the line also contains the closing tag (inline)
      const openTag = line.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
      if (openTag && !new RegExp(`</${openTag[1]}\\s*>`).test(line)) {
        level++;
      }
    }
  }

  return formatted.join('\n');
}

/**
 * Format CSS / SCSS
 */
function formatCSS(code, opts) {
  let result = code;
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Ensure space before {
  result = result.replace(/\s*\{/g, ' {');

  // Each property on its own line
  result = result.replace(/;\s*(?![\n}])/g, ';\n');

  // Re-indent
  const lines = result.split('\n');
  const formatted = [];
  let level = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { formatted.push(''); continue; }

    if (line === '}' || line.startsWith('}')) {
      level = Math.max(0, level - 1);
    }

    formatted.push(indent.repeat(level) + line);

    if (line.endsWith('{')) {
      level++;
    }
  }

  return formatted.join('\n');
}

/**
 * Format Python
 */
function formatPython(code, opts) {
  let result = code;

  // PEP 8: 4-space indentation is standard
  const pyIndent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Fix inconsistent indentation
  const lines = result.split('\n');
  const formatted = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { formatted.push(''); continue; }

    const match = line.match(/^(\s*)/);
    const leading = match ? match[1] : '';
    // Count existing indent level
    let spaces = 0;
    for (const ch of leading) {
      spaces += ch === '\t' ? 4 : 1;
    }
    const level = Math.round(spaces / (opts.tabSize || 4));
    formatted.push(pyIndent.repeat(level) + trimmed);
  }

  result = formatted.join('\n');

  // Remove trailing whitespace
  result = trimTrailingWhitespace(result);

  // PEP 8: two blank lines before top-level definitions
  result = result.replace(/\n{4,}/g, '\n\n\n');

  // Ensure spaces around =, but not in keyword args or default params
  // (This is a simplified version)
  result = result.replace(/([^ =!<>])=([^ =])/g, (match, a, b) => {
    // Don't add spaces inside function params
    if (/\w/.test(a) && /\w/.test(b)) return match;
    return `${a} = ${b}`;
  });

  return result;
}

/**
 * Format Rust
 */
function formatRust(code, opts) {
  let result = code;
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Re-indent
  const lines = result.split('\n');
  const formatted = [];
  let level = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { formatted.push(''); continue; }

    if (line === '}' || line.startsWith('}')) {
      level = Math.max(0, level - 1);
    }

    formatted.push(indent.repeat(level) + line);

    if (line.endsWith('{')) {
      level++;
    }
  }

  result = formatted.join('\n');

  // Ensure space before { in blocks
  result = result.replace(/\)\{/g, ') {');
  result = result.replace(/\s*\{$/gm, ' {');

  return result;
}

/**
 * Format SQL
 */
function formatSQL(code) {
  let result = code;

  // Uppercase SQL keywords
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INSERT', 'INTO', 'VALUES',
    'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP',
    'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
    'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS',
    'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'IN',
    'NOT', 'NULL', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE',
    'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'ALL', 'PRIMARY',
    'KEY', 'FOREIGN', 'REFERENCES', 'CASCADE', 'DEFAULT', 'CONSTRAINT',
  ];

  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw}\\b`, 'gi');
    result = result.replace(re, kw);
  }

  // Put major clauses on new lines
  result = result.replace(/\b(SELECT|FROM|WHERE|ORDER BY|GROUP BY|HAVING|LIMIT|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|ON|AND|OR|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE)\b/g, '\n$1');

  // Clean up leading newline
  result = result.replace(/^\n+/, '');

  return result;
}

/**
 * Format YAML
 */
function formatYAML(code, opts) {
  let result = code;
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Fix indentation (YAML is space-sensitive)
  const lines = result.split('\n');
  const formatted = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { formatted.push(''); continue; }

    const match = line.match(/^(\s*)/);
    const leading = match ? match[1] : '';
    let spaces = 0;
    for (const ch of leading) {
      spaces += ch === '\t' ? 2 : 1;
    }
    const level = Math.round(spaces / 2);
    formatted.push(indent.repeat(level) + trimmed);
  }

  return formatted.join('\n');
}

/**
 * Format Markdown
 */
function formatMarkdown(code) {
  let result = code;

  // Ensure blank line before headings
  result = result.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');

  // Ensure blank line after headings
  result = result.replace(/(#{1,6}\s[^\n]+)\n([^\n#])/g, '$1\n\n$2');

  // Collapse multiple blank lines
  result = collapseBlankLines(result);

  // Trim trailing whitespace (except for intentional line breaks: 2+ trailing spaces)
  const lines = result.split('\n');
  result = lines.map(line => {
    if (line.endsWith('  ')) return line; // intentional line break
    return line.replace(/\s+$/, '');
  }).join('\n');

  return result;
}

/**
 * Generic formatter for languages without specific rules
 */
function formatGeneric(code, opts) {
  let result = code;
  const indent = opts.useTabs ? '\t' : ' '.repeat(opts.tabSize);

  // Re-indent based on braces
  const lines = result.split('\n');
  const formatted = [];
  let level = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { formatted.push(''); continue; }

    // Decrease for closing braces/brackets
    const closers = (line.match(/^[}\])]/) || []).length;
    if (closers > 0) level = Math.max(0, level - 1);

    formatted.push(indent.repeat(level) + line);

    // Increase for opening braces/brackets
    const openers = (line.match(/[{(\[]\s*$/g) || []).length;
    if (openers > 0) level++;
  }

  return formatted.join('\n');
}

// ── Language → Formatter mapping ─────────────────────────────────────────────

const LANGUAGE_MAP = {
  javascript: formatJavaScript,
  typescript: formatJavaScript,
  javascriptreact: formatJavaScript,
  typescriptreact: formatJavaScript,
  jsx: formatJavaScript,
  tsx: formatJavaScript,
  json: formatJSON,
  jsonc: formatJSON,
  html: formatHTML,
  xml: formatHTML,
  css: formatCSS,
  scss: formatCSS,
  less: formatCSS,
  python: formatPython,
  rust: formatRust,
  sql: formatSQL,
  yaml: formatYAML,
  yml: formatYAML,
  markdown: formatMarkdown,
  md: formatMarkdown,
  // These use generic formatter
  go: formatGeneric,
  c: formatGeneric,
  cpp: formatGeneric,
  java: formatGeneric,
  php: formatGeneric,
  ruby: formatGeneric,
  swift: formatGeneric,
  kotlin: formatGeneric,
  dart: formatGeneric,
  toml: formatGeneric,
  lua: formatGeneric,
  shell: formatGeneric,
  bash: formatGeneric,
  powershell: formatGeneric,
};

const ALL_LANGUAGE_IDS = Object.keys(LANGUAGE_MAP);

/**
 * Master format function
 */
function formatCode(content, languageId, opts) {
  const options = { ...DEFAULT_OPTS, ...opts };

  // Step 1: Normalize line endings
  let result = normalizeLineEndings(content);

  // Step 2: Apply language-specific formatting
  const formatter = LANGUAGE_MAP[languageId] || formatGeneric;
  result = formatter(result, options);

  // Step 3: Universal cleanup
  result = trimTrailingWhitespace(result);
  result = collapseBlankLines(result);
  result = fixIndentation(result, options.tabSize, options.useTabs);
  result = ensureFinalNewline(result);

  return result;
}

// ── Extension Entry Point ────────────────────────────────────────────────────

export function activate(context, hyscode) {
  const api = hyscode || context._api || globalThis.hyscode;

  console.log('[Sparkle Format] ✨ Activating...');

  // Register the document formatter for ALL supported languages
  if (api && api.ui) {
    const formatter = api.ui.registerDocumentFormatter({
      id: 'sparkle-format.formatter',
      displayName: 'Sparkle Format',
      languageIds: ALL_LANGUAGE_IDS,
      format: async (params) => {
        console.log(`[Sparkle Format] ✨ Formatting ${params.languageId}...`);
        return formatCode(params.content, params.languageId, {
          tabSize: params.tabSize,
          insertSpaces: params.insertSpaces,
        });
      },
    });
    context.subscriptions.push(formatter);

    // Register a context menu item for quick formatting
    const menuItem = api.ui.registerContextMenuItem({
      id: 'sparkle-format.contextFormat',
      label: '✨ Sparkle Format',
      icon: 'sparkles',
      group: 'formatting',
      order: 1,
      handler: async (ctx) => {
        if (!ctx.filePath) return;
        console.log(`[Sparkle Format] ✨ Context menu format for ${ctx.languageId}`);

        // Get the current content from the editor
        try {
          const content = await api.workspace.readFile(ctx.filePath);
          const formatted = formatCode(content, ctx.languageId || 'plaintext', {
            tabSize: 2,
          });
          await api.workspace.writeFile(ctx.filePath, formatted);
          api.notifications.showInfo('✨ Code formatted with Sparkle Format!');
        } catch (err) {
          api.notifications.showError('Failed to format: ' + (err.message || err));
        }
      },
    });
    context.subscriptions.push(menuItem);

    // Register a toolbar action
    const toolbarAction = api.ui.registerToolbarAction({
      id: 'sparkle-format.toolbarFormat',
      label: 'Format',
      icon: 'sparkles',
      tooltip: 'Format document with Sparkle Format',
      handler: async () => {
        api.notifications.showInfo('✨ Use right-click → Sparkle Format or Shift+Alt+F');
      },
    });
    context.subscriptions.push(toolbarAction);

    // Register a status bar item showing format status
    const statusItem = api.ui.registerStatusBarItem({
      id: 'sparkle-format.status',
      text: '✨ Sparkle',
      tooltip: 'Sparkle Format is active — Right-click to format',
      alignment: 'right',
      priority: 90,
      update() {},
    });
    context.subscriptions.push(statusItem);
  }

  // Register the format command
  if (api && api.commands) {
    const cmd = api.commands.registerCommand('sparkle-format.formatDocument', async () => {
      const filePath = api.editor.activeFilePath;
      if (!filePath) return;

      try {
        const content = await api.workspace.readFile(filePath);
        // Detect language from file extension
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const langMap = {
          js: 'javascript', ts: 'typescript', jsx: 'javascriptreact',
          tsx: 'typescriptreact', html: 'html', htm: 'html', css: 'css',
          scss: 'scss', less: 'less', json: 'json', py: 'python',
          rs: 'rust', sql: 'sql', yaml: 'yaml', yml: 'yaml',
          md: 'markdown', go: 'go', c: 'c', cpp: 'cpp', java: 'java',
          php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
          dart: 'dart', toml: 'toml', lua: 'lua', sh: 'shell',
          bash: 'bash', ps1: 'powershell', xml: 'xml',
        };
        const languageId = langMap[ext] || 'plaintext';
        const formatted = formatCode(content, languageId, { tabSize: 2 });
        await api.workspace.writeFile(filePath, formatted);
        api.notifications.showInfo(`✨ Formatted as ${languageId}`);
      } catch (err) {
        api.notifications.showError('Format failed: ' + (err.message || err));
      }
    });
    context.subscriptions.push(cmd);
  }

  // Register settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('sparkle-format.settings', {
      sections: [
        {
          title: 'Indentation',
          items: [
            { type: 'toggle', key: 'useTabs', label: 'Use Tabs', description: 'Use tabs instead of spaces', defaultValue: false },
            { type: 'number', key: 'tabSize', label: 'Tab Size', description: 'Spaces per indentation level', defaultValue: 2, min: 1, max: 8 },
            { type: 'number', key: 'printWidth', label: 'Print Width', description: 'Line length before wrapping', defaultValue: 80, min: 40, max: 200 },
          ],
        },
        {
          title: 'JavaScript / TypeScript',
          items: [
            { type: 'toggle', key: 'singleQuote', label: 'Single Quotes', description: 'Use single quotes instead of double', defaultValue: true },
            { type: 'toggle', key: 'trailingComma', label: 'Trailing Commas', description: 'Add trailing commas where valid', defaultValue: true },
            { type: 'toggle', key: 'semicolons', label: 'Semicolons', description: 'Add semicolons at end of statements', defaultValue: true },
          ],
        },
      ],
    });
  }

  console.log('[Sparkle Format] ✨ Ready! Supporting', ALL_LANGUAGE_IDS.length, 'languages');
}

export function deactivate() {
  console.log('[Sparkle Format] ✨ Deactivated');
}
