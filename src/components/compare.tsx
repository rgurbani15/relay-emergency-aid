import { ArrowRight } from "lucide-react";
import type { AnalysisResult, CommunityDelta } from "@shared/engine";
import { Card, CardHeader } from "@/components/ui";
import { RiskBadge } from "@/components/domain";
import { cn, money, num, pct } from "@/lib/utils";

/** One row per community: viability, split, projected shortage and the dollar amounts. All values come straight from the engine. */
export function AllocationSummaryTable({ analysis }: { analysis: AnalysisResult }) {
  const t = analysis.totals;
  return (
    <Card>
      <CardHeader title="Allocation summary" subtitle={`Budget basis ${money(analysis.budgetCents - analysis.committedCents)} · recommended ${money(t.recommendedCents)} · unallocated ${money(t.unallocatedCents)}`} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <caption className="sr-only">Recommended allocation by community</caption>
          <thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{["Community", "Viability", "Vouchers", "Direct supply", "Projected shortage", "Recommended", "Est. procurement", "Unallocated supply funds"].map((h, i) => <th key={h} scope="col" className={cn("px-4 py-2 font-medium", i > 0 && "text-right")}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {analysis.communities.map((c) => (
              <tr key={c.communityId}>
                <th scope="row" className="px-4 py-2.5 font-medium text-ink">{c.name} <RiskBadge risk={c.risk} /></th>
                <td className="tabular px-4 py-2.5 text-right">{c.marketViability.toFixed(2)}</td>
                <td className="tabular px-4 py-2.5 text-right">{pct(c.voucherPct)}<span className="block text-xs text-muted">{money(c.voucherCents)}</span></td>
                <td className="tabular px-4 py-2.5 text-right">{pct(c.directPct)}<span className="block text-xs text-muted">{money(c.directCents)}</span></td>
                <td className="tabular px-4 py-2.5 text-right">{num(c.shortageUnits)} units<span className="block text-xs text-muted">{money(c.shortageValueCents)} est.</span></td>
                <td className="tabular px-4 py-2.5 text-right font-semibold text-navy">{money(c.recommendedCents)}</td>
                <td className="tabular px-4 py-2.5 text-right">{money(c.procurement.allocatedCents)}</td>
                <td className="tabular px-4 py-2.5 text-right">{money(c.procurement.unallocatedCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line bg-canvas font-semibold"><tr><th scope="row" className="px-4 py-2.5">Total</th><td /><td className="tabular px-4 py-2.5 text-right">{money(t.voucherCents)}</td><td className="tabular px-4 py-2.5 text-right">{money(t.directCents)}</td><td /><td className="tabular px-4 py-2.5 text-right">{money(t.recommendedCents)}</td><td className="tabular px-4 py-2.5 text-right">{money(analysis.communities.reduce((s, c) => s + c.procurement.allocatedCents, 0))}</td><td className="tabular px-4 py-2.5 text-right">{money(analysis.communities.reduce((s, c) => s + c.procurement.unallocatedCents, 0))}</td></tr></tfoot>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Procurement amounts are estimates from projected shortages and average unit costs. RELAY does not purchase supplies; plans require human approval.</p>
    </Card>
  );
}

const Side = ({ title, tone, v }: { title: string; tone: "before" | "after"; v: CommunityDelta["before"] }) => (
  <div className={cn("rounded-lg p-3", tone === "before" ? "bg-canvas" : "bg-teal-soft")}>
    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
      {[["Viability", v.viability.toFixed(2)], ["Vouchers", pct(v.voucherPct)], ["Direct supply", pct(1 - v.voucherPct)], ["Shortage", `${num(v.shortageUnits)} units`], ["Recommended", money(v.recommendedCents)], ["Voucher $", money(v.voucherCents)], ["Direct $", money(v.directCents)], ["Inventory cover", pct(v.inventoryCoverage)]].map(([k, x]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="tabular font-semibold text-ink">{x}</dd></div>)}
    </dl>
  </div>
);

/** Prominent original-vs-scenario comparison. Totals come from the two engine analyses; nothing is saved. */
export function BeforeAfterBoard({ comparison, baseline, adjusted, beforeLabel = "Baseline", afterLabel = "Simulated" }: { comparison: CommunityDelta[]; baseline: AnalysisResult; adjusted: AnalysisResult; beforeLabel?: string; afterLabel?: string }) {
  const dv = (a: number, b: number, f: (n: number) => string) => `${b - a >= 0 ? "+" : "−"}${f(Math.abs(b - a))}`;
  return (
    <div className="space-y-4" data-testid="before-after">
      <div className="grid gap-3 rounded-xl border border-line bg-warm p-4 sm:grid-cols-3">
        {[["Voucher funds", baseline.totals.voucherCents, adjusted.totals.voucherCents], ["Direct-supply funds", baseline.totals.directCents, adjusted.totals.directCents], ["Projected shortage (units)", baseline.communities.reduce((s, c) => s + c.shortageUnits, 0), adjusted.communities.reduce((s, c) => s + c.shortageUnits, 0)]].map(([k, a, b], i) => (
          <div key={k as string}><p className="text-xs text-muted">{k as string}</p><p className="tabular flex flex-wrap items-baseline gap-x-2 font-display text-[24px] font-medium text-evergreen">{i < 2 ? money(a as number) : num(a as number)}<ArrowRight className="size-4 self-center text-muted" aria-hidden /><span className={cn((b as number) !== (a as number) && "text-teal-dark")}>{i < 2 ? money(b as number) : num(b as number)}</span></p><p className="text-xs text-muted">{dv(a as number, b as number, (n) => (i < 2 ? money(n) : num(n)))}</p></div>
        ))}
      </div>
      {comparison.map((r) => (
        <div key={r.communityId} className="rounded-xl border border-line p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-navy">{r.name}</h4><div className="flex items-center gap-2"><RiskBadge risk={r.before.risk} /><ArrowRight className="size-4 text-muted" aria-hidden /><RiskBadge risk={r.after.risk} /></div></div>
          <div className="grid gap-3 md:grid-cols-2"><Side title={beforeLabel} tone="before" v={r.before} /><Side title={afterLabel} tone="after" v={r.after} /></div>
          <p className="mt-3 text-sm text-muted">{r.summary}</p>
        </div>
      ))}
    </div>
  );
}

/** Expandable methodology: shows the exact formulas from the backend. */
export function Methodology({ formulas, keys, title = "Methodology and assumptions" }: { formulas: Record<string, any>; keys: string[]; title?: string }) {
  const labels: Record<string, string> = { coverage: "Inventory coverage", merchantCoverage: "Merchant coverage and effective capacity", viability: "Market viability", voucherShare: "Voucher / direct split", priority: "Priority share", cap: "Eligible-need cap", distribution: "Budget distribution", procurement: "Direct-supply procurement (estimate)", forecast: "Demand forecast" };
  return (
    <details className="group rounded-xl border border-line bg-warm">
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-navy">{title}</summary>
      <div className="space-y-3 border-t border-line px-5 py-4 text-sm leading-relaxed text-muted">
        {keys.filter((k) => formulas[k]).map((k) => <div key={k}><p className="font-medium text-ink">{labels[k] ?? k}</p><p>{formulas[k]}</p></div>)}
        <p className="rounded-lg bg-canvas p-3 text-xs">{formulas.caveat}</p>
      </div>
    </details>
  );
}
