import { useSettingsStore } from '../../../stores';
import type {
  WordWrap,
  LineNumbers,
  CursorStyle,
  RenderWhitespace,
  AutoSave,
  AutoClosingBrackets,
  AutoClosingQuotes,
} from '../../../stores/settings-store';

export function EditorTab() {
  const store = useSettingsStore();

  return (
    <div className="flex flex-col gap-6">
      {/* Font */}
      <Section title="Font">
        <Row label="Font Family">
          <TextInput
            value={store.fontFamily}
            onChange={(v) => store.set('fontFamily', v)}
            placeholder="Geist Mono"
          />
        </Row>
        <Row label="Font Size">
          <NumberInput
            value={store.fontSize}
            onChange={(v) => store.set('fontSize', v)}
            min={8}
            max={32}
          />
        </Row>
        <Row label="Line Height">
          <NumberInput
            value={store.lineHeight}
            onChange={(v) => store.set('lineHeight', v)}
            min={1}
            max={3}
            step={0.1}
          />
        </Row>
      </Section>

      {/* Editing */}
      <Section title="Editing">
        <Row label="Tab Size">
          <NumberInput
            value={store.tabSize}
            onChange={(v) => store.set('tabSize', v)}
            min={1}
            max={8}
          />
        </Row>
        <Row label="Insert Spaces">
          <Toggle
            checked={store.insertSpaces}
            onChange={(v) => store.set('insertSpaces', v)}
          />
        </Row>
        <Row label="Word Wrap">
          <SelectInput<WordWrap>
            value={store.wordWrap}
            onChange={(v) => store.set('wordWrap', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
              { value: 'wordWrapColumn', label: 'Word Wrap Column' },
            ]}
          />
        </Row>
        <Row label="Cursor Style">
          <SelectInput<CursorStyle>
            value={store.cursorStyle}
            onChange={(v) => store.set('cursorStyle', v)}
            options={[
              { value: 'line', label: 'Line' },
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
            ]}
          />
        </Row>
        <Row label="Render Whitespace">
          <SelectInput<RenderWhitespace>
            value={store.renderWhitespace}
            onChange={(v) => store.set('renderWhitespace', v)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'boundary', label: 'Boundary' },
              { value: 'all', label: 'All' },
            ]}
          />
        </Row>
        <Row label="Auto Save">
          <SelectInput<AutoSave>
            value={store.autoSave}
            onChange={(v) => store.set('autoSave', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'afterDelay', label: 'After Delay' },
              { value: 'onFocusChange', label: 'On Focus Change' },
            ]}
          />
        </Row>
        {store.autoSave === 'afterDelay' && (
          <Row label="Auto Save Delay (ms)">
            <NumberInput
              value={store.autoSaveDelay}
              onChange={(v) => store.set('autoSaveDelay', v)}
              min={100}
              max={10000}
              step={100}
            />
          </Row>
        )}
      </Section>

      {/* Display */}
      <Section title="Display">
        <Row label="Line Numbers">
          <SelectInput<LineNumbers>
            value={store.lineNumbers}
            onChange={(v) => store.set('lineNumbers', v)}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
              { value: 'relative', label: 'Relative' },
            ]}
          />
        </Row>
        <Row label="Minimap">
          <Toggle
            checked={store.minimap}
            onChange={(v) => store.set('minimap', v)}
          />
        </Row>
        <Row label="Bracket Pair Colorization">
          <Toggle
            checked={store.bracketPairColorization}
            onChange={(v) => store.set('bracketPairColorization', v)}
          />
        </Row>
        <Row label="Scroll Beyond Last Line">
          <Toggle
            checked={store.scrollBeyondLastLine}
            onChange={(v) => store.set('scrollBeyondLastLine', v)}
          />
        </Row>
        <Row label="Smooth Scrolling">
          <Toggle
            checked={store.smoothScrolling}
            onChange={(v) => store.set('smoothScrolling', v)}
          />
        </Row>
        <Row label="Git Blame Inline">
          <Toggle
            checked={store.gitBlameInline}
            onChange={(v) => store.set('gitBlameInline', v)}
          />
        </Row>
      </Section>

      {/* Advanced */}
      <Section title="Advanced">
        <Row label="Auto Close Brackets">
          <SelectInput<AutoClosingBrackets>
            value={store.autoClosingBrackets}
            onChange={(v) => store.set('autoClosingBrackets', v)}
            options={[
              { value: 'languageDefined', label: 'Language Default' },
              { value: 'always', label: 'Always' },
              { value: 'beforeWhitespace', label: 'Before Whitespace' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </Row>
        <Row label="Auto Close Quotes">
          <SelectInput<AutoClosingQuotes>
            value={store.autoClosingQuotes}
            onChange={(v) => store.set('autoClosingQuotes', v)}
            options={[
              { value: 'languageDefined', label: 'Language Default' },
              { value: 'always', label: 'Always' },
              { value: 'beforeWhitespace', label: 'Before Whitespace' },
              { value: 'never', label: 'Never' },
            ]}
          />
        </Row>
        <Row label="Format on Paste">
          <Toggle
            checked={store.formatOnPaste}
            onChange={(v) => store.set('formatOnPaste', v)}
          />
        </Row>
        <Row label="Format on Type">
          <Toggle
            checked={store.formatOnType}
            onChange={(v) => store.set('formatOnType', v)}
          />
        </Row>
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
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted accent-accent"
      />
      <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
        {step < 1 ? value.toFixed(1) : value}
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

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-foreground transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
