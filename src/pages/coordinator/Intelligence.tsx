import { Bot, Play, Plus, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { Adjustment } from "@shared/engine";
import { stockoutMarker } from "@shared/forecast";
import { CATEGORIES, categoryLabel } from "@shared/constants";
import { axisProps, CHART, ChartCard, CommunityCard, FormulaPanel, InfoTip, RecommendationCard, ScenarioDeltaTable, viabilityTone } from "@/components/domain";
import { Meter } from "@/components/viz";
import { AllocationSummaryTable, BeforeAfterBoard, Methodology } from "@/components/compare";
import { AiEvaluation } from "./intelligence/AiEvaluation";
import { PineValleyDemo } from "./intelligence/PineValleyDemo";
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Notice, PageHeader, PageSkeleton, Segmented, Select, StatusBadge, Tabs, Textarea } from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { useToast } from "@/lib/toast";
import { fmtDateTime, money, pct, titleCase } from "@/lib/utils";

type Kind = Adjustment["kind"];
const KINDS: { value: Kind; label: string }[] = [
  { value: "merchant_status", label: "Close or limit a merchant" }, { value: "shipment_delay", label: "Delay a shipment" }, { value: "population_increase", label: "Increase population in need" },
  { value: "inventory_change", label: "Change inventory" }, { value: "demand_multiplier", label: "Scale demand" },
];

function describe(a: Adjustment, opts: any): string {
  const com = (id?: string) => opts?.communities.find((c: any) => c.id === id)?.name ?? "all communities";
  switch (a.kind) {
    case "merchant_status": return `${opts?.merchants.find((m: any) => m.id === a.merchantId)?.name ?? a.merchantId} → ${a.status}`;
    case "shipment_delay": return `Delay ${a.quantity ? `${a.quantity} units of ` : "shipments of "}${a.category ? categoryLabel(a.category) : "all categories"} to ${com(a.communityId)} by ${a.delayHours}h`;
    case "population_increase": return `+${a.additionalResidents.toLocaleString()} residents in need in ${com(a.communityId)}`;
    case "inventory_change": return `${com(a.communityId)} · ${categoryLabel(a.category)}: ${a.mode === "reduce_percent" ? `reduce by ${a.value}%` : a.mode === "set_units" ? `set to ${a.value} units` : `${a.value >= 0 ? "+" : ""}${a.value} units`}`;
    case "demand_multiplier": return `Demand ×${a.multiplier} in ${com(a.communityId)}${a.category ? ` for ${categoryLabel(a.category)}` : ""}`;
  }
}

