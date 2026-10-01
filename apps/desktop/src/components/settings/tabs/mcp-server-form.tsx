import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { tauriInvoke } from '@/lib/tauri-invoke';
import type { McpServerConfig } from '@/stores/settings-store';
import { SettingInput, SettingSegmented, SettingToggle } from '../controls';

interface McpServerFormProps {
  onSave: (server: McpServerConfig) => void | Promise<void>;
  onCancel: () => void;
}

export function McpServerForm({ onSave, onCancel }: McpServerFormProps) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'websocket'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [agentSafe, setAgentSafe] = useState(false);
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authSecret, setAuthSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (authSecret && transport !== 'sse') {
      setError('Secure HTTP header authentication is supported for SSE servers only.');
      return;
    }
    if (authSecret && !authHeaderName.trim()) {
      setError('Enter the HTTP header name for this credential.');
      return;
    }

    const id = crypto.randomUUID();
    const authSecretAccount = authSecret ? `mcp_${id.replaceAll('-', '')}` : undefined;
    const server: McpServerConfig = {
      id,
      name: name.trim(),
      transport,
      enabled: true,
      agentSafe,
      authSecretAccount,
      authHeaderName: authSecret ? authHeaderName.trim() : undefined,
    };

    if (transport === 'stdio') {
      server.command = command.trim();
      server.args = args
        .split(' ')
        .map((a) => a.trim())
        .filter(Boolean);
    } else if (transport === 'sse') {
      server.url = url.trim();
    } else {
      server.wsUrl = wsUrl.trim();
    }

    setSaving(true);
    setError(null);
    try {
      if (authSecret && authSecretAccount) {
        await tauriInvoke('keychain_set', {
          service: 'hyscode',
          account: authSecretAccount,
          password: authSecret,
        });
      }
      await onSave(server);
      setAuthSecret('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-2.5">
        {/* Name */}
        <Field label="Name">
          <SettingInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
            className="h-7 w-full"
          />
        </Field>

        {/* Transport */}
        <Field label="Transport">
          <SettingSegmented
            value={transport}
            onChange={setTransport}
            options={[
              { value: 'stdio', label: 'STDIO' },
              { value: 'sse', label: 'SSE' },
              { value: 'websocket', label: 'WS' },
            ]}
          />
        </Field>

        {/* Transport-specific fields */}
        {transport === 'stdio' ? (
          <>
            <Field label="Command">
              <SettingInput
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server"
                className="h-7 w-full"
              />
            </Field>
            <Field label="Arguments">
              <SettingInput
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--flag value"
                className="h-7 w-full"
              />
            </Field>
          </>
        ) : transport === 'sse' ? (
          <Field label="URL">
            <SettingInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3001/sse"
              className="h-7 w-full"
            />
          </Field>
        ) : (
          <Field label="WebSocket URL">
            <SettingInput
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://localhost:3001/ws"
              className="h-7 w-full"
            />
          </Field>
        )}

        {transport === 'sse' && (
          <>
            <Field label="Authentication header (optional)">
              <SettingInput
                value={authHeaderName}
                onChange={(event) => setAuthHeaderName(event.target.value)}
                placeholder="Authorization"
                className="h-7 w-full"
              />
            </Field>
            <Field label="Authentication secret (saved to OS credential store)">
              <SettingInput
                type="password"
                autoComplete="new-password"
                value={authSecret}
                onChange={(event) => setAuthSecret(event.target.value)}
                placeholder="Bearer token or API key"
                className="h-7 w-full"
              />
            </Field>
          </>
        )}

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <Field label="Sub-agent access">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <SettingToggle checked={agentSafe} onChange={setAgentSafe} />
            <span>Allow delegated agents to use this server</span>
          </div>
        </Field>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            className="h-7 px-3 text-[11px]"
          >
            Add Server
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 px-3 text-[11px]"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
