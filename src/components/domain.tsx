import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, ChevronDown, Info, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import type { CommunityAnalysis, CommunityDelta } from "@shared/engine";
import { categoryLabel } from "@shared/constants";
import { Badge, Button, Card, CardHeader, ProgressBar, StatusBadge } from "@/components/ui";
import { cn, fmtDateTime, money, num, pct } from "@/lib/utils";

/** Chart palette: solid brand colours only. forest = actual, sage = comparison, ochre/clay = attention. */
export const CHART = { teal: "#285B4B", navy: "#193D35", amber: "#C58A32", red: "#B94D45", blue: "#547A85", sage: "#879B83", moss: "#718A70", grid: "#DFE1D8", axis: "#646B63" };
export const axisProps = { stroke: CHART.axis, fontSize: 12, tickLine: false, axisLine: false } as const;

export function ChartCard({ title, subtitle, action, height = 260, children, footer }: { title: string; subtitle?: string; action?: ReactNode; height?: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="px-3 pb-3 pt-4 sm:px-5" style={{ height }}><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>
      {footer && <div className="border-t border-line px-5 py-3 text-xs text-muted">{footer}</div>}
    </Card>
  );
}

export const riskTone = (r: string) => (r === "critical" || r === "high" ? "danger" : r === "elevated" ? "warning" : "success") as "danger" | "warning" | "success";
export const RiskBadge = ({ risk }: { risk: string }) => <StatusBadge status={risk} label={`${risk[0].toUpperCase()}${risk.slice(1)} risk`} />;
export const viabilityTone = (v: number) => (v >= 0.6 ? "teal" : v >= 0.35 ? "warning" : "danger") as "teal" | "warning" | "danger";

export function InfoTip({ children }: { children: ReactNode }) {
  return <p className="flex gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs leading-relaxed text-[#2f5560]"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{children}</p>;
}

