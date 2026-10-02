// ─── Model Info Tooltip ─────────────────────────────────────────────────────
// Hover card for the chat model selector: resolves model metadata
// automatically (registry → canonical catalog → harness profile) and renders
// pricing, context window, thinking levels and vision support. Renders inside
// the app's default inverted TooltipContent — only layout is customized here.

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatTokens, formatUsd, getModelDetails } from '@/lib/model-details';

type ModelInfoTooltipContentProps = {
  providerId: string;
  modelId: string;
  name: string;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full items-baseline justify-between gap-4">
      <span className="text-[11px] opacity-60">{label}</span>
      <span className="text-right text-[11px] font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function ModelInfoTooltipContent({
  providerId,
  modelId,
  name,
}: ModelInfoTooltipContentProps) {
  const details = useMemo(() => getModelDetails(providerId, modelId), [providerId, modelId]);

  const rows: Array<{ label: string; value: string }> = [];
  if (details.contextWindow != null) {
    rows.push({ label: 'Context window', value: formatTokens(details.contextWindow) });
  }
  if (details.maxOutputTokens != null) {
    rows.push({ label: 'Max output', value: formatTokens(details.maxOutputTokens) });
  }
  if (details.inputPricePerMToken != null) {
    rows.push({ label: 'Input', value: `${formatUsd(details.inputPricePerMToken)} / 1M` });
  }
  if (details.outputPricePerMToken != null) {
    rows.push({ label: 'Output', value: `${formatUsd(details.outputPricePerMToken)} / 1M` });
  }
  if (details.cachedInputPricePerMToken != null) {
    rows.push({ label: 'Cache', value: `${formatUsd(details.cachedInputPricePerMToken)} / 1M` });
  }
  if (details.thinkingLabel != null) {
    rows.push({ label: 'Thinking', value: details.thinkingLabel });
    if (details.thinkingDefault != null) {
      rows.push({ label: 'Default level', value: details.thinkingDefault });
    }
  }

  const hasRows = rows.length > 0;
  const hasVision = details.supportsVision != null;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold leading-tight">{name}</span>
        <span className="break-all text-[10px] leading-tight opacity-70">
          {details.providerName} · {modelId}
        </span>
      </div>
      <div className="h-px w-full bg-popover-foreground/20" />
      {hasRows ? (
        <div className="flex w-full flex-col gap-1">
          {rows.map((row) => (
            <DetailRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      ) : (
        <span className="text-[10px] italic opacity-60">No metadata available</span>
      )}
      {hasVision && (
        <span
          className={cn(
            'mt-0.5 inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
            details.supportsVision
              ? 'bg-popover-foreground/10'
              : 'bg-popover-foreground/5 opacity-60',
          )}
        >
          {details.supportsVision ? '✓ Vision' : '✗ No vision'}
        </span>
      )}
    </div>
  );
}
