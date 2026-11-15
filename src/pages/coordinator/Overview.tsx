import { ArrowRight, Info, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, CHART, ChartCard, InfoTip } from "@/components/domain";
import { Meter, SplitBar, viabilityTone } from "@/components/viz";
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, Segmented, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { cn, fmtDate, money, pct, timeAgo } from "@/lib/utils";

const trendText = (cur: number, prev: number) => {
  if (!prev) return cur ? "New activity this week" : "No change from prior 7 days";
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(0)}% on the prior 7 days`;
};
const SEV: Record<string, string> = { critical: "bg-danger", warning: "bg-warning", info: "bg-info" };

export default function Overview() {
  const { programId, loading: pl } = useProgram();
  const [days, setDays] = useState<7 | 30>(30);
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<any>(programId ? `/api/overview?programId=${programId}&days=${days}` : null);
  if (pl || loading) return <PageSkeleton cards={3} />;
  if (!programId) return <EmptyState title="No programs yet" message="Create a program to get started." action={<Link to="/app/programs"><Button>Go to programs</Button></Link>} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  const k = data.kpis;
  const budget = k.budgetCents || 1;
  const chartData = data.series.map((s: any) => ({ day: s.day.slice(5), Redeemed: s.redeemedCents / 100, Issued: s.issuedCents / 100 }));
  const seg = [["Redeemed", k.redeemedCents, "bg-forest"], ["Issued, not yet redeemed", Math.max(0, k.issuedCents - k.redeemedCents), "bg-sage"], ["Unissued budget", Math.max(0, k.budgetCents - k.issuedCents), "bg-softneutral"]] as const;

  return (
    <div>
      <PageHeader eyebrow="Workspace / Overview" title="Overview" subtitle="A clear picture of assistance, market capacity, and community needs."
        actions={<><Segmented label="Date range" value={days} onChange={setDays} options={[{ value: 7, label: "7 days" }, { value: 30, label: "30 days" }]} /><Link to="/app/intelligence"><Button><Sparkles className="size-4" />Run analysis</Button></Link></>} />

      <section aria-label="Financial overview" className="grid gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-[1.5fr_1fr]">
        <div className="bg-card p-7">
          <div className="eyebrow flex gap-1"><h2 className="font-semibold">{data.program.name}</h2><span>· total assistance budget</span></div>
          <p className="font-display tabular mt-2 text-[40px] font-normal leading-none text-evergreen sm:text-[46px]">{money(k.budgetCents)}</p>
          <p className="mt-3 text-sm text-muted">{data.program.emergencyType} · {data.program.region} · {fmtDate(data.program.startDate)} to {fmtDate(data.program.endDate)} <span className="ml-2 align-middle"><StatusBadge status={data.program.status} /></span></p>
          <div className="mt-7 flex h-3 overflow-hidden rounded-sm bg-softneutral" role="img" aria-label="Budget breakdown">{seg.map(([l, v, c]) => <div key={l} className={c} style={{ width: `${(v / budget) * 100}%` }} />)}</div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-secondary">{seg.map(([l, v, c]) => <div key={l} className="flex items-center gap-1.5"><i className={cn("size-2.5 rounded-sm", c)} /><dt>{l}</dt><dd className="tabular font-medium text-ink">{money(v, true)}</dd></div>)}</dl>
        </div>
        <dl className="divide-y divide-line bg-card">
          {[
            ["Allocated assistance", money(k.allocatedCents, true), "Approved plan; not yet issued"],
            ["Assistance redeemed", money(k.redeemedCents, true), trendText(k.trends.redeemed.last7Cents, k.trends.redeemed.prev7Cents)],
            ["Issued as vouchers", money(k.issuedCents, true), `${((k.issuedCents / budget) * 100).toFixed(1)}% of budget · ${money(k.trends.issued.last7Cents, true)} in the last 7 days`],
            ["Outstanding merchant claims", money(k.outstandingClaimsCents, true), "Pending plus approved, unpaid"],
          ].map(([l, v, s]) => <div key={l} className="px-7 py-4"><dt className="eyebrow">{l}</dt><dd className="tabular mt-1 text-[26px] font-medium leading-tight text-evergreen">{v}</dd><dd className="mt-0.5 text-xs text-secondary">{s}</dd></div>)}
        </dl>
      </section>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary"><Info className="size-3.5" aria-hidden />Allocated = approved allocation plan · Issued = vouchers actually created · Outstanding = merchant claims pending or approved. As of {fmtDate(data.asOf)}.</p>

      <section className="mt-12" aria-labelledby="cc">
        <div className="mb-4 flex items-end justify-between"><div><p className="eyebrow">Market conditions</p><h2 id="cc" className="font-display mt-1 text-[26px] text-evergreen">Community conditions</h2></div><Link to="/app/communities" className="text-sm font-medium text-forest hover:underline">View communities</Link></div>
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1.1fr_1.3fr_.9fr_.9fr_.9fr_1.5fr] gap-5 border-b border-border-strong px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary lg:grid"><span>Community</span><span>Market viability</span><span>Need severity</span><span>Merchant coverage</span><span>Inventory coverage</span><span>Recommended mix</span></div>
          <div className="divide-y divide-line">
            {data.communities.map((c: any) => (
              <button key={c.communityId} onClick={() => nav(`/app/communities/${c.communityId}`)} className="grid w-full gap-x-5 gap-y-3 px-6 py-5 text-left hover:bg-softneutral/50 sm:grid-cols-2 lg:grid-cols-[1.1fr_1.3fr_.9fr_.9fr_.9fr_1.5fr] lg:items-center">
                <span><span className="block font-semibold text-ink">{c.name}</span><span className="text-xs text-secondary">{c.populationNeeding.toLocaleString()} people in need · {c.operatingMerchants}/{c.participatingMerchants} merchants open</span></span>
                <Ind label="Market viability" v={c.marketViability} text={c.marketViability.toFixed(2)} tone={viabilityTone(c.marketViability)} />
                <Ind label="Need severity" v={c.needSeverity / 100} text={`${c.needSeverity}/100`} tone={c.needSeverity >= 70 ? "bad" : c.needSeverity >= 45 ? "mid" : "neutral"} />
                <Ind label="Merchant coverage" v={c.merchantCoverage / 100} text={`${c.merchantCoverage}%`} tone={c.merchantCoverage >= 75 ? "good" : c.merchantCoverage >= 40 ? "mid" : "bad"} />
                <Ind label="Inventory coverage" v={c.inventoryCoverage} text={pct(c.inventoryCoverage)} tone={c.inventoryCoverage >= 0.7 ? "good" : c.inventoryCoverage >= 0.4 ? "mid" : "bad"} />
                <span className="sm:col-span-2 lg:col-span-1"><SplitBar voucherPct={c.voucherPct} /></span>
              </button>
            ))}
          </div>
        </Card>
      </section>

      <div className="mt-12 grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <ChartCard title="Assistance activity" subtitle="Vouchers issued and redeemed, daily value in US dollars" height={300} footer="Forest line: redeemed. Sage bars: issued.">
          <ComposedChart data={chartData} margin={{ left: -8, right: 8, top: 8 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} tickFormatter={(v) => `$${v >= 1000 ? `${v / 1000}k` : v}`} width={48} />
            <Tooltip formatter={(v, n) => [`$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, String(n)]} contentStyle={{ borderRadius: 8, border: `1px solid ${CHART.grid}`, background: "#FFFDF8" }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Issued" fill={CHART.sage} radius={[2, 2, 0, 0]} maxBarSize={14} />
            <Line type="monotone" dataKey="Redeemed" stroke={CHART.teal} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ChartCard>

        <Card id="alerts" className="flex flex-col scroll-mt-20">
          <CardHeader title="Priority alerts" subtitle="Shortages, merchant status, budget" />
          <ul className="scroll-thin max-h-[300px] divide-y divide-line overflow-y-auto">
            {data.alerts.length === 0 && <li><EmptyState title="All clear" message="No active alerts for this program." icon={<Info className="size-5" />} /></li>}
            {data.alerts.map((a: any) => (
              <li key={a.id} className="flex gap-3 px-5 py-3"><span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEV[a.severity] ?? "bg-info")} aria-hidden /><div><p className="text-[13.5px] font-medium text-ink"><span className="sr-only">{a.severity}: </span>{a.title}</p><p className="text-xs text-secondary">{a.detail}</p></div></li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Recent activity" subtitle="Voucher redemptions, newest first" action={<Link to="/app/transactions" className="text-sm font-medium text-forest hover:underline">Full ledger</Link>} />
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead><tr className="border-b border-border-strong text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary"><th className="px-5 py-2.5">Event</th><th className="py-2.5">Actor</th><th className="py-2.5">Community</th><th className="py-2.5 text-right">Amount</th><th className="px-5 py-2.5 text-right">When</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.recentTransactions.map((t: any) => (
                  <tr key={t.id}><td className="px-5 py-2.5"><span className="font-medium text-ink">Redemption</span> <span className="font-mono text-xs text-secondary">{t.receiptNo}</span></td><td className="py-2.5 text-muted">{t.merchantName}</td><td className="py-2.5 text-muted">{t.communityName}</td><td className="tabular py-2.5 text-right font-medium text-ink">{money(t.amountCents)}</td><td className="px-5 py-2.5 text-right text-xs text-secondary">{timeAgo(t.createdAt)}</td></tr>
                ))}
                {!data.recentTransactions.length && <tr><td colSpan={5}><EmptyState title="No redemptions yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Latest recommendation" subtitle={data.latestAllocation ? `Generated ${timeAgo(data.latestAllocation.createdAt)}` : undefined} action={data.latestAllocation && <StatusBadge status={data.latestAllocation.status} />} />
          {data.latestAllocation ? (
            <div className="space-y-3 p-5">
              {data.latestAllocation.recommendations.map((r: any) => (
                <div key={r.communityId}><div className="flex items-baseline justify-between text-sm"><span className="font-medium text-ink">{r.communityName}</span><span className="tabular font-semibold text-evergreen">{money(r.recommendedCents)}</span></div><SplitBar voucherPct={r.voucherPct} showLabels={false} className="mt-1" /></div>
              ))}
              <div className="flex items-center justify-between border-t border-line pt-3"><span className="text-sm text-muted">Total <span className="tabular font-semibold text-ink">{money(data.latestAllocation.totalCents)}</span></span><Link to={`/app/allocations/${data.latestAllocation.id}`}><Button variant="outline" size="sm">Review <ArrowRight className="size-4" /></Button></Link></div>
            </div>
          ) : <EmptyState title="No analysis run yet" message="Run RELAY Intelligence to generate recommendations." action={<Link to="/app/intelligence"><Button size="sm">Open Intelligence</Button></Link>} />}
        </Card>
      </div>
      <div className="mt-6"><InfoTip>This is a demonstration with synthetic data. Allocation recommendations are decision support only; approving a plan records a decision and does not move money.</InfoTip></div>
    </div>
  );
}

function Ind({ label, v, text, tone }: { label: string; v: number; text: string; tone: "good" | "mid" | "bad" | "neutral" }) {
  return <span className="block"><span className="mb-1 flex justify-between text-xs lg:hidden"><span className="text-secondary">{label}</span></span><span className="flex items-center gap-3"><Meter value={v} tone={tone} label={`${label} ${text}`} className="flex-1" /><span className="tabular w-12 text-right text-[13px] font-medium text-ink">{text}</span></span></span>;
}
