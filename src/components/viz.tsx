import { cn } from "@/lib/utils";

const TONE = { good: "bg-forest", mid: "bg-warning", bad: "bg-danger", neutral: "bg-sage" } as const;
export const viabilityTone = (v: number): keyof typeof TONE => (v >= 0.6 ? "good" : v >= 0.35 ? "mid" : "bad");

/** Thin solid horizontal indicator, 0..1. */
export function Meter({ value, tone = "good", label, className }: { value: number; tone?: keyof typeof TONE; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("h-1.5 w-full rounded-sm bg-softneutral", className)} role="img" aria-label={label ?? `${Math.round(v * 100)} percent`}>
      <div className={cn("h-full rounded-sm", TONE[tone])} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Voucher / direct-supply split as one solid bar: forest = vouchers, sage = direct supply. */
export function SplitBar({ voucherPct, className, showLabels = true }: { voucherPct: number; className?: string; showLabels?: boolean }) {
  const v = Math.max(0, Math.min(1, voucherPct));
  return (
    <div className={className}>
      <div className="flex h-2.5 overflow-hidden rounded-sm" role="img" aria-label={`${Math.round(v * 100)} percent vouchers, ${Math.round((1 - v) * 100)} percent direct supply`}>
        <div className="bg-forest" style={{ width: `${v * 100}%` }} />
        <div className="bg-sage" style={{ width: `${(1 - v) * 100}%` }} />
      </div>
      {showLabels && <div className="mt-1 flex justify-between text-[11px] text-secondary"><span><i className="mr-1 inline-block size-2 rounded-sm bg-forest align-baseline" />Vouchers {Math.round(v * 100)}%</span><span><i className="mr-1 inline-block size-2 rounded-sm bg-sage align-baseline" />Direct {Math.round((1 - v) * 100)}%</span></div>}
    </div>
  );
}

export const LegendSwatch = ({ color, children }: { color: string; children: React.ReactNode }) => <span className="inline-flex items-center gap-1.5 text-xs text-secondary"><i className="inline-block size-2.5 rounded-sm" style={{ background: color }} />{children}</span>;
