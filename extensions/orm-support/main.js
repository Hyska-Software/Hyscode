// ORM Support — main.js
// Commands for Prisma and Drizzle ORM workflows

const PRISMA_PROVIDERS = [
  { label: 'PostgreSQL', value: 'postgresql' },
  { label: 'MySQL', value: 'mysql' },
  { label: 'SQLite', value: 'sqlite' },
  { label: 'SQL Server', value: 'sqlserver' },
  { label: 'MongoDB', value: 'mongodb' },
  { label: 'CockroachDB', value: 'cockroachdb' },
];

const DRIZZLE_DRIVERS = [
  { label: 'PostgreSQL (pg)', value: 'pg' },
  { label: 'MySQL (mysql2)', value: 'mysql2' },
  { label: 'SQLite (better-sqlite3)', value: 'better-sqlite3' },
  { label: 'LibSQL / Turso', value: 'libsql' },
  { label: 'Neon (HTTP)', value: 'neon-http' },
  { label: 'PlanetScale', value: 'planetscale' },
];

const DRIZZLE_DB_TYPES = [
  { label: 'PostgreSQL (pgTable)', value: 'pg' },
  { label: 'MySQL (mysqlTable)', value: 'mysql' },
  { label: 'SQLite (sqliteTable)', value: 'sqlite' },
];

