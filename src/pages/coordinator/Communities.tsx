import { useNavigate } from "react-router-dom";
import { CommunityCard, RiskBadge } from "@/components/domain";
import { ErrorState, PageHeader, PageSkeleton, EmptyState, Card, DataTable } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useProgram } from "@/lib/program";
import { num, pct } from "@/lib/utils";

export default function Communities() {
  const { programId } = useProgram();
  const { data, error, loading, reload } = useApi<{ items: any[] }>(programId ? `/api/communities?programId=${programId}` : null);
  const nav = useNavigate();
  if (loading) return <PageSkeleton cards={3} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  if (!data.items.length) return <EmptyState title="No communities" message="This program has no participating communities." />;
  return (
    <div>
      <PageHeader title="Communities" subtitle="Need, merchant coverage and market viability for the selected program." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 [&>*]:min-w-0">
        {data.items.filter((c) => c.live).map((c) => <CommunityCard key={c.id} onClick={() => nav(`/app/communities/${c.id}`)} c={{ ...c.live, topGap: c.live.topGaps[0] ?? null }} />)}
      </div>
      <Card className="mt-6">
        <DataTable rows={data.items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/app/communities/${r.id}`)} caption="Communities"
          columns={[
            { key: "name", header: "Community", render: (r) => r.name },
            { key: "pop", header: "Population", align: "right", render: (r) => num(r.population) },
            { key: "need", header: "In need", align: "right", render: (r) => num(r.populationNeeding) },
            { key: "sev", header: "Severity", align: "right", hideOnMobile: true, render: (r) => `${r.needSeverity}/100` },
            { key: "acc", header: "Market access", align: "right", hideOnMobile: true, render: (r) => `${r.marketAccessScore}/100` },
            { key: "cov", header: "Stock cover", align: "right", render: (r) => (r.live ? pct(r.live.inventoryCoverage) : "—") },
            { key: "risk", header: "Risk", render: (r) => (r.live ? <RiskBadge risk={r.live.risk} /> : "—") },
          ]} />
      </Card>
    </div>
  );
}
