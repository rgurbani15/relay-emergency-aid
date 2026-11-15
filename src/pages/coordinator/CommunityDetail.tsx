import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { z } from "zod";
import { axisProps, CHART, ChartCard, RecommendationCard, RiskBadge } from "@/components/domain";
import { Button, Card, CardHeader, DataTable, ErrorState, Field, Input, PageHeader, PageSkeleton, Section, StatusBadge, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { Meter } from "@/components/viz";
import { useToast } from "@/lib/toast";
import { fmtDate, money, num, pct } from "@/lib/utils";

const schema = z.object({
  population: z.number({ error: "Required" }).int().min(0), populationNeeding: z.number({ error: "Required" }).int().min(0),
  needSeverity: z.number({ error: "Required" }).int().min(0).max(100), marketAccessScore: z.number({ error: "Required" }).int().min(0).max(100),
  merchantsNeeded: z.number({ error: "Required" }).int().min(1).max(50), status: z.enum(["active", "inactive"]),
}).refine((v) => v.populationNeeding <= v.population, { path: ["populationNeeding"], message: "Cannot exceed total population" });
type V = z.infer<typeof schema>;

export default function CommunityDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/api/communities/${id}`);
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<V>({ resolver: zodResolver(schema), values: data ? { population: data.community.population, populationNeeding: data.community.populationNeeding, needSeverity: data.community.needSeverity, marketAccessScore: data.community.marketAccessScore, merchantsNeeded: data.community.merchantsNeeded, status: data.community.status } : undefined });
  const trend = useMemo(() => (data?.demandTrend ?? []).slice(-30).map((d: any) => ({ day: d.day.slice(5), units: d.units })), [data]);
  if (loading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "Not found"} onRetry={reload} />;
  const c = data.community;
  const save = handleSubmit(async (v) => {
    try { await api.patch(`/api/communities/${c.id}`, v); toast.success("Community updated"); reset(v); reload(); } catch (e) { setError("root", { message: e instanceof Error ? e.message : "Could not save" }); }
  });
  const L = data.live;
  const tone = (v: number) => (v >= 0.6 ? "good" : v >= 0.35 ? "mid" : "bad") as "good" | "mid" | "bad";
  const row = (label: string, v: number, text: string, t: "good" | "mid" | "bad" | "neutral") => (
    <div key={label} className="grid grid-cols-[150px_1fr_56px] items-center gap-4 py-2.5 text-sm sm:grid-cols-[200px_1fr_64px]"><span className="text-secondary">{label}</span><Meter value={v} tone={t} label={`${label} ${text}`} /><span className="tabular text-right font-medium text-ink">{text}</span></div>
  );
  return (
    <div>
      <Link to="/app/communities" className="mb-3 inline-flex items-center gap-1 text-sm text-secondary hover:text-ink"><ArrowLeft className="size-4" />Communities</Link>
      <PageHeader eyebrow="Aid operations / Communities" title={c.name} subtitle={<>{num(c.populationNeeding)} of {num(c.population)} residents need assistance {L && <RiskBadge risk={L.risk} />}</>} />

      <Section n="01" title="Community overview" aside={<span className="text-xs text-secondary">Changes are recorded in the audit log.</span>}>
        <Card>
          <form onSubmit={save} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3" noValidate>
            <Field label="Total population" error={errors.population?.message} htmlFor="c1"><Input id="c1" type="number" {...register("population", { valueAsNumber: true })} /></Field>
            <Field label="People needing assistance" error={errors.populationNeeding?.message} htmlFor="c2"><Input id="c2" type="number" {...register("populationNeeding", { valueAsNumber: true })} /></Field>
            <Field label="Need severity (0–100)" error={errors.needSeverity?.message} htmlFor="c3"><Input id="c3" type="number" {...register("needSeverity", { valueAsNumber: true })} /></Field>
            <Field label="Market access (0–100)" error={errors.marketAccessScore?.message} htmlFor="c4"><Input id="c4" type="number" {...register("marketAccessScore", { valueAsNumber: true })} /></Field>
            <Field label="Merchants needed" error={errors.merchantsNeeded?.message} htmlFor="c5"><Input id="c5" type="number" {...register("merchantsNeeded", { valueAsNumber: true })} /></Field>
            <Field label="Status" htmlFor="c6"><Select id="c6" {...register("status")}><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field>
            {errors.root && <p role="alert" className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-3">{errors.root.message}</p>}
            <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button></div>
          </form>
        </Card>
      </Section>

      {L && <Section n="02" title="Market conditions">
        <Card className="px-5 py-2"><div className="divide-y divide-line">
          {row("Market viability", L.marketViability, L.marketViability.toFixed(2), tone(L.marketViability))}
          {row("Market access", L.marketAccess / 100, `${Math.round(L.marketAccess)}/100`, tone(L.marketAccess / 100))}
          {row("Merchant coverage", L.merchantCoverageRatio, `${L.merchantCoverage}%`, tone(L.merchantCoverageRatio))}
          {row("Inventory coverage", L.inventoryCoverage, pct(L.inventoryCoverage), tone(L.inventoryCoverage))}
          {row("Need severity", L.needSeverity / 100, `${L.needSeverity}/100`, L.needSeverity >= 70 ? "bad" : L.needSeverity >= 45 ? "mid" : "neutral")}
        </div></Card>
      </Section>}

      <Section n="03" title="Merchant network">
        <Card>
          <DataTable rows={data.merchants} rowKey={(r: any) => r.id} caption="Merchants in community" columns={[
            { key: "n", header: "Merchant", render: (r: any) => <Link to={`/app/merchants/${r.id}`} className="font-medium hover:underline">{r.name}</Link> },
            { key: "s", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
            { key: "p", header: "Participating", render: (r: any) => (r.participating ? "Yes" : "No") },
            { key: "c", header: "Operating capacity", align: "right", render: (r: any) => `${r.capacityScore}/100` },
          ]} />
        </Card>
      </Section>

      <Section n="04" title="Demand and inventory">
        <ChartCard title="Daily demand (all categories)" subtitle="Units consumed per day, last 30 days" height={240}>
          <AreaChart data={trend} margin={{ left: 4, right: 8, top: 8 }}><CartesianGrid stroke={CHART.grid} vertical={false} /><XAxis dataKey="day" {...axisProps} minTickGap={24} /><YAxis {...axisProps} width={44} /><Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}` }} /><Area type="monotone" dataKey="units" stroke={CHART.teal} fill={CHART.sage} fillOpacity={0.35} strokeWidth={2} /></AreaChart>
        </ChartCard>
      </Section>

      <Section n="05" title="Recommended assistance">
        {L ? <RecommendationCard c={L} /> : <p className="text-sm text-secondary">No live analysis for this community.</p>}
      </Section>

      <Section n="06" title="Allocation history">
        <Card>
          <DataTable rows={data.allocations} rowKey={(r: any) => r.runId} caption="Allocation history" empty={<p className="p-5 text-sm text-muted">No allocation runs yet.</p>} columns={[
            { key: "d", header: "Run", render: (r: any) => <Link to={`/app/allocations/${r.runId}`} className="font-medium hover:underline">{fmtDate(r.createdAt)}</Link> },
            { key: "s", header: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
            { key: "r", header: "Recommended", align: "right", render: (r: any) => money(r.recommendedCents) },
            { key: "v", header: "Viability", align: "right", render: (r: any) => r.marketViability.toFixed(2) },
          ]} />
        </Card>
      </Section>
    </div>
  );
}
