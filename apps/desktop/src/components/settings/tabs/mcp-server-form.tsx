import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { McpServerConfig } from '@/stores/settings-store';

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
    <div className="rounded-lg border border-surface-raised bg-background p-3">
      <div className="flex flex-col gap-2.5">
        {/* Name */}
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
            className="h-7 w-full rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </Field>

        {/* Transport */}
        <Field label="Transport">
          <div className="flex gap-1">
            {(['stdio', 'sse', 'websocket'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                  transport === t
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'websocket' ? 'WS' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </Field>

        {/* Transport-specific fields */}
        {transport === 'stdio' ? (
          <>
            <Field label="Command">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server"
                className="h-7 w-full rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </Field>
            <Field label="Arguments">
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--flag value"
                className="h-7 w-full rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </Field>
          </>
        ) : transport === 'sse' ? (
          <Field label="URL">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3001/sse"
              className="h-7 w-full rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </Field>
        ) : (
          <Field label="WebSocket URL">
            <input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://localhost:3001/ws"
              className="h-7 w-full rounded-md bg-muted px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
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