export function activate(context) {
  console.log('[orm-support] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api || !api.commands) {
    console.warn('[orm-support] HysCode API not available');
    return;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function runCmd(cmd) {
    if (api.terminal && api.terminal.sendToActive) {
      await api.terminal.sendToActive(cmd);
    }
  }

  function prismaCmd() {
    return api.configuration?.get?.('prisma.binaryPath') || 'npx prisma';
  }

  function drizzleCmd() {
    return api.configuration?.get?.('drizzle.binaryPath') || 'npx drizzle-kit';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRISMA COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── prisma init ────────────────────────────────────────────────────────────
  api.commands.register('prisma.init', async () => {
    const provider = await api.window?.showQuickPick?.(PRISMA_PROVIDERS, {
      placeHolder: 'Select database provider',
    });
    if (!provider) return;
    await runCmd(`${prismaCmd()} init --datasource-provider ${provider}`);
    api.notifications?.info?.('Prisma initialized with ' + provider);
  });

  // ── prisma generate ────────────────────────────────────────────────────────
  api.commands.register('prisma.generate', async () => {
    await runCmd(`${prismaCmd()} generate`);
    api.notifications?.info?.('Prisma Client generated');
  });

  // ── prisma migrate dev ─────────────────────────────────────────────────────
  api.commands.register('prisma.migrate.dev', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Migration name',
      placeHolder: 'e.g. add_users_table',
    });
    if (!name) return;
    await runCmd(`${prismaCmd()} migrate dev --name ${name}`);
  });

  // ── prisma migrate deploy ──────────────────────────────────────────────────
  api.commands.register('prisma.migrate.deploy', async () => {
    await runCmd(`${prismaCmd()} migrate deploy`);
  });

  // ── prisma migrate reset ───────────────────────────────────────────────────
  api.commands.register('prisma.migrate.reset', async () => {
    const confirm = await api.window?.showQuickPick?.([
      { label: 'Yes — reset database', value: 'yes' },
      { label: 'Cancel', value: 'no' },
    ], { placeHolder: 'This will erase all data. Confirm?' });
    if (confirm !== 'yes') return;
    await runCmd(`${prismaCmd()} migrate reset --force`);
    api.notifications?.warn?.('Database reset complete');
  });

  // ── prisma migrate status ──────────────────────────────────────────────────
  api.commands.register('prisma.migrate.status', async () => {
    await runCmd(`${prismaCmd()} migrate status`);
  });

  // ── prisma db push ─────────────────────────────────────────────────────────
  api.commands.register('prisma.db.push', async () => {
    await runCmd(`${prismaCmd()} db push`);
    api.notifications?.info?.('Schema pushed to database');
  });

  // ── prisma db pull ─────────────────────────────────────────────────────────
  api.commands.register('prisma.db.pull', async () => {
    await runCmd(`${prismaCmd()} db pull`);
    api.notifications?.info?.('Database schema pulled into Prisma schema');
  });

  // ── prisma db seed ─────────────────────────────────────────────────────────
  api.commands.register('prisma.db.seed', async () => {
    await runCmd(`${prismaCmd()} db seed`);
  });

  // ── prisma studio ──────────────────────────────────────────────────────────
  api.commands.register('prisma.studio', async () => {
    await runCmd(`${prismaCmd()} studio`);
    api.notifications?.info?.('Prisma Studio opening on port 5555...');
  });

  // ── prisma format ──────────────────────────────────────────────────────────
  api.commands.register('prisma.format', async () => {
    await runCmd(`${prismaCmd()} format`);
    api.notifications?.info?.('Prisma schema formatted');
  });

  // ── prisma validate ────────────────────────────────────────────────────────
  api.commands.register('prisma.validate', async () => {
    await runCmd(`${prismaCmd()} validate`);
  });

  // ── scaffold prisma model ──────────────────────────────────────────────────
  api.commands.register('prisma.newModel', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Model name (PascalCase)',
      placeHolder: 'e.g. User',
    });
    if (!name) return;

    const snippet = [
      `model ${name} {`,
      `  id        String   @id @default(cuid())`,
      `  createdAt DateTime @default(now())`,
      `  updatedAt DateTime @updatedAt`,
      ``,
      `  // Add your fields here`,
      `}`,
    ].join('\n');

    if (api.editor?.insertSnippet) {
      await api.editor.insertSnippet(snippet);
    } else {
      api.notifications?.info?.('Model scaffold copied – paste it into your schema.prisma');
    }
  });

  // ── scaffold prisma enum ───────────────────────────────────────────────────
  api.commands.register('prisma.newEnum', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Enum name (PascalCase)',
      placeHolder: 'e.g. Role',
    });
    if (!name) return;

    const snippet = [
      `enum ${name} {`,
      `  VALUE_ONE`,
      `  VALUE_TWO`,
      `}`,
    ].join('\n');

    if (api.editor?.insertSnippet) {
      await api.editor.insertSnippet(snippet);
    } else {
      api.notifications?.info?.('Enum scaffold ready – paste into your schema.prisma');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  DRIZZLE COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── drizzle init ───────────────────────────────────────────────────────────
  api.commands.register('drizzle.init', async () => {
    const driver = await api.window?.showQuickPick?.(DRIZZLE_DRIVERS, {
      placeHolder: 'Select database driver',
    });
    if (!driver) return;

    // Generate a minimal drizzle.config.ts via terminal
    const config = [
      `import { defineConfig } from 'drizzle-kit';`,
      ``,
      `export default defineConfig({`,
      `  dialect: '${driver === 'pg' || driver === 'neon-http' ? 'postgresql' : driver === 'mysql2' || driver === 'planetscale' ? 'mysql' : 'sqlite'}',`,
      `  schema: './src/db/schema',`,
      `  out: './drizzle',`,
      `});`,
    ].join('\n');

    // Try inserting into a new file, or show it
    if (api.editor?.insertSnippet) {
      await api.editor.insertSnippet(config);
    }
    await runCmd(`npm install drizzle-orm drizzle-kit ${driver}`);
    api.notifications?.info?.('Drizzle initialized with ' + driver + ' driver');
  });

  // ── drizzle generate ───────────────────────────────────────────────────────
  api.commands.register('drizzle.generate', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Migration name (optional)',
      placeHolder: 'e.g. add_users',
    });
    const nameArg = name ? ` --name ${name}` : '';
    await runCmd(`${drizzleCmd()} generate${nameArg}`);
    api.notifications?.info?.('Drizzle migrations generated');
  });

  // ── drizzle migrate ────────────────────────────────────────────────────────
  api.commands.register('drizzle.migrate', async () => {
    await runCmd(`${drizzleCmd()} migrate`);
    api.notifications?.info?.('Drizzle migrations applied');
  });

  // ── drizzle push ───────────────────────────────────────────────────────────
  api.commands.register('drizzle.push', async () => {
    await runCmd(`${drizzleCmd()} push`);
    api.notifications?.info?.('Schema pushed to database');
  });

  // ── drizzle pull ───────────────────────────────────────────────────────────
  api.commands.register('drizzle.pull', async () => {
    await runCmd(`${drizzleCmd()} pull`);
    api.notifications?.info?.('Database schema pulled into Drizzle');
  });

  // ── drizzle drop ───────────────────────────────────────────────────────────
  api.commands.register('drizzle.drop', async () => {
    const confirm = await api.window?.showQuickPick?.([
      { label: 'Yes — drop migration', value: 'yes' },
      { label: 'Cancel', value: 'no' },
    ], { placeHolder: 'Drop the latest migration?' });
    if (confirm !== 'yes') return;
    await runCmd(`${drizzleCmd()} drop`);
  });

  // ── drizzle studio ─────────────────────────────────────────────────────────
  api.commands.register('drizzle.studio', async () => {
    await runCmd(`${drizzleCmd()} studio`);
    api.notifications?.info?.('Drizzle Studio opening...');
  });

  // ── drizzle check ──────────────────────────────────────────────────────────
  api.commands.register('drizzle.check', async () => {
    await runCmd(`${drizzleCmd()} check`);
  });

  // ── scaffold drizzle table ─────────────────────────────────────────────────
  api.commands.register('drizzle.newTable', async () => {
    const dbType = await api.window?.showQuickPick?.(DRIZZLE_DB_TYPES, {
      placeHolder: 'Select database dialect for table definition',
    });
    if (!dbType) return;

    const tableName = await api.window?.showInputBox?.({
      prompt: 'Table name (snake_case)',
      placeHolder: 'e.g. users',
    });
    if (!tableName) return;

    let snippet;
    if (dbType === 'pg') {
      snippet = [
        `import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';`,
        ``,
        `export const ${tableName} = pgTable('${tableName}', {`,
        `  id: uuid('id').defaultRandom().primaryKey(),`,
        `  createdAt: timestamp('created_at').defaultNow().notNull(),`,
        `  updatedAt: timestamp('updated_at').defaultNow().notNull(),`,
        `  // Add your columns here`,
        `});`,
      ].join('\n');
    } else if (dbType === 'mysql') {
      snippet = [
        `import { mysqlTable, varchar, timestamp, int } from 'drizzle-orm/mysql-core';`,
        ``,
        `export const ${tableName} = mysqlTable('${tableName}', {`,
        `  id: int('id').autoincrement().primaryKey(),`,
        `  createdAt: timestamp('created_at').defaultNow().notNull(),`,
        `  updatedAt: timestamp('updated_at').defaultNow().notNull(),`,
        `  // Add your columns here`,
        `});`,
      ].join('\n');
    } else {
      snippet = [
        `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';`,
        ``,
        `export const ${tableName} = sqliteTable('${tableName}', {`,
        `  id: integer('id').primaryKey({ autoIncrement: true }),`,
        `  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),`,
        `  // Add your columns here`,
        `});`,
      ].join('\n');
    }

    if (api.editor?.insertSnippet) {
      await api.editor.insertSnippet(snippet);
    } else {
      api.notifications?.info?.('Table scaffold ready');
    }
  });

  // ── new drizzle schema file ────────────────────────────────────────────────
  api.commands.register('drizzle.newSchema', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Schema file name (without extension)',
      placeHolder: 'e.g. users',
    });
    if (!name) return;

    const dbType = await api.window?.showQuickPick?.(DRIZZLE_DB_TYPES, {
      placeHolder: 'Database dialect',
    });
    if (!dbType) return;

    const dialectImport = dbType === 'pg'
      ? `import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';`
      : dbType === 'mysql'
        ? `import { mysqlTable, varchar, timestamp, int } from 'drizzle-orm/mysql-core';`
        : `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';`;

    const content = [
      dialectImport,
      ``,
      `// Define your ${name} tables here`,
      ``,
    ].join('\n');

    if (api.editor?.insertSnippet) {
      await api.editor.insertSnippet(content);
    }
    api.notifications?.info?.(`Schema file ${name}.ts scaffold ready`);
  });

  // ── ORM selector ───────────────────────────────────────────────────────────
  api.commands.register('orm.selectORM', async () => {
    const choice = await api.window?.showQuickPick?.([
      { label: 'Prisma', value: 'prisma', description: 'Type-safe ORM with visual studio & migrations' },
      { label: 'Drizzle', value: 'drizzle', description: 'Lightweight TypeScript ORM with SQL-like syntax' },
    ], { placeHolder: 'Select your default ORM' });
    if (!choice) return;
    if (api.configuration?.update) {
      await api.configuration.update('orm.defaultORM', choice);
    }
    api.notifications?.info?.('Default ORM set to ' + choice);
  });

  // Settings tab
  if (api.settings?.updateTabContent) {
    api.settings.updateTabContent('orm-support.settings', {
      sections: [
        {
          title: 'General',
          items: [
            { type: 'select', key: 'defaultORM', label: 'Default ORM', description: 'ORM used for scaffolding commands', defaultValue: 'prisma', options: [{ value: 'prisma', label: 'Prisma' }, { value: 'drizzle', label: 'Drizzle' }] },
          ],
        },
        {
          title: 'Prisma',
          items: [
            { type: 'text', key: 'prisma.binaryPath', label: 'Prisma CLI', description: 'Command to invoke the Prisma CLI', placeholder: 'npx prisma', defaultValue: 'npx prisma' },
            { type: 'select', key: 'prisma.defaultProvider', label: 'Database Provider', description: 'Default provider for prisma init', defaultValue: 'postgresql', options: [{ value: 'postgresql', label: 'PostgreSQL' }, { value: 'mysql', label: 'MySQL' }, { value: 'sqlite', label: 'SQLite' }, { value: 'sqlserver', label: 'SQL Server' }, { value: 'mongodb', label: 'MongoDB' }] },
          ],
        },
        {
          title: 'Drizzle',
          items: [
            { type: 'text', key: 'drizzle.binaryPath', label: 'Drizzle Kit CLI', description: 'Command to invoke Drizzle Kit', placeholder: 'npx drizzle-kit', defaultValue: 'npx drizzle-kit' },
            { type: 'text', key: 'drizzle.schemaDir', label: 'Schema Directory', description: 'Directory for Drizzle schema files', placeholder: 'src/db/schema', defaultValue: 'src/db/schema' },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[orm-support] Extension deactivated');
}