/** Collapsible “how was this calculated” block. */
export function Disclosure({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-lg border border-line">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{title}<ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} /></button>
      {open && <div className="border-t border-line px-4 py-3 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Community risk card used on the overview, communities list and the intelligence page. */
export function CommunityCard({ c, onClick }: { c: Pick<CommunityAnalysis, "name" | "marketViability" | "risk" | "populationNeeding" | "inventoryCoverage" | "operatingMerchants" | "participatingMerchants" | "actionLabel"> & { topGap?: { label: string; shortagePct: number } | null }; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("w-full rounded-card border border-line bg-warm p-4 text-left ", onClick && "transition-shadow hover:border-evergreen")}>
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-navy">{c.name}</h3><RiskBadge risk={c.risk} /></div>
      <div className="mt-3"><div className="mb-1 flex justify-between text-xs text-muted"><span>Market viability</span><span className="tabular font-semibold text-ink">{c.marketViability.toFixed(2)}</span></div><ProgressBar value={c.marketViability} tone={viabilityTone(c.marketViability)} /></div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted">Need</dt><dd className="tabular font-semibold text-ink">{num(c.populationNeeding)}</dd></div>
        <div><dt className="text-muted">Stock cover</dt><dd className="tabular font-semibold text-ink">{pct(c.inventoryCoverage)}</dd></div>
        <div><dt className="text-muted">Merchants</dt><dd className="tabular font-semibold text-ink">{c.operatingMerchants}/{c.participatingMerchants}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs"><StatusBadge status={c.actionLabel.toLowerCase().includes("direct") ? "direct_supply" : c.actionLabel.toLowerCase().includes("mix") || c.actionLabel.toLowerCase().includes("+") ? "mixed" : "vouchers"} label={c.actionLabel} />{c.topGap && <span className="truncate text-muted">Gap: {c.topGap.label} {pct(c.topGap.shortagePct)}</span>}</div>
    </Tag>
  );
}

/** Full recommendation with reasoning, mix and supply requirements. */
export function RecommendationCard({ c }: { c: CommunityAnalysis }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div><h3 className="font-display text-[24px] font-medium text-evergreen">{c.name}</h3><p className="text-sm text-muted">{c.problem}</p></div>
        <div className="text-right"><p className="tabular text-2xl font-semibold text-navy">{money(c.recommendedCents)}</p><p className="text-xs text-muted">recommended{c.cappedAtMaxNeed ? " · capped at eligible need" : ""}</p></div>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm"><span className="font-medium text-ink">Recommended mix</span><StatusBadge status={c.action} label={c.actionLabel} /></div>
            <div className="flex h-3 overflow-hidden rounded-sm bg-ink/8" role="img" aria-label={`${pct(c.voucherPct)} vouchers, ${pct(c.directPct)} direct supply`}><div className="bg-teal" style={{ width: `${c.voucherPct * 100}%` }} /><div className="bg-navy" style={{ width: `${c.directPct * 100}%` }} /></div>
            <div className="mt-1.5 flex justify-between text-xs text-muted"><span><span className="mr-1 inline-block size-2 rounded-full bg-teal" />Vouchers {pct(c.voucherPct)} · {money(c.voucherCents)}</span><span><span className="mr-1 inline-block size-2 rounded-full bg-navy" />Direct supply {pct(c.directPct)} · {money(c.directCents)}</span></div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[["Market viability", c.marketViability.toFixed(2)], ["Market access", `${Math.round(c.marketAccess)}/100`], ["Effective merchant capacity", `${Math.round(c.merchantCapacity)}/100`], ["Merchant coverage", `${c.merchantCoverage}% (${c.operatingEquivalent.toFixed(1)} of ${c.merchantsNeeded} needed)`], ["Inventory coverage", pct(c.inventoryCoverage)], ["People needing aid", num(c.populationNeeding)], ["Priority share", pct(c.priorityShare, 1)]].map(([k, v]) => <div key={k} className="rounded-lg bg-canvas px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="tabular font-semibold text-ink">{v}</dd></div>)}
          </dl>
          {c.directCents > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Estimated direct-supply procurement plan</p>
              {c.procurement.lines.length > 0 ? (
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {c.procurement.lines.map((d) => (
                    <li key={d.category} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                      <span>{d.label}<span className="ml-1 text-xs text-muted">(shortage {num(d.shortageUnits)} units @ {money(d.unitCostCents)} est.)</span></span>
                      <span className="tabular text-muted">{num(d.units)} units · {money(d.costCents)} est.{d.unfundedUnits > 0 ? ` · ${num(d.unfundedUnits)} unfunded` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-lg border border-line px-3 py-2 text-sm text-muted">No projected shortages to source against this budget.</p>}
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                {[["Direct-supply budget", money(c.procurement.budgetCents)], ["Estimated plan", money(c.procurement.allocatedCents)], ["Unallocated", money(c.procurement.unallocatedCents)]].map(([k, v]) => <div key={k} className="rounded-lg bg-canvas px-2 py-1.5"><dt className="text-muted">{k}</dt><dd className="tabular font-semibold text-ink">{v}</dd></div>)}
              </dl>
              <p className="mt-1.5 text-xs text-muted">Estimates from projected shortages and average unit costs. RELAY does not purchase anything; a coordinator must source supplies separately.</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">Why this recommendation</p>
          <ul className="space-y-2 text-sm text-muted">{c.reasoning.map((r, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" />{r}</li>)}</ul>
          <p className="rounded-lg bg-canvas p-3 text-sm leading-relaxed text-ink">{c.explanation}</p>
        </div>
      </div>
    </Card>
  );
}

export function ScenarioDeltaTable({ rows }: { rows: CommunityDelta[] }) {
  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const dv = r.after.viability - r.before.viability;
        return (
          <div key={r.communityId} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-navy">{r.name}</h4><div className="flex gap-2"><RiskBadge risk={r.before.risk} /><span className="text-muted">→</span><RiskBadge risk={r.after.risk} /></div></div>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
              {[["Viability", r.before.viability.toFixed(2), r.after.viability.toFixed(2)], ["Voucher share", pct(r.before.voucherPct), pct(r.after.voucherPct)], ["Recommended", money(r.before.recommendedCents), money(r.after.recommendedCents)], ["Shortage (units)", num(r.before.shortageUnits), num(r.after.shortageUnits)]].map(([k, a, b]) => (
                <div key={k} className="rounded-lg bg-canvas px-3 py-2"><p className="text-xs text-muted">{k}</p><p className="tabular text-sm"><span className="text-muted">{a}</span> <span className="text-muted">→</span> <span className={cn("font-semibold", a === b ? "text-ink" : "text-navy")}>{b}</span></p></div>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">{r.summary}{Math.abs(dv) > 0.0005 && r.drivers.length > 0 && ` Main drivers: ${r.drivers.map((d) => `${d.factor.toLowerCase()} ${d.viabilityContribution >= 0 ? "+" : ""}${d.viabilityContribution.toFixed(3)}`).join(", ")}.`}</p>
          </div>
        );
      })}
    </div>
  );
}

export function FormulaPanel({ formulas }: { formulas: Record<string, any> }) {
  const items: [string, string][] = [["Inventory coverage", formulas.coverage], ["Merchant coverage & effective capacity", formulas.merchantCoverage], ["Market viability", formulas.viability], ["Voucher / direct split", formulas.voucherShare], ["Priority share", formulas.priority], ["Eligible-need cap", formulas.cap], ["Distribution", formulas.distribution], ["Direct-supply procurement (estimate)", formulas.procurement], ["Demand forecast", formulas.forecast]];
  return (
    <Card>
      <CardHeader title="How RELAY calculates recommendations" subtitle="Transparent decision rules, shown exactly as implemented." />
      <div className="space-y-2 p-5">{items.map(([t, b]) => <Disclosure key={t} title={t}><p className="leading-relaxed">{b}</p></Disclosure>)}<InfoTip>{formulas.caveat}</InfoTip></div>
    </Card>
  );
}

/** Receipt (merchant POS, resident, coordinator drawer). */
export function ReceiptView({ r, printable }: { r: { receiptNo: string; createdAt: string; status: string; merchant: { name: string }; voucherCode: string; amountCents: number; balanceAfterCents: number; items: { name: string; category: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[]; duplicate?: boolean }; printable?: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-warm p-5 font-mono text-sm" id="receipt">
      <div className="text-center"><p className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-muted">RELAY · demo receipt</p><p className="mt-1 font-sans text-base font-semibold text-navy">{r.merchant.name}</p><p className="text-xs text-muted">{r.receiptNo} · {fmtDateTime(r.createdAt)}</p></div>
      {r.duplicate && <p className="mt-3 rounded bg-info-soft px-2 py-1 text-center font-sans text-xs text-[#2f5560]">Duplicate request recognised — this is the original receipt. No second charge was made.</p>}
      <ul className="my-4 divide-y divide-dashed divide-line">{r.items.map((i, k) => <li key={k} className="flex justify-between gap-3 py-1.5"><span>{i.quantity} × {i.name}<span className="block text-xs text-muted">{categoryLabel(i.category)} @ {money(i.unitPriceCents)}</span></span><span className="tabular">{money(i.lineTotalCents)}</span></li>)}</ul>
      <div className="space-y-1 border-t border-dashed border-line pt-3"><div className="flex justify-between font-semibold"><span>Total</span><span className="tabular">{money(r.amountCents)}</span></div><div className="flex justify-between text-xs text-muted"><span>Voucher</span><span>{r.voucherCode}</span></div><div className="flex justify-between text-xs text-muted"><span>Voucher balance after</span><span className="tabular">{money(r.balanceAfterCents)}</span></div><div className="flex justify-between text-xs text-muted"><span>Status</span><span>{r.status}</span></div></div>
      {printable && <div className="no-print mt-4 text-center font-sans"><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" />Print receipt</Button></div>}
    </div>
  );
}

export function VoucherQR({ token, size = 200 }: { token: string; size?: number }) {
  return <div className="inline-block rounded-xl bg-warm p-3  ring-1 ring-line"><QRCodeSVG value={token} size={size} level="M" marginSize={0} fgColor="#193D35" title={`Voucher QR ${token}`} /></div>;
}

export const StockBadge = ({ s }: { s: string }) => <StatusBadge status={s} />;
export const CategoryChips = ({ cats }: { cats: string[] }) => <div className="flex flex-wrap gap-1">{cats.map((c) => <Badge key={c} tone="neutral">{categoryLabel(c)}</Badge>)}</div>;
