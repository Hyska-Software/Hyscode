import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedKeyStore } from './config';
import { CliDataStore } from './data-store';
import { CliHost } from './host';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('CLI host adapter', () => {
  it('provides real filesystem, search, code execution, and process-session operations', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-host-'));
    temporaryDirectories.push(directory);
    const store = new CliDataStore(path.join(directory, 'data.json'));
    const keyStore = new SharedKeyStore(path.join(directory, 'keychain.json'));
    const host = new CliHost(directory, store, keyStore);

    await host.invoke('write_file', { path: path.join(directory, 'fixture.txt'), content: 'HYS_TUI_HOST_FIXTURE' });
    expect(await host.invoke<string>('read_file', { path: path.join(directory, 'fixture.txt') })).toBe('HYS_TUI_HOST_FIXTURE');
    expect(await host.invoke<unknown[]>('find_files', { root: directory, pattern: '*.txt' })).toContain('fixture.txt');
    const search = await host.invoke<Array<{ path: string; line_number: number }>>('search_files', { root: directory, query: 'HYS_TUI_HOST_FIXTURE' });
    expect(search[0]).toMatchObject({ path: 'fixture.txt', line_number: 1 });

    const execution = await host.invoke<{ stdout: string; exit_code: number }>('run_code', {
      language: 'javascript',
      code: 'process.stdout.write("HYS_TUI_CODE_EXECUTION")',
      cwd: directory,
    });
    expect(execution).toMatchObject({ stdout: 'HYS_TUI_CODE_EXECUTION', exit_code: 0 });

    const ptyId = await host.invoke<string>('pty_spawn', {
      id: 'fixture-process',
      shell: process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh',
      args: process.platform === 'win32' ? ['/d', '/c', 'echo HYS_TUI_PROCESS'] : ['-c', 'printf HYS_TUI_PROCESS'],
      cwd: directory,
    });
    try {
      let snapshot = await host.invoke<{ data: string; alive: boolean }>('pty_snapshot', { ptyId, afterSequence: 0 });
      for (let attempt = 0; attempt < 20 && snapshot.alive && !snapshot.data.includes('HYS_TUI_PROCESS'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        snapshot = await host.invoke<{ data: string; alive: boolean }>('pty_snapshot', { ptyId, afterSequence: 0 });
      }
      expect(snapshot.data).toContain('HYS_TUI_PROCESS');
      await host.invoke('pty_resize', { ptyId, cols: 100, rows: 36 });
    } finally {
      await host.invoke('pty_kill', { ptyId });
    }
    expect(await readFile(path.join(directory, 'fixture.txt'), 'utf8')).toBe('HYS_TUI_HOST_FIXTURE');
  });

  it('runs real workspace compiler diagnostics instead of returning a placeholder result', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-diagnostics-'));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, 'src'), { recursive: true });
    await writeFile(path.join(directory, 'Cargo.toml'), '[package]\nname = "hyscode_tui_diagnostics_fixture"\nversion = "0.1.0"\nedition = "2021"\n', 'utf8');
    await writeFile(path.join(directory, 'src', 'lib.rs'), 'pub fn broken() { let value: u32 = "not an integer"; let _ = value; }\n', 'utf8');
    const host = new CliHost(directory, new CliDataStore(path.join(directory, 'data.json')), new SharedKeyStore(path.join(directory, 'keychain.json')));

    const diagnostics = await host.invoke<Array<{ file: string; severity: string; source: string; message: string }>>('get_diagnostics', {});
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.source === 'rustc' && diagnostic.message.includes('mismatched types'))).toBe(true);
    expect(await host.invoke<Array<{ file: string }>>('get_diagnostics', { path: path.join(directory, 'src', 'lib.rs') })).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: path.join(directory, 'src', 'lib.rs') }),
    ]));
  });

  it('forwards PTY operations and events through an explicit remote host adapter', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hyscode-tui-remote-host-'));
    temporaryDirectories.push(directory);
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const host = new CliHost(
      directory,
      new CliDataStore(path.join(directory, 'data.json')),
      new SharedKeyStore(path.join(directory, 'keychain.json')),
      async (command, args) => {
        calls.push({ command, args });
        if (command === 'pty_spawn') return 'remote-terminal';
        if (command === 'pty_exists') return true;
        if (command === 'pty_snapshot') return { data: 'remote output', from_sequence: 1, to_sequence: 1, truncated: false, alive: true, exit_code: null };
        return undefined;
      },
    );
    const data: string[] = [];
    await host.listen('pty:data', (payload) => data.push(String((payload as { data?: unknown }).data ?? '')));

    expect(await host.invoke<string>('pty_spawn', { id: 'remote-terminal', cols: 80, rows: 24 })).toBe('remote-terminal');
    await host.invoke('pty_write', { ptyId: 'remote-terminal', data: 'echo remote' });
    await host.invoke('pty_resize', { ptyId: 'remote-terminal', cols: 120, rows: 40 });
    expect(await host.invoke<boolean>('pty_exists', { ptyId: 'remote-terminal' })).toBe(true);
    expect(await host.invoke('pty_snapshot', { ptyId: 'remote-terminal', afterSequence: 0 })).toMatchObject({ data: 'remote output' });
    await host.invoke('pty_interrupt', { ptyId: 'remote-terminal' });
    await host.invoke('pty_kill', { ptyId: 'remote-terminal' });
    host.emitExternal('pty:data', { pty_id: 'remote-terminal', data: 'forwarded event' });

    expect(calls.map((call) => call.command)).toEqual([
      'pty_spawn',
      'pty_write',
      'pty_resize',
      'pty_exists',
      'pty_snapshot',
      'pty_interrupt',
      'pty_kill',
    ]);
    expect(data).toEqual(['forwarded event']);
  });
});
