import type { ReactNode } from 'react';
import { Button, Input, type InputProps, Select, Slider, Switch } from '@hyscode/ui';

/**
 * Aurora-styled settings controls.
 *
 * Centralizes the form controls used across every settings tab so the whole
 * settings surface stays visually consistent with the Aurora design system.
 * Each control wraps a canonical `@hyscode/ui` primitive (teal accent, neutral
 * surfaces, `ring-2 ring-ring` focus, `rounded-md`/`rounded-lg` radii).
 *
 * Tabs must import these instead of redefining local Section/Row/Toggle/
 * SelectInput/NumberInput helpers.
 */

export function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {description ? (
        <p className="-mt-1 mb-2 text-[10px] text-muted-foreground/80">{description}</p>
      ) : null}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  description,
  control,
  children,
}: {
  label: string;
  description?: string;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        {description ? (
          <span className="text-[10px] text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {control ?? children}
    </div>
  );
}

export function SettingInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-raised px-3 py-2.5">
      <span className="text-[12px] text-foreground">{label}</span>
      <span className="text-[11px] text-muted-foreground">{value}</span>
    </div>
  );
}

export function SettingToggle({
  checked,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
    />
  );
}

export function SettingSelect<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
  className,
  id,
  disabled,
  children,
}: {
  value: T;
  onChange: (v: T) => void;
  options?: { value: T; label: string }[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}
      size={size}
      className={className}
      id={id}
      disabled={disabled}
    >
      {options
        ? options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))
        : children}
    </Select>
  );
}

export function SettingSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}) {
  const display = step < 1 ? value.toFixed(1) : String(value);
  return (
    <div className="flex items-center gap-3">
      <Slider
        value={[value]}
        onValueChange={(vals) => onChange(vals[0])}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={className ?? 'w-40'}
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {display}
      </span>
    </div>
  );
}

export function SettingInput(props: InputProps) {
  return <Input size="sm" {...props} />;
}

export function SettingTextInput({
  value,
  onChange,
  placeholder,
  className,
  type,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <Input
      size="sm"
      type={type}
      value={value}
      placeholder={placeholder}
      className={className}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SettingPathInput({
  value,
  onChange,
  placeholder,
  onBrowse,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBrowse?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        size="sm"
        value={value}
        placeholder={placeholder}
        className="flex-1"
        onChange={(e) => onChange(e.target.value)}
      />
      {onBrowse && (
        <Button size="sm" variant="outline" type="button" onClick={onBrowse}>
          Browse
        </Button>
      )}
    </div>
  );
}

export function SettingSegmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
            value === opt.value
              ? 'bg-primary/15 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