export default function Intelligence() {
  const { programId, program } = useProgram();
  const nav = useNavigate();
  const toast = useToast();
  const live = useApi<any>(programId ? `/api/intelligence/live?programId=${programId}` : null);
  const opts = useApi<any>(programId ? `/api/intelligence/options?programId=${programId}` : null);
  const saved = useApi<any>(programId ? `/api/intelligence/scenarios?programId=${programId}` : null);
  const [days, setDays] = useState<21 | 30>(30);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"manual" | "ai">("manual");
  const [section, setSection] = useState<"assessment" | "allocation" | "forecast" | "simulator" | "eval">("assessment");
  const [demo, setDemo] = useState(false);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [source, setSource] = useState<{ source: "manual" | "ai"; text?: string; proposal?: unknown }>({ source: "manual" });

  const [fc, setFc] = useState({ communityId: "", category: "drinking_water" });
  useEffect(() => { if (live.data && !fc.communityId) setFc((f) => ({ ...f, communityId: live.data.analysis.communities[0]?.communityId ?? "" })); }, [live.data, fc.communityId]);

  // Live preview: recalculate whenever the adjustment list changes.
  useEffect(() => {
    if (!programId) return;
    if (!adjustments.length) { setPreview(null); setPreviewErr(null); return; }
    let stale = false;
    setPreviewing(true);
    api.post("/api/intelligence/scenarios/preview", { programId, adjustments }).then((r) => { if (!stale) { setPreview(r); setPreviewErr(null); } }).catch((e) => { if (!stale) setPreviewErr(e.message); }).finally(() => !stale && setPreviewing(false));
    return () => { stale = true; };
  }, [adjustments, programId]);

  if (live.loading || opts.loading) return <PageSkeleton />;
  if (live.error || !live.data) return <ErrorState error={live.error ?? "No data"} onRetry={live.reload} />;
  const { analysis, series, formulas, latestRun } = live.data;
  const ev = analysis.forecastEvaluation;
  const canRun = program?.status !== "closed";

  const run = async () => {
    setRunning(true);
    try { const r = await api.post("/api/intelligence/run", { programId, analysisDays: days }); toast.success("Analysis complete. Review and approve the recommendation."); nav(`/app/allocations/${r.runId}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Analysis failed"); setRunning(false); }
  };

  const seriesKey = `${fc.communityId}|${fc.category}`;
  const s = series[seriesKey] as { history: number[]; forecast: number[] } | undefined;
  const hist = (s?.history ?? []).slice(-10);
  // Numeric x axis in days from now (history <= 0, forecast day k at +k) so the stockout hour can be placed exactly.
  const chartData = [...hist.map((v, i) => ({ x: i - hist.length + 1, actual: v })), ...(s?.forecast ?? []).map((v, i) => ({ x: i + 1, forecast: v, ...(i === 0 ? { actual: hist[hist.length - 1] } : {}) }))];
  const fcComm = analysis.communities.find((c: any) => c.communityId === fc.communityId);
  const fcCat = fcComm?.categories.find((c: any) => c.category === fc.category);
  const horizonDays = (s?.forecast ?? []).length;
  // Only a stockout the engine actually computed inside the displayed horizon is drawn. Never inferred or invented.
  const marker = stockoutMarker(fcCat?.stockoutHours, horizonDays);
  const stockoutDays: number | null = marker ? marker.days : null;
  const stockoutLabel = fcCat?.stockoutHours == null ? null : fcCat.stockoutHours < 1 ? "now (stock does not cover current demand)" : `in about ${Math.round(fcCat.stockoutHours)} h (${fmtDateTime(new Date(Date.now() + fcCat.stockoutHours * 3_600_000).toISOString())})`;
  const dayTick = (v: number) => (v > 0 ? `+${v}d` : v === 0 ? "Latest" : `D${v}`);
  const addAdj = (a: Adjustment) => { setAdjustments((x) => [...x, a]); };
  const removeAdj = (i: number) => setAdjustments((x) => x.filter((_, k) => k !== i));
  const cats = (id: string) => (id ? categoryLabel(id) : "");
  const evRows = [ev.overall, ...ev.byCategory];

  const loadAi = (r: any) => { setAdjustments(r.adjustments); setSource({ source: "ai", text: r.sourceText, proposal: r.proposal }); toast.info("Proposal loaded into the simulator for your review. Nothing has been saved or changed."); };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Decision support / Market intelligence" title="RELAY Intelligence" subtitle="Understand local market capacity. Anticipate shortages. Direct assistance where it matters." actions={<>
        <Segmented label="Analysis window" value={days} onChange={setDays} options={[{ value: 21, label: "21 days" }, { value: 30, label: "30 days" }]} />
        <Button variant="outline" onClick={() => { setDemo(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Play className="size-4" />Run Pine Valley Demo</Button>
        <Button onClick={run} loading={running} disabled={!canRun}><Sparkles className="size-4" />Run analysis</Button></>} />
      {latestRun && <p className="-mt-4 text-sm text-muted">Latest saved run: <a className="font-medium text-forest hover:underline" href={`/app/allocations/${latestRun.id}`} onClick={(e) => { e.preventDefault(); nav(`/app/allocations/${latestRun.id}`); }}>{latestRun.id}</a> <StatusBadge status={latestRun.status} /> · {fmtDateTime(latestRun.createdAt)}</p>}
      <InfoTip>The figures below are calculated live from current inventory, merchants and demand history. “Run analysis” saves them as a recommendation that must be approved by a person; approving records a plan and does not move money.</InfoTip>

      {demo && opts.data && <PineValleyDemo programId={programId!} live={live.data} opts={opts.data} onClose={() => setDemo(false)} />}

      <Tabs value={section} onChange={setSection} tabs={[{ value: "assessment", label: "Market Assessment" }, { value: "allocation", label: "Aid Allocation" }, { value: "forecast", label: "Demand Forecast" }, { value: "simulator", label: "Scenario Simulator" }, { value: "eval", label: "AI Evaluation" }]} />

      {section === "assessment" && <section aria-labelledby="mv"><p className="eyebrow">Section 01</p><h2 id="mv" className="font-display mb-4 mt-1 text-[28px] text-evergreen">Market assessment</h2>
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1.1fr_repeat(5,1fr)] gap-5 border-b border-border-strong px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary lg:grid"><span>Community</span><span>Market viability</span><span>Market access</span><span>Merchant coverage</span><span>Inventory sufficiency</span><span>Need severity</span></div>
          <div className="divide-y divide-line">{analysis.communities.map((c: any) => {
            const cell = (label: string, v: number, text: string, tone: "good" | "mid" | "bad" | "neutral") => <span className="block"><span className="mb-1 block text-xs text-secondary lg:hidden">{label}</span><span className="flex items-center gap-3"><Meter value={v} tone={tone} label={`${label} ${text}`} className="flex-1" /><span className="tabular w-11 text-right text-[13px] font-medium text-ink">{text}</span></span></span>;
            const t = (v: number) => (v >= 0.6 ? "good" : v >= 0.35 ? "mid" : "bad") as "good" | "mid" | "bad";
            return (
              <div key={c.communityId} className="grid gap-x-5 gap-y-3 px-6 py-5 sm:grid-cols-2 lg:grid-cols-[1.1fr_repeat(5,1fr)] lg:items-center">
                <span><span className="block font-semibold text-ink">{c.name}</span><span className="text-xs text-secondary">{c.populationNeeding.toLocaleString()} people in need · {c.operatingMerchants}/{c.participatingMerchants} merchants open</span></span>
                {cell("Market viability", c.marketViability, c.marketViability.toFixed(2), t(c.marketViability))}
                {cell("Market access", c.marketAccess / 100, `${Math.round(c.marketAccess)}`, t(c.marketAccess / 100))}
                {cell("Merchant coverage", c.merchantCoverageRatio, `${c.merchantCoverage}%`, t(c.merchantCoverageRatio))}
                {cell("Inventory sufficiency", c.inventoryCoverage, `${Math.round(c.inventoryCoverage * 100)}%`, t(c.inventoryCoverage))}
                {cell("Need severity", c.needSeverity / 100, `${c.needSeverity}`, c.needSeverity >= 70 ? "bad" : c.needSeverity >= 45 ? "mid" : "neutral")}
              </div>
            );
          })}</div>
          <p className="border-t border-line px-6 py-3 text-xs text-secondary">Viability = 0.35 × market access + 0.25 × effective merchant capacity + 0.40 × inventory coverage. Effective capacity is average capacity scaled by merchant coverage. Longer bars are better, except need severity.</p>
        </Card>
        <div className="mt-4"><Methodology formulas={formulas} keys={["merchantCoverage", "viability", "coverage", "voucherShare"]} /></div>
      </section>}

      {section === "allocation" && <section aria-labelledby="rec" className="space-y-4">
        <AllocationSummaryTable analysis={analysis} />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="eyebrow">Section 02</p><h2 id="rec" className="font-display mt-1 text-[28px] text-evergreen">Recommended assistance mix</h2></div><p className="text-sm text-muted">Budget basis {money(analysis.budgetBasisCents)} · recommended {money(analysis.totals.recommendedCents)} · unallocated {money(analysis.totals.unallocatedCents)}</p></div>
        <div className="space-y-4">{analysis.communities.map((c: any) => <RecommendationCard key={c.communityId} c={c} />)}</div>
        <Methodology formulas={formulas} keys={["priority", "cap", "distribution", "procurement"]} /></section>}

      {section === "forecast" && <section aria-labelledby="fcst"><p className="eyebrow">Section 03</p><h2 id="fcst" className="font-display mb-4 mt-1 text-[28px] text-evergreen">Demand forecast</h2>
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <ChartCard title="Actual consumption and 3-day forecast" subtitle="Units per day · x axis in days from the latest data point" height={300} footer={fcCat ? <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><span>On-hand stock (operating merchants): <strong className="tabular text-ink">{Math.round(fcCat.inventoryUnits).toLocaleString()}</strong></span><span>Forecast 72 h demand: <strong className="tabular text-ink">{Math.round(fcCat.forecast72).toLocaleString()}</strong></span><span>Inbound within 72 h: <strong className="tabular text-ink">{Math.round(fcCat.inboundUnits).toLocaleString()}</strong></span>{stockoutDays !== null ? <span className="font-medium text-danger">Projected stockout {stockoutLabel}</span> : <span className="text-secondary">No stockout projected within this forecast window.</span>}</div> : undefined} action={<div className="flex gap-2"><Select aria-label="Community" className="h-9 w-40" value={fc.communityId} onChange={(e) => setFc({ ...fc, communityId: e.target.value })}>{analysis.communities.map((c: any) => <option key={c.communityId} value={c.communityId}>{c.name}</option>)}</Select><Select aria-label="Category" className="h-9 w-44" value={fc.category} onChange={(e) => setFc({ ...fc, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>}>
            <LineChart data={chartData} margin={{ left: 4, right: 24, top: 28 }}><CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis type="number" dataKey="x" domain={[hist.length ? -(hist.length - 1) : 0, Math.max(horizonDays, 1)]} allowDecimals={false} tickFormatter={dayTick} {...axisProps} tickCount={8} />
              <YAxis {...axisProps} width={48} />
              <Tooltip content={({ active, payload, label }: any) => active && payload?.length ? (
                <div className="rounded-md border border-line bg-warm px-3 py-2 text-xs shadow-card">
                  <p className="font-semibold text-ink">{dayTick(Number(label))}</p>
                  {payload.filter((p: any) => p.value != null).map((p: any) => <p key={p.dataKey} className="text-secondary">{p.name}: <span className="tabular text-ink">{Math.round(p.value).toLocaleString()} units</span></p>)}
                  {stockoutLabel && <p className="mt-1 border-t border-line pt-1 text-danger">Projected stockout {stockoutLabel}<br /><span className="text-secondary">{fcComm?.name} · {categoryLabel(fc.category)}</span></p>}
                </div>) : null} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="actual" name="Historical" stroke={CHART.navy} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke={CHART.teal} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              {hist.length > 0 && <ReferenceLine x={0} stroke={CHART.axis} strokeDasharray="2 3" label={{ value: "Latest data", position: "insideBottomLeft", fontSize: 11, fill: CHART.axis }} />}
              {stockoutDays !== null && <ReferenceLine x={stockoutDays} stroke={CHART.red} strokeWidth={2} label={{ value: "Projected stockout", position: "top", fontSize: 11, fontWeight: 600, fill: CHART.red }} />}
            </LineChart>
          </ChartCard>
          <Card><CardHeader title="Model vs baseline" subtitle="Rolling-origin holdout on synthetic data" />
            <DataTable rows={evRows} rowKey={(r: any) => r.label} caption="Forecast evaluation" columns={[
              { key: "l", header: "Scope", render: (r: any) => r.label },
              { key: "m", header: "Model MAE", align: "right", render: (r: any) => r.selected.mae.toFixed(1) },
              { key: "b", header: "Baseline MAE", align: "right", render: (r: any) => r.baseline.mae.toFixed(1) },
              { key: "mp", header: "Model MAPE", align: "right", hideOnMobile: true, render: (r: any) => (r.selected.mape === null ? "n/a" : pct(r.selected.mape, 1)) },
              { key: "w", header: "Beats baseline", render: (r: any) => <Badge tone={r.selectedBeatsBaseline ? "success" : "warning"}>{r.selectedBeatsBaseline ? "Yes" : "No"}</Badge> },
            ]} />
            <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">{ev.note} MAPE excludes zero-demand days.</p></Card>
        </div>
        <div className="mt-4"><Methodology formulas={formulas} keys={["forecast"]} /></div></section>}

      {section === "simulator" && <section aria-labelledby="sim"><p className="eyebrow">Section 04</p><h2 id="sim" className="font-display mb-4 mt-1 text-[28px] text-evergreen">Scenario simulator</h2>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "manual", label: "Manual controls" }, { value: "ai", label: "AI Scenario Interpreter" }]} />
          <div className="p-5">
            {tab === "manual" ? <ManualBuilder opts={opts.data} onAdd={(a) => { addAdj(a); setSource((s) => (s.source === "ai" ? s : { source: "manual" })); }} /> : <AiInterpreter programId={programId!} onLoad={loadAi} result={aiResult} setResult={setAiResult} />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Active scenario" subtitle="Preview only. Your real data is never changed by the simulator." action={adjustments.length > 0 && <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setAdjustments([]); setSource({ source: "manual" }); }}>Clear</Button><Button size="sm" onClick={() => setSaveOpen(true)}><Save className="size-4" />Save scenario</Button></div>} />
          <div className="p-5">
            {!adjustments.length ? <EmptyState title="No adjustments yet" message="Add an adjustment above (or load an AI proposal) to see how viability and the recommended mix change." icon={<Wand2 className="size-5" />} /> : (
              <div className="space-y-5">
                <ul className="flex flex-wrap gap-2">{adjustments.map((a, i) => <li key={i} className="flex items-center gap-2 rounded-md border border-line bg-canvas py-1 pl-3 pr-1.5 text-sm">{describe(a, opts.data)}<button aria-label="Remove adjustment" className="rounded-md p-1 text-muted hover:bg-ink/10 hover:text-danger" onClick={() => removeAdj(i)}><Trash2 className="size-3.5" /></button></li>)}</ul>
                {source.source === "ai" && <Notice tone="info">These adjustments came from the AI interpreter. Review each one; saving requires your explicit confirmation.</Notice>}
                {previewErr && <Notice tone="danger">{previewErr}</Notice>}
                {previewing && !preview ? <p className="text-sm text-muted">Calculating…</p> : preview && (<>
                  {preview.notes?.length > 0 && <Notice tone="warning"><ul className="list-disc pl-4">{preview.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Notice>}
                  <div><h3 className="mb-2 font-semibold text-navy">Baseline vs simulated</h3><BeforeAfterBoard comparison={preview.comparison} baseline={preview.baseline} adjusted={preview.adjusted} /></div>
                </>)}
              </div>
            )}
          </div>
        </Card>
        </div>

        <Card className="mt-6"><CardHeader title="Saved scenarios" />
          <DataTable rows={saved.data?.items} loading={saved.loading} rowKey={(r: any) => r.id} caption="Saved scenarios" empty={<p className="p-5 text-sm text-muted">No saved scenarios yet.</p>} columns={[
            { key: "n", header: "Scenario", render: (r: any) => r.name },
            { key: "s", header: "Source", render: (r: any) => <Badge tone={r.source === "ai" ? "info" : "neutral"}>{r.source === "ai" ? "AI-assisted" : "Manual"}</Badge> },
            { key: "c", header: "Saved", hideOnMobile: true, render: (r: any) => fmtDateTime(r.created_at) },
            { key: "a", header: "", align: "right", render: (r: any) => <Button size="sm" variant="outline" onClick={() => api.post(`/api/intelligence/scenarios/${r.id}/allocation-run`).then((x) => nav(`/app/allocations/${x.runId}`)).catch((e) => toast.error(e.message))}>Create allocation run</Button> },
          ]} /></Card>
      </section>}

      {section === "eval" && <AiEvaluation programId={programId!} />}

      {section !== "eval" && <FormulaPanel formulas={formulas} />}
      <SaveScenarioDialog open={saveOpen} onOpenChange={setSaveOpen} onSave={async (name) => { await api.post("/api/intelligence/scenarios", { programId, name, adjustments, source: source.source, sourceText: source.text, aiProposal: source.proposal, confirmed: true }); toast.success("Scenario saved"); saved.reload(); }} />
    </div>
  );
}

function SaveScenarioDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setErr(null); } }, [open]);
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title="Save this scenario?" description="Saving stores the adjustments and their results as a snapshot. It does not change inventory, merchants, population or any allocation." confirmLabel="Confirm and save"
      onConfirm={async () => { if (name.trim().length < 3) { setErr("Give the scenario a name (3+ characters)."); throw new Error("Give the scenario a name (3+ characters)."); } setBusy(true); try { await onSave(name.trim()); } finally { setBusy(false); } }}>
      <Field label="Scenario name" error={err ?? undefined} htmlFor="sc-name"><Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={100} placeholder="e.g. Cedar Grove supply delay" /></Field>
    </ConfirmDialog>
  );
}

function ManualBuilder({ opts, onAdd }: { opts: any; onAdd: (a: Adjustment) => void }) {
  const [kind, setKind] = useState<Kind>("merchant_status");
  const [f, setF] = useState<Record<string, any>>({ status: "closed", delayHours: 24, additionalResidents: 100, mode: "reduce_percent", value: 30, multiplier: 1.3, category: "" });
  const [err, setErr] = useState<string | null>(null);
  const communityId = f.communityId ?? opts?.communities[0]?.id ?? "";
  const merchantId = f.merchantId ?? opts?.merchants[0]?.id ?? "";
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: any) => (v === "" || v === undefined ? NaN : Number(v));
  const submit = () => {
    setErr(null);
    let a: Adjustment | null = null;
    if (kind === "merchant_status") a = { kind, merchantId, status: f.status };
    else if (kind === "shipment_delay") { const h = num(f.delayHours); if (!Number.isInteger(h) || h < 1 || h > 168) return setErr("Delay must be a whole number of hours from 1 to 168."); const q = f.quantity === undefined || f.quantity === "" ? undefined : num(f.quantity); if (q !== undefined && (!Number.isInteger(q) || q <= 0)) return setErr("Quantity must be a positive whole number."); a = { kind, communityId, delayHours: h, ...(f.category ? { category: f.category } : {}), ...(q ? { quantity: q } : {}) }; }
    else if (kind === "population_increase") { const n = num(f.additionalResidents); if (!Number.isInteger(n) || n < 1) return setErr("Enter a positive whole number of residents."); a = { kind, communityId, additionalResidents: n }; }
    else if (kind === "inventory_change") { const v = num(f.value); if (!Number.isFinite(v)) return setErr("Enter a number."); if (f.mode === "reduce_percent" && (v <= 0 || v > 100)) return setErr("Reduction must be between 1 and 100 percent."); if (f.mode === "set_units" && v < 0) return setErr("Units cannot be negative."); a = { kind, communityId, category: f.category || "drinking_water", mode: f.mode, value: v }; }
    else { const m = num(f.multiplier); if (!Number.isFinite(m) || m < 0.1 || m > 5) return setErr("Multiplier must be between 0.1 and 5."); a = { kind, ...(f.scopeCommunity ? { communityId } : {}), ...(f.category ? { category: f.category } : {}), multiplier: m }; }
    onAdd(a);
  };
  const communitySel = <Field label="Community" htmlFor="sb-c"><Select id="sb-c" value={communityId} onChange={(e) => set("communityId", e.target.value)}>{opts?.communities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>;
  const categorySel = (required: boolean) => <Field label={required ? "Category" : "Category (optional)"} htmlFor="sb-cat"><Select id="sb-cat" value={f.category || (required ? "drinking_water" : "")} onChange={(e) => set("category", e.target.value)}>{!required && <option value="">All categories</option>}{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>;
  return (
    <div className="space-y-4">
      <Field label="What changes?" htmlFor="sb-kind"><Select id="sb-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setErr(null); }}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
      <div className="grid grid-cols-1 gap-4">
        {kind === "merchant_status" && <><Field label="Merchant" htmlFor="sb-m"><Select id="sb-m" value={merchantId} onChange={(e) => set("merchantId", e.target.value)}>{opts?.merchants.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.status})</option>)}</Select></Field><Field label="New status" htmlFor="sb-s"><Select id="sb-s" value={f.status} onChange={(e) => set("status", e.target.value)}><option value="closed">Closed</option><option value="limited">Limited</option><option value="open">Open</option></Select></Field></>}
        {kind === "shipment_delay" && <>{communitySel}{categorySel(false)}<Field label="Delay (hours)" htmlFor="sb-h"><Input id="sb-h" type="number" value={f.delayHours} onChange={(e) => set("delayHours", e.target.value)} /></Field><Field label="Units delayed (optional)" htmlFor="sb-q"><Input id="sb-q" type="number" value={f.quantity ?? ""} onChange={(e) => set("quantity", e.target.value)} /></Field></>}
        {kind === "population_increase" && <>{communitySel}<Field label="Additional residents in need" htmlFor="sb-p"><Input id="sb-p" type="number" value={f.additionalResidents} onChange={(e) => set("additionalResidents", e.target.value)} /></Field></>}
        {kind === "inventory_change" && <>{communitySel}{categorySel(true)}<Field label="Method" htmlFor="sb-mode"><Select id="sb-mode" value={f.mode} onChange={(e) => set("mode", e.target.value)}><option value="reduce_percent">Reduce by %</option><option value="set_units">Set units</option><option value="delta_units">Add / remove units</option></Select></Field><Field label="Value" htmlFor="sb-v"><Input id="sb-v" type="number" value={f.value} onChange={(e) => set("value", e.target.value)} /></Field></>}
        {kind === "demand_multiplier" && <><Field label="Multiplier (0.1–5)" htmlFor="sb-x"><Input id="sb-x" type="number" step="0.1" value={f.multiplier} onChange={(e) => set("multiplier", e.target.value)} /></Field>{categorySel(false)}<div className="flex items-end"><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4 accent-teal" checked={!!f.scopeCommunity} onChange={(e) => set("scopeCommunity", e.target.checked)} />Limit to one community</label></div>{f.scopeCommunity && communitySel}</>}
      </div>
      {err && <p role="alert" className="text-sm font-medium text-danger">{err}</p>}
      <Button onClick={submit} variant="outline"><Plus className="size-4" />Add to scenario</Button>
    </div>
  );
}

function AiInterpreter({ programId, onLoad, result, setResult }: { programId: string; onLoad: (r: any) => void; result: any; setResult: (r: any) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; unavailable: boolean } | null>(null);
  const example = "A truck carrying 400 units of drinking water to Cedar Grove is delayed by 24 hours, and about 120 more residents are expected tomorrow.";
  const go = async () => {
    setErr(null); setResult(null);
    if (text.trim().length < 10) return setErr({ message: "Describe the incident in a sentence or two.", unavailable: false });
    setBusy(true);
    try { setResult(await api.post("/api/intelligence/interpret", { programId, text })); }
    catch (e) { const ae = e as ApiError; setErr({ message: ae.message, unavailable: ae.status === 503 || ae.status === 502 }); } finally { setBusy(false); }
  };
  const row = (label: string, f: any, show: string | null) => f && show ? <div key={label} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm last:border-0"><div><p className="text-xs text-muted">{label}</p><p className="font-medium text-ink">{show}</p>{f.sourcePhrase && <p className="text-xs text-muted">“{f.sourcePhrase}”</p>}</div><Badge tone={f.confidence === "high" ? "success" : f.confidence === "medium" ? "warning" : "danger"}>{f.confidence}</Badge></div> : null;
  const p = result?.proposal;
  return (
    <div className="space-y-4">
      <InfoTip><span>Paste a field report. The AI only <em>proposes</em> structured scenario inputs; numbers not found in your text are dropped, and nothing is applied until you review and confirm. It cannot issue vouchers, approve allocations or change data.</span></InfoTip>
      <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0">
      <div className="space-y-4">
      <Field label="Incident report" htmlFor="ai-text" hint={`${text.length}/1500 characters`}><Textarea id="ai-text" value={text} onChange={(e) => setText(e.target.value.slice(0, 1500))} placeholder={example} /></Field>
      <div className="flex flex-wrap gap-2"><Button onClick={go} loading={busy}><Bot className="size-4" />Interpret report</Button><Button variant="ghost" onClick={() => setText(example)}>Use example</Button></div>
      {err && <Notice tone={err.unavailable ? "warning" : "danger"}>{err.message}{err.unavailable && " You can still build the scenario with the manual controls."}</Notice>}
      </div>
      <div>
      
      {result && p && (
        <div className="space-y-4 rounded-card border border-line bg-warm p-5">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-navy">Proposed scenario</h3><Badge tone="info">Needs your confirmation</Badge></div>
          <div>{row("Community", p.community, p.community?.name)}{row("Category", p.category, p.category?.value ? categoryLabel(p.category.value) : null)}{row("Delayed supply", p.delayedSupply, p.delayedSupply?.quantity ? `${p.delayedSupply.quantity} units` : null)}{row("Delay", p.delayHours, p.delayHours?.value ? `${p.delayHours.value} hours` : null)}{row("Additional residents", p.additionalResidents, p.additionalResidents?.value ? `+${p.additionalResidents.value}` : null)}{row("Merchant closure", p.merchantClosure, p.merchantClosure?.merchantName)}</div>
          {result.warnings.length > 0 && <Notice tone="warning"><p className="font-medium">Checked against your text</p><ul className="mt-1 list-disc pl-4">{result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></Notice>}
          {p.missingInformation.length > 0 && <div><p className="text-sm font-medium text-ink">Missing information</p><ul className="list-disc pl-5 text-sm text-muted">{p.missingInformation.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul></div>}
          {p.assumptions.length > 0 && <div><p className="text-sm font-medium text-ink">Assumptions</p><ul className="list-disc pl-5 text-sm text-muted">{p.assumptions.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul></div>}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3"><Button disabled={!result.adjustments.length} onClick={() => onLoad(result)}>Load into simulator for review</Button><span className="text-xs text-muted">{result.adjustments.length} adjustment{result.adjustments.length === 1 ? "" : "s"} · model {result.model}</span></div>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
void titleCase; void viabilityTone; void useMemo; void ScenarioDeltaTable;
