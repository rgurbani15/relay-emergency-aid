import { ENGINE } from "@shared/constants";
import { InfoTip } from "@/components/domain";
import { Card, DL, PageHeader, Section } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Settings() {
  const { user, demoMode } = useAuth();
  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="Account, environment and the rules behind the numbers." />
      <Section n="01" title="Account"><Card><div className="p-5"><DL items={[["Name", user?.name], ["Email", user?.email], ["Role", "Relief coordinator"], ["Session", "HttpOnly cookie, expires after 8 hours"]]} /></div></Card></Section>
      <Section n="02" title="Environment"><Card><div className="space-y-4 p-5"><DL items={[["Mode", demoMode ? "Demonstration" : "Production"], ["Data", "Synthetic (Pine Valley wildfire scenario)"], ["Money movement", "None. No banks or payment processors are connected."], ["Currency handling", "Integer cents end to end"]]} />
        <InfoTip>Reimbursement approvals and allocation approvals record decisions only. Nothing in this demo pays a merchant or purchases supplies.</InfoTip></div></Card></Section>
      <Section n="03" title="Definitions"><Card>
        <dl className="divide-y divide-line text-sm">{[["Allocated", "The total of the currently approved allocation plan. A plan, not money spent."], ["Issued", "Value of vouchers actually created for residents (excludes cancelled)."], ["Redeemed", "Value of completed redemptions, net of reversals."], ["Outstanding claims", "Merchant reimbursement claims that are pending or approved."], ["Budget basis", "Program budget minus issued vouchers; the pool the engine distributes."]].map(([k, v]) => <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_1fr]"><dt className="font-medium text-ink">{k}</dt><dd className="text-muted">{v}</dd></div>)}</dl></Card></Section>
      <Section n="04" title="Allocation engine constants"><Card><p className="border-b border-line px-5 py-3 text-xs text-secondary">Read-only. These are the weights used by every recommendation.</p>
        <div className="p-5"><DL items={[["Market access weight", ENGINE.viabilityWeights.marketAccess], ["Effective merchant capacity weight", ENGINE.viabilityWeights.merchantCapacity], ["Inventory coverage weight", ENGINE.viabilityWeights.inventoryCoverage], ["Voucher share", `${ENGINE.voucherShare.base} + ${ENGINE.voucherShare.slope} × viability (${ENGINE.voucherShare.min}–${ENGINE.voucherShare.max})`], ["Priority weights", `population ${ENGINE.priorityWeights.population} · severity ${ENGINE.priorityWeights.severity} · deficit ${ENGINE.priorityWeights.deficit}`], ["Forecast", `damped Holt α ${ENGINE.forecast.alpha}, β ${ENGINE.forecast.beta}, φ ${ENGINE.forecast.phi}`]]} /></div></Card></Section>
    </div>
  );
}
