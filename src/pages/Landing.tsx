import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark, Wordmark } from "@/components/brand";
import { Meter, SplitBar, viabilityTone } from "@/components/viz";
import { useApi } from "@/lib/api";
import { num } from "@/lib/utils";

type Preview = { program: string | null; communities: { name: string; viability: number; voucherPct: number; directPct: number; actionLabel: string; risk: string; shortageUnits: number }[] };

/** Recommendation preview computed by the same shared engine as the coordinator console, from the seeded demo database. */
function useLivePreview() {
  const { data, error, loading } = useApi<Preview>("/api/public/preview");
  const rows = [...(data?.communities ?? [])].sort((a, b) => b.viability - a.viability);
  return { rows, program: data?.program ?? "Pine Valley Wildfire Response", error, loading };
}

function AssessmentPanel({ compact }: { compact?: boolean }) {
  const { rows, program, error, loading } = useLivePreview();
  return (
    <figure className="overflow-hidden rounded-[10px] border border-border-strong bg-warm" aria-label="RELAY Intelligence preview">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div><p className="eyebrow">Market assessment</p><p className="mt-0.5 text-[15px] font-semibold text-evergreen">{program}</p></div>
        <span className="text-[11px] text-secondary">Computed live · synthetic data</span>
      </div>
      {loading && <p className="px-5 py-8 text-sm text-secondary">Computing from the demo database…</p>}
      {!loading && (error || rows.length === 0) && <p className="px-5 py-8 text-sm text-secondary">The live preview is unavailable right now. Sign in to run the engine yourself.</p>}
      <div className="divide-y divide-line">
        {rows.map((c) => (
          <div key={c.name} className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[7.5rem_1fr_1fr]">
            <div><p className="font-semibold text-ink">{c.name}</p><p className="mt-0.5 text-xs text-secondary">{c.shortageUnits > 0 ? `${num(c.shortageUnits)} units short` : "No projected shortage"}</p></div>
            <div><div className="mb-1 flex items-baseline justify-between"><span className="eyebrow">Market viability</span><span className="tabular text-lg font-medium text-evergreen">{c.viability.toFixed(2)}</span></div><Meter value={c.viability} tone={viabilityTone(c.viability)} label={`Market viability ${c.viability.toFixed(2)}`} /></div>
            <div><p className="eyebrow mb-1">Recommended mix</p><SplitBar voucherPct={c.voucherPct} /></div>
            {!compact && <p className="text-xs text-secondary sm:col-span-3">{c.actionLabel}.</p>}
          </div>
        ))}
      </div>
    </figure>
  );
}

