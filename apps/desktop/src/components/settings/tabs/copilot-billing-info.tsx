// ─── GitHub Copilot Billing Info ─────────────────────────────────────────────
// Explains premium request multipliers so users know the cost per chat.
// Data sourced from: https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-multipliers
// Plans sourced from: https://docs.github.com/en/copilot/get-started/plans

import { useState } from 'react';
import { Info, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

// ─── Data ────────────────────────────────────────────────────────────────────

interface Plan {
  name: string;
  price: string;
  requests: number;
}

const PLANS: Plan[] = [
  { name: 'Free',       price: 'grátis',    requests: 50    },
  { name: 'Pro',        price: '$10/mês',   requests: 300   },
  { name: 'Pro+',       price: '$39/mês',   requests: 1_500 },
  { name: 'Business',   price: '$19/seat',  requests: 300   },
  { name: 'Enterprise', price: '$39/seat',  requests: 1_000 },
];

interface ModelTier {
  label: string;
  multiplier: number;
  note?: string;
}

const MODEL_TIERS: ModelTier[] = [
  {
    label: 'GPT-4.1, GPT-4o, GPT-5 mini, Raptor mini',
    multiplier: 0,
  },
  {
    label: 'Grok Code Fast 1',
    multiplier: 0.25,
  },
  {
    label: 'Claude Haiku 4.5 · Gemini 3 Flash · GPT-5.4 mini',
    multiplier: 0.33,
  },
  {
    label: 'Claude Sonnet 4/4.5/4.6 · Gemini 2.5/3.1 Pro · GPT-5.2/5.3/5.4',
    multiplier: 1,
  },
  {
    label: 'Claude Opus 4.5 · Claude Opus 4.6',
    multiplier: 3,
  },
  {
    label: 'Claude Opus 4.7',
    multiplier: 7.5,
    note: 'Promoção até 30 abr/2026',
  },
  {
    label: 'Claude Opus 4.6 (fast mode)',
    multiplier: 30,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chatsForPlan(requests: number, multiplier: number): string {
  if (multiplier === 0) return '∞';
  const chats = Math.floor(requests / multiplier);
  if (chats >= 1_000) return `${(chats / 1_000).toFixed(1)}k`;
  return String(chats);
}

function multiplierColor(multiplier: number): string {
  if (multiplier === 0)    return 'text-success';
  if (multiplier <= 0.33)  return 'text-emerald-400';
  if (multiplier === 1)    return 'text-foreground';
  if (multiplier <= 3)     return 'text-amber-400';
  return 'text-destructive';
}

function multiplierLabel(multiplier: number): string {
  if (multiplier === 0) return 'GRÁTIS';
  return `${multiplier}×`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CopilotBillingInfo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2.5 rounded-md border border-amber-500/25 bg-amber-500/5">
      {/* Always-visible notice */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/30"
      >
        <Info className="h-3 w-3 shrink-0 text-amber-500" />
        <span className="flex-1 text-[10px] text-muted-foreground">
          Usa <span className="text-amber-500 font-medium">premium requests</span> — alguns modelos consomem mais do que outros
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        }
      </button>

      {/* Expandable details */}
      {open && (
        <div className="border-t border-amber-500/20 px-2.5 py-2.5 flex flex-col gap-3">

          {/* Plan allowances */}
          <div>
            <p className="text-[10px] font-medium text-foreground mb-1.5">
              Requests inclusos por plano (por mês)
            </p>
            <div className="grid grid-cols-5 gap-1">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className="flex flex-col items-center rounded bg-muted/60 px-1 py-1.5 gap-0.5"
                >
                  <span className="text-[9px] font-medium text-foreground">{plan.name}</span>
                  <span className="text-[12px] font-bold text-foreground tabular-nums">
                    {plan.requests.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-[8px] text-muted-foreground">{plan.price}</span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1.5">
              Requests extras além do plano:{' '}
              <span className="text-foreground font-medium">$0,04 cada</span>
            </p>
          </div>

          {/* Model cost table */}
          <div>
            <p className="text-[10px] font-medium text-foreground mb-1.5">
              Custo por conversa · exemplo com plano Pro (300 req/mês)
            </p>
            <div className="flex flex-col divide-y divide-border/40">
              {MODEL_TIERS.map((tier) => (
                <div
                  key={tier.label}
                  className="flex items-center gap-2 py-1 first:pt-0 last:pb-0"
                >
                  {/* Multiplier badge */}
                  <div className="w-14 shrink-0">
                    <span
                      className={`text-[10px] font-mono font-bold ${multiplierColor(tier.multiplier)}`}
                    >
                      {multiplierLabel(tier.multiplier)}
                    </span>
                  </div>

                  {/* Model name + optional promo note */}
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {tier.label}
                    </span>
                    {tier.note && (
                      <span className="ml-1.5 text-[8px] text-amber-500 font-medium whitespace-nowrap">
                        {tier.note}
                      </span>
                    )}
                  </div>

                  {/* Chats with Pro (300 req) */}
                  <div className="w-16 shrink-0 text-right">
                    <span className="text-[10px] font-semibold text-foreground tabular-nums">
                      {chatsForPlan(300, tier.multiplier)}
                    </span>
                    <span className="text-[9px] text-muted-foreground"> chats</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer link */}
          <a
            href="https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-multipliers"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[9px] text-primary hover:underline w-fit"
          >
            <ExternalLink className="h-2.5 w-2.5" />
            Tabela completa de multiplicadores no GitHub Docs
          </a>
        </div>
      )}
    </div>
  );
}
