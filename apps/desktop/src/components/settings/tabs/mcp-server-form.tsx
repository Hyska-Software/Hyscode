import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { McpServerConfig } from '@/stores/settings-store';
import { SettingInput, SettingSegmented } from '../controls';

interface McpServerFormProps {
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
}

export function McpServerForm({ onSave, onCancel }: McpServerFormProps) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'websocket'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [wsUrl, setWsUrl] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;

    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: name.trim(),
      transport,
      enabled: true,
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

    onSave(server);
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

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim()}
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
