import { ArrowLeft, ArrowRight, CheckCircle2, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Adjustment, AnalysisResult } from "@shared/engine";
import { AllocationSummaryTable, BeforeAfterBoard } from "@/components/compare";
import { RiskBadge } from "@/components/domain";
import { Button, Card, ErrorState, Notice, ProgressBar } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, money, num, pct } from "@/lib/utils";

const STEPS = ["Initial conditions", "Current market viability", "Initial recommendations", "Major merchant closure", "Delayed water shipment", "Updated demand and inventory projections", "Updated recommendations", "Original vs revised"] as const;
type Preview = { baseline: AnalysisResult; adjusted: AnalysisResult; comparison: any[]; notes: string[] };

/**
 * Guided walkthrough. Every number comes from the real scenario engine through the read-only
 * /scenarios/preview endpoint (the same one the simulator uses). Nothing is saved or changed, so the seeded
 * scenario cannot be corrupted; Reset simply restarts the walkthrough and re-fetches fresh engine output.
 */
export function PineValleyDemo({ programId, live, opts, onClose }: { programId: string; live: any; opts: any; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<{ closure: Adjustment | null; delay: Adjustment | null; a: Preview; b: Preview; target: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null); setError(null);
    try {
      const comms = [...live.analysis.communities].sort((x: any, y: any) => y.marketViability - x.marketViability);
      const target = comms[Math.floor((comms.length - 1) / 2)]; // the mid-viability community is where a closure changes the recommendation most
      const merchant = [...opts.merchants].filter((m: any) => m.communityId === target.communityId && m.status === "open").sort((x: any, y: any) => y.capacityScore - x.capacityScore)[0];
      const shipment = opts.shipments.find((s: any) => s.category === "drinking_water" && s.communityId === target.communityId) ?? opts.shipments.find((s: any) => s.category === "drinking_water");
      const closure: Adjustment | null = merchant ? { kind: "merchant_status", merchantId: merchant.id, status: "closed" } : null;
      const delay: Adjustment | null = shipment ? { kind: "shipment_delay", communityId: shipment.communityId, category: "drinking_water", delayHours: 48 } : null;
      const [a, b] = await Promise.all([
        api.post("/api/intelligence/scenarios/preview", { programId, adjustments: closure ? [closure] : [] }),
        api.post("/api/intelligence/scenarios/preview", { programId, adjustments: [closure, delay].filter(Boolean) }),
      ]);
      setData({ closure, delay, a, b, target: target.communityId });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the demo"); }
  }, [programId, live, opts]);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setStep(0); void load(); };
  const name = (id: string) => live.analysis.communities.find((c: any) => c.communityId === id)?.name ?? id;
  const base: AnalysisResult = live.analysis;

  const body = () => {
    if (error) return <ErrorState error={error} onRetry={load} />;
    if (!data) return <p className="text-sm text-muted">Running the scenario engine…</p>;
    const { closure, delay, a, b, target } = data;
    const merchantName = closure && closure.kind === "merchant_status" ? opts.merchants.find((m: any) => m.id === closure.merchantId)?.name : null;
    const tgt = (r: AnalysisResult) => r.communities.find((c) => c.communityId === target)!;
    switch (step) {
      case 0: return (
        <div className="space-y-4">
          <p className="text-sm text-muted">The Pine Valley wildfire demo as it is seeded today: three communities, their merchants and the supply already on the road. This is read from the live database; nothing is edited.</p>
          <div className="scroll-thin overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">Initial conditions</caption><thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{["Community", "People in need", "Severity", "Market access", "Merchants operating", "Inbound shipments"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{base.communities.map((c) => <tr key={c.communityId}><th scope="row" className="px-3 py-2 font-medium">{c.name}</th><td className="tabular px-3 py-2">{num(c.populationNeeding)}</td><td className="tabular px-3 py-2">{c.needSeverity}/100</td><td className="tabular px-3 py-2">{c.marketAccess}/100</td><td className="px-3 py-2">{c.operatingMerchants} of {c.participatingMerchants} ({c.operatingEquivalent.toFixed(1)} of {c.merchantsNeeded} needed)</td><td className="px-3 py-2 text-muted">{opts.shipments.filter((s: any) => s.communityId === c.communityId).map((s: any) => `${s.quantity} ${s.category.replace("_", " ")} in ${s.etaHours}h`).join("; ") || "none"}</td></tr>)}</tbody></table></div>
        </div>);
      case 1: return (
        <div className="space-y-3">
          <p className="text-sm text-muted">Viability = 0.35 × market access + 0.25 × effective merchant capacity + 0.40 × inventory coverage, where effective capacity already accounts for how many merchants are operating compared with what the community needs.</p>
          <div className="grid gap-3 md:grid-cols-3">{base.communities.map((c) => <div key={c.communityId} className="rounded-xl border border-line p-4"><div className="flex items-center justify-between"><h4 className="font-semibold text-navy">{c.name}</h4><RiskBadge risk={c.risk} /></div><p className="tabular mt-2 text-3xl font-semibold text-navy">{c.marketViability.toFixed(2)}</p><ProgressBar value={c.marketViability * 100} /><dl className="mt-3 space-y-1 text-xs text-muted">{[["Market access", `${c.marketAccess}/100`], ["Effective capacity", `${Math.round(c.merchantCapacity)}/100 (avg ${Math.round(c.averageCapacity)} × coverage ${c.merchantCoverageRatio.toFixed(2)})`], ["Inventory coverage", pct(c.inventoryCoverage)]].map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt>{k}</dt><dd className="tabular text-right font-medium text-ink">{v}</dd></div>)}</dl></div>)}</div>
        </div>);
      case 2: return (<div className="space-y-3"><p className="text-sm text-muted">Initial recommendation for the budget basis, before anything goes wrong. Strong markets lean on vouchers; weak markets lean on direct supply.</p><AllocationSummaryTable analysis={base} /></div>);
      case 3: return closure ? (
        <div className="space-y-3"><Notice tone="warning"><strong>{merchantName}</strong> in {name(target)} closes. It is the highest-capacity operating merchant in that community.</Notice>
          <p className="text-sm text-muted">{name(target)}: merchant coverage {tgt(a.baseline).merchantCoverage}% → {tgt(a.adjusted).merchantCoverage}%, viability {tgt(a.baseline).marketViability.toFixed(2)} → {tgt(a.adjusted).marketViability.toFixed(2)}, vouchers {pct(tgt(a.baseline).voucherPct)} → {pct(tgt(a.adjusted).voucherPct)}.</p>
          <BeforeAfterBoard comparison={a.comparison} baseline={a.baseline} adjusted={a.adjusted} beforeLabel="Before closure" afterLabel="After closure" /></div>
      ) : <Notice tone="info">No operating merchant was found to close in this program, so this step has nothing to simulate.</Notice>;
      case 4: {
        if (!delay || delay.kind !== "shipment_delay") return <Notice tone="info">No planned drinking-water shipment exists in this program, so there is no delay to simulate.</Notice>;
        const w = (r: AnalysisResult) => r.communities.find((c) => c.communityId === delay.communityId)!.categories.find((x) => x.category === "drinking_water")!;
        const before = w(a.adjusted), after = w(b.adjusted);
        return (<div className="space-y-3"><Notice tone="warning">The drinking-water shipment to <strong>{name(delay.communityId)}</strong> is delayed {delay.delayHours} hours, on top of the closure.</Notice>
          <div className="grid gap-3 sm:grid-cols-3">{[["Water shortage over 72h", `${num(before.unmetUnits)} → ${num(after.unmetUnits)} units`], ["Water coverage", `${pct(before.coverage)} → ${pct(after.coverage)}`], ["Projected stock-out", `${before.stockoutHours === null ? "none" : `${Math.round(before.stockoutHours)}h`} → ${after.stockoutHours === null ? "none" : `${Math.round(after.stockoutHours)}h`}`]].map(([k, v]) => <div key={k} className="rounded-lg bg-canvas p-3"><p className="text-xs text-muted">{k}</p><p className="tabular font-semibold text-ink">{v}</p></div>)}</div>
          {b.notes.length > 0 && <ul className="list-disc pl-5 text-xs text-muted">{b.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}</div>);
      }
      case 5: return (<div className="space-y-3"><p className="text-sm text-muted">72-hour demand, usable inventory and projected shortage per community after both disruptions, compared with the original.</p>
        <div className="scroll-thin overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><caption className="sr-only">Projection changes</caption><thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{["Community", "72h demand", "Usable inventory", "Projected shortage", "Inventory coverage"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{base.communities.map((c) => { const r = b.adjusted.communities.find((x) => x.communityId === c.communityId)!; return <tr key={c.communityId}><th scope="row" className="px-3 py-2 font-medium">{c.name}</th><td className="tabular px-3 py-2">{num(c.demand72Units)} → {num(r.demand72Units)}</td><td className="tabular px-3 py-2">{num(c.inventoryUnits)} → {num(r.inventoryUnits)}</td><td className="tabular px-3 py-2">{num(c.shortageUnits)} → {num(r.shortageUnits)}</td><td className="tabular px-3 py-2">{pct(c.inventoryCoverage)} → {pct(r.inventoryCoverage)}</td></tr>; })}</tbody></table></div></div>);
      case 6: return (<div className="space-y-3"><p className="text-sm text-muted">Revised recommendation after the closure and the shipment delay.</p><AllocationSummaryTable analysis={b.adjusted} />
        <div className="grid gap-3 md:grid-cols-3">{b.adjusted.communities.filter((c) => c.directCents > 0).map((c) => <div key={c.communityId} className="rounded-lg border border-line p-3 text-sm"><p className="font-medium text-navy">{c.name}: estimated procurement</p><p className="tabular mt-1">{money(c.procurement.allocatedCents)} of {money(c.directCents)} direct-supply budget</p><p className="text-xs text-muted">{money(c.procurement.unallocatedCents)} unallocated. Estimates only; nothing is purchased.</p></div>)}</div></div>);
      default: return (<div className="space-y-3"><p className="text-sm text-muted">Original recommendation versus the revised one after the merchant closure and the delayed water shipment.</p><BeforeAfterBoard comparison={b.comparison} baseline={b.baseline} adjusted={b.adjusted} beforeLabel="Original" afterLabel="Revised" /></div>);
    }
  };

  return (
    <Card className="border-evergreen/40 ring-1 ring-evergreen/20" role="region" aria-label="Pine Valley guided demo">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div><h2 className="flex items-center gap-2 font-display text-[24px] font-medium text-evergreen"><Play className="size-5 text-teal" aria-hidden />Pine Valley guided demo</h2><p className="text-sm text-muted">Step {step + 1} of {STEPS.length}: {STEPS[step]}. Uses live engine output; saves and changes nothing.</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-4" />Reset demo</Button><Button variant="ghost" size="sm" onClick={onClose}><X className="size-4" />Exit demo</Button></div>
      </div>
      <ol className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 py-2" aria-label="Demo steps">
        {STEPS.map((s, i) => <li key={s}><button onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium", i === step ? "bg-navy text-white" : i < step ? "bg-teal-soft text-teal-dark" : "text-muted hover:bg-ink/5")}>{i < step ? <CheckCircle2 className="size-3.5" aria-hidden /> : <span>{i + 1}</span>}{s}</button></li>)}
      </ol>
      <div className="p-5" aria-live="polite">{body()}</div>
      <div className="flex justify-between border-t border-line px-5 py-3"><Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft className="size-4" />Back</Button>{step < STEPS.length - 1 ? <Button onClick={() => setStep((s) => s + 1)}>Next<ArrowRight className="size-4" /></Button> : <Button onClick={onClose}>Finish</Button>}</div>
    </Card>
  );
}
