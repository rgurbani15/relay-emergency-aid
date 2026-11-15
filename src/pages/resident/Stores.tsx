import { MapPin } from "lucide-react";
import { categoryLabel } from "@shared/constants";
import { Badge, Card, EmptyState, ErrorState, Notice, PageSkeleton, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function ResidentStores() {
  const { data, error, loading, reload } = useApi<any>("/api/resident/merchants");
  if (loading) return <PageSkeleton cards={1} />;
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={reload} />;
  return (
    <div className="space-y-4">
      <div><h1 className="font-display text-[32px] leading-tight text-evergreen">Participating stores</h1><p className="text-sm text-muted">Where your vouchers can be used.</p></div>
      {data.restrictHomeCommunity && <Notice tone="info">This program lets you shop only in your own community. Stores elsewhere are shown for reference.</Notice>}
      {!data.items.length && <Card><EmptyState title="No stores yet" /></Card>}
      {data.items.map((m: any) => (
        <Card key={m.id} className={`p-4 ${m.usable ? "" : "opacity-60"}`}>
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-navy">{m.name}</h2><p className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-3.5" />{m.communityName} · {m.category}</p></div><div className="flex flex-col items-end gap-1"><StatusBadge status={m.status} />{!m.usable && <Badge tone="neutral">Not in your community</Badge>}</div></div>
          <div className="mt-3 flex flex-wrap gap-1">{m.availableCategories.length ? m.availableCategories.map((c: string) => <Badge key={c} tone="teal">{categoryLabel(c)}</Badge>) : <span className="text-sm text-muted">{m.status === "closed" ? "Currently closed" : "Nothing in stock right now"}</span>}</div>
        </Card>
      ))}
    </div>
  );
}
