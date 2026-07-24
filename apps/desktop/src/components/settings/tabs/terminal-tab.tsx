import { useSettingsStore } from '../../../stores';
import type { TerminalCursorStyle } from '../../../stores/settings-store';

export function TerminalTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      <Section title="Font">
        <Row label="Font Family">
          <TextInput
            value={store.terminalFontFamily}
            onChange={(v) => store.set('terminalFontFamily', v)}
            placeholder="Geist Mono"
          />
        </Row>
        <Row label="Font Size">
          <NumberInput
            value={store.terminalFontSize}
            onChange={(v) => store.set('terminalFontSize', v)}
            min={8}
            max={24}
          />
        </Row>
      </Section>

      <Section title="Behavior">
        <Row label="Scrollback Lines">
          <NumberInput
            value={store.terminalScrollback}
            onChange={(v) => store.set('terminalScrollback', v)}
            min={100}
            max={10000}
            step={100}
          />
        </Row>
        <Row label="Cursor Style">
          <SelectInput<TerminalCursorStyle>
            value={store.terminalCursorStyle}
            onChange={(v) => store.set('terminalCursorStyle', v)}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
              { value: 'bar', label: 'Bar' },
            ]}
          />
        </Row>
        <Row label="Default Shell">
          <TextInput
            value={store.terminalShell}
            onChange={(v) => store.set('terminalShell', v)}
            placeholder="System default"
          />
        </Row>
      </Section>

      {/* Preview */}
      <Section title="Preview">
        <div
          className="overflow-hidden rounded-lg bg-background p-3"
          style={{
            fontFamily: store.terminalFontFamily || 'Geist Mono',
            fontSize: `${store.terminalFontSize}px`,
          }}
        >
          <div className="text-muted-foreground">
            <span className="text-success">user@machine</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-primary">~/project</span>
            <span className="text-muted-foreground">$ </span>
            <span className="text-foreground">echo "Hello World"</span>
          </div>
          <div className="text-foreground">Hello World</div>
          <div className="text-muted-foreground">
            <span className="text-success">user@machine</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-primary">~/project</span>
            <span className="text-muted-foreground">$ </span>
            <span
              className={`inline-block ${
                store.terminalCursorStyle === 'block'
                  ? 'bg-foreground text-background px-[1px]'
                  : store.terminalCursorStyle === 'underline'
                    ? 'border-b-2 border-foreground'
                    : 'border-l-2 border-foreground'
              }`}
            >
              &nbsp;
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── Shared atoms ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <span className="text-[12px] text-foreground">{label}</span>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-7 w-44 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted primary-primary"
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 rounded-md bg-muted px-2 text-[12px] text-foreground outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