function DashboardPanel() {
  const { rows } = useLivePreview();
  return (
    <figure className="overflow-hidden rounded-[10px] border border-border-strong bg-paper" aria-label="Coordinator dashboard preview">
      <div className="grid grid-cols-[9rem_1fr]">
        <div className="hidden bg-evergreen p-4 sm:block" aria-hidden><LogoMark tone="dark" className="size-6" />{["Overview", "Relief Programs", "Communities", "Merchants", "Inventory", "RELAY Intelligence"].map((n, i) => <p key={n} className={`mt-2.5 rounded px-2 py-1 text-[11px] ${i === 0 ? "bg-forest text-warm" : "text-sidebar-muted"}`}>{n}</p>)}</div>
        <div className="col-span-2 p-5 sm:col-span-1">
          <p className="eyebrow">Workspace / Overview</p>
          <p className="font-display mt-1 text-2xl text-evergreen">Community conditions</p>
          <div className="mt-4 divide-y divide-line rounded-md border border-line bg-warm">
            {rows.map((c) => (
              <div key={c.name} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[6rem_1fr_5rem]">
                <span className="text-[13px] font-medium text-ink">{c.name}</span>
                <Meter value={c.viability} tone={viabilityTone(c.viability)} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto" />
                <span className="tabular text-right text-[13px] text-ink">{Math.round(c.voucherPct * 100)}% vouchers</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

const NAV = [["Platform", "#platform"], ["Intelligence", "#intelligence"], ["How it works", "#how"], ["About", "#about"]];

export default function Landing() {
  return (
    <div className="bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5 sm:px-8">
          <Link to="/" aria-label="RELAY home"><Wordmark /></Link>
          <nav aria-label="Main" className="hidden gap-8 text-[14px] font-medium text-secondary md:flex">{NAV.map(([l, h]) => <a key={h} href={h} className="hover:text-evergreen">{l}</a>)}</nav>
          <div className="flex items-center gap-2">
            <Link to="/sign-in" className="hidden h-9 items-center rounded-md px-3 text-[14px] font-medium text-ink hover:bg-softneutral sm:inline-flex">Sign in</Link>
            <Link to="/sign-in" className="inline-flex h-9 items-center rounded-md bg-evergreen px-4 text-[14px] font-medium text-warm hover:bg-forest">Launch Demo</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1200px] gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pt-20">
        <div className="flex flex-col justify-center">
          <p className="eyebrow">Emergency aid / Market intelligence</p>
          <h1 className="font-display mt-5 text-[42px] font-normal leading-[1.05] text-evergreen sm:text-[56px]">Assistance should reach people where it can make a difference.</h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted">RELAY connects emergency financial assistance with real-world market capacity, helping relief organizations understand where communities can access essential goods and where direct supply support is needed.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/sign-in" className="inline-flex h-11 items-center gap-2 rounded-md bg-evergreen px-6 text-[15px] font-medium text-warm hover:bg-forest">Explore the Platform <ArrowRight className="size-4" /></Link>
            <a href="#how" className="inline-flex h-11 items-center rounded-md border border-border-strong bg-warm px-6 text-[15px] font-medium text-ink hover:bg-softneutral">See How It Works</a>
          </div>
          <p className="mt-6 text-[13px] text-secondary">Synthetic Pine Valley wildfire scenario · three communities · eight merchants</p>
        </div>
        <div className="lg:pt-4"><AssessmentPanel /></div>
      </section>

      <section id="about" className="border-y border-line bg-warm">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <p className="eyebrow">The problem</p>
          <h2 className="font-display mt-3 max-w-3xl text-[34px] leading-tight text-evergreen sm:text-[44px]">Financial assistance alone cannot solve a supply shortage.</h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
            <article className="md:pr-10"><p className="font-display text-5xl text-sage">1</p><h3 className="mt-4 text-lg font-semibold text-ink">Uneven market access</h3><p className="mt-2 leading-relaxed text-muted">Some neighborhoods sit beside open, well-run stores. Others are cut off by closed roads or evacuated shops. The same dollar buys very different things depending on where a family lives.</p></article>
            <article className="md:px-10"><p className="font-display text-5xl text-sage">2</p><h3 className="mt-4 text-lg font-semibold text-ink">Limited merchant inventory</h3><p className="mt-2 leading-relaxed text-muted">A voucher is only worth something if shelves are stocked. When water and food run out, additional money chases the same small supply.</p></article>
            <article className="md:pl-10"><p className="font-display text-5xl text-sage">3</p><h3 className="mt-4 text-lg font-semibold text-ink">Mismatched aid distribution</h3><p className="mt-2 leading-relaxed text-muted">Sending the same kind of help everywhere wastes it. Strong markets can absorb vouchers. Weak markets need goods delivered directly.</p></article>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
        <p className="eyebrow">How RELAY works</p>
        <h2 className="font-display mt-3 max-w-3xl text-[34px] leading-tight text-evergreen sm:text-[44px]">From community needs to effective assistance.</h2>
        <ol className="mt-12 grid gap-0 border-t border-border-strong md:grid-cols-3">
          {[["01", "Assess", "Understand population needs, market access, merchant availability, and inventory."], ["02", "Analyze", "Evaluate market viability and estimate essential supply shortages."], ["03", "Allocate", "Recommend the appropriate combination of digital assistance and direct supply distribution."]].map(([n, t, d], i) => (
            <li key={n} className={`border-b border-line py-8 md:border-b-0 md:py-10 ${i > 0 ? "md:border-l md:pl-8" : ""} ${i < 2 ? "md:pr-8" : ""}`}><p className="tabular text-sm font-semibold text-forest">{n}</p><h3 className="font-display mt-3 text-3xl text-evergreen">{t}</h3><p className="mt-2 leading-relaxed text-muted">{d}</p></li>
          ))}
        </ol>
        <p className="mt-6 max-w-3xl text-sm text-secondary">RELAY is a cloud-hosted coordination tool. It recommends; people approve. Nothing moves money or executes without a coordinator&apos;s decision.</p>
      </section>

      <section id="platform" className="border-y border-line bg-softsage">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
          <p className="eyebrow !text-forest">Platform overview</p>
          <h2 className="font-display mt-3 max-w-2xl text-[34px] leading-tight text-evergreen sm:text-[40px]">One shared picture for coordinators, merchants and residents.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-6">
            <div className="rounded-[10px] bg-evergreen p-8 text-warm md:col-span-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-sidebar-muted">Market intelligence</p><h3 className="font-display mt-3 text-3xl">Know whether the market can serve the need.</h3><p className="mt-3 max-w-lg leading-relaxed text-sidebar-muted">Every community gets a viability score from market access, merchant coverage and capacity, and inventory sufficiency. The recommended share of vouchers versus direct supply follows from it, with the formula visible.</p></div>
            <div className="rounded-[10px] border border-border-strong bg-warm p-6 md:col-span-2"><p className="eyebrow">Demand forecasting</p><h3 className="mt-3 text-lg font-semibold text-ink">Forecasts that earn their place</h3><p className="mt-2 text-sm leading-relaxed text-muted">Short-term demand is compared with a simple baseline on held-out days, so you can see whether the model helps.</p></div>
            <div className="rounded-[10px] border border-border-strong bg-warm p-6 md:col-span-2"><p className="eyebrow">Financial assistance</p><h3 className="mt-3 text-lg font-semibold text-ink">Signed, single-use vouchers</h3><p className="mt-2 text-sm leading-relaxed text-muted">Residents show a QR voucher. Redemption updates balance, stock and ledger together in one atomic step.</p></div>
            <div className="rounded-[10px] border border-border-strong bg-warm p-6 md:col-span-4"><p className="eyebrow">Merchant coordination</p><h3 className="mt-3 text-lg font-semibold text-ink">A fast terminal and a clear reimbursement trail</h3><p className="mt-2 text-sm leading-relaxed text-muted">Merchants scan or type a code, confirm eligible items, and track claims from submission to review. Approving a claim records a decision; it does not imply payment.</p></div>
          </div>
        </div>
      </section>

      <section id="intelligence" className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8">
        <p className="eyebrow">Product preview</p>
        <h2 className="font-display mt-3 max-w-3xl text-[34px] leading-tight text-evergreen sm:text-[44px]">The coordinator workspace, as it runs today.</h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-2"><DashboardPanel /><AssessmentPanel compact /></div>
        <p className="mt-4 text-sm text-secondary">Both panels are computed live from the demo database by the same allocation engine used inside the app.</p>
      </section>

      <section className="bg-evergreen">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-center">
          <h2 className="font-display max-w-xl text-[36px] leading-tight text-warm sm:text-[46px]">Build a more resilient response.</h2>
          <Link to="/sign-in" className="inline-flex h-12 items-center gap-2 rounded-md bg-warm px-7 text-[15px] font-medium text-evergreen hover:bg-softsage">Explore RELAY <ArrowUpRight className="size-4" /></Link>
        </div>
      </section>

      <footer className="bg-paper">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div><Wordmark /><p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">Assistance should reach people where it can make a difference. RELAY is a demonstration product: synthetic data, no real money, no banks, no personal information.</p></div>
          <nav aria-label="Footer"><p className="eyebrow mb-3">Explore</p><ul className="space-y-2 text-sm text-ink">{NAV.map(([l, h]) => <li key={h}><a href={h} className="hover:underline">{l}</a></li>)}</ul></nav>
          <div><p className="eyebrow mb-3">Access</p><ul className="space-y-2 text-sm text-ink"><li><Link to="/sign-in" className="hover:underline">Sign in</Link></li><li><Link to="/sign-in" className="hover:underline">Launch demo</Link></li></ul></div>
        </div>
        <p className="border-t border-line px-5 py-5 text-center text-xs text-secondary">Recommendations are decision support, not scientifically validated, and always require human approval.</p>
      </footer>
    </div>
  );
}
