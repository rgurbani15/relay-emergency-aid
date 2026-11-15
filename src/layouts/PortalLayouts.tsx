import { History, LogOut, QrCode, Receipt, Store, Wallet, ShoppingBasket, Boxes, LayoutDashboard, Landmark } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { DemoBanner, Wordmark } from "@/components/brand";
import { useAuth, type User } from "@/lib/auth";
import { cn } from "@/lib/utils";

function useGuard(role: User["role"]) {
  const { user } = useAuth();
  return user && user.role !== role ? <Navigate to="/" replace /> : null;
}

export function ResidentLayout() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const guard = useGuard("resident");
  if (guard) return guard;
  const tabs = [
    { to: "/resident", label: "Home", icon: Wallet, end: true },
    { to: "/resident/vouchers", label: "Vouchers", icon: QrCode },
    { to: "/resident/merchants", label: "Stores", icon: Store },
    { to: "/resident/activity", label: "Activity", icon: History },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-warm">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <Wordmark />
          <button onClick={async () => { await signOut(); nav("/"); }} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-ink/5 hover:text-ink" aria-label={`Sign out ${user?.name ?? ""}`}><LogOut className="size-4" />Sign out</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-5"><Outlet /></main>
      <ChatPanel role="resident" className="bottom-24!" />
      <nav aria-label="Resident" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-warm pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to}><NavLink to={to} end={end} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", isActive ? "text-evergreen" : "text-muted")}><Icon className="size-5" aria-hidden />{label}</NavLink></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function MerchantLayout() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const guard = useGuard("merchant");
  if (guard) return guard;
  const tabs = [
    { to: "/merchant", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/merchant/terminal", label: "POS terminal", icon: ShoppingBasket },
    { to: "/merchant/inventory", label: "Inventory", icon: Boxes },
    { to: "/merchant/sales", label: "Sales", icon: Receipt },
    { to: "/merchant/reimbursements", label: "Reimbursements", icon: Landmark },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <header className="border-b border-line bg-warm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3"><Wordmark /><span className="eyebrow hidden border-l border-line pl-3 sm:inline">Merchant portal</span></div>
          <div className="flex items-center gap-3 text-sm"><span className="hidden font-medium text-ink sm:inline">{user?.name}</span><button onClick={async () => { await signOut(); nav("/"); }} className="flex items-center gap-1.5 text-muted hover:text-ink"><LogOut className="size-4" />Sign out</button></div>
        </div>
        <nav aria-label="Merchant" className="scroll-thin mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 sm:px-5">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium", isActive ? "border-evergreen text-evergreen" : "border-transparent text-muted hover:text-ink")}><Icon className="size-4" aria-hidden />{label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6"><Outlet /></main>
      <ChatPanel role="merchant" />
    </div>
  );
}
