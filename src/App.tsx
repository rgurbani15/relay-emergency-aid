import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { PageSkeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import CoordinatorLayout from "@/layouts/CoordinatorLayout";
import { MerchantLayout, ResidentLayout } from "@/layouts/PortalLayouts";

const Landing = lazy(() => import("@/pages/Landing"));
const SignIn = lazy(() => import("@/pages/SignIn"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const c = (n: string) => lazy(() => import(`./pages/coordinator/${n}.tsx`));
const Overview = c("Overview"), Programs = c("Programs"), ProgramDetail = c("ProgramDetail"), Communities = c("Communities"), CommunityDetail = c("CommunityDetail"), Residents = c("Residents"), ResidentDetail = c("ResidentDetail"), Merchants = c("Merchants"), MerchantDetail = c("MerchantDetail"), InventoryPage = c("Inventory"), Transactions = c("Transactions"), Intelligence = c("Intelligence"), Allocations = c("Allocations"), AllocationDetail = c("AllocationDetail"), Reconciliation = c("Reconciliation"), Reports = c("Reports"), Audit = c("Audit"), SettingsPage = c("Settings");
const ResidentHome = lazy(() => import("@/pages/resident/Home")), ResidentVouchers = lazy(() => import("@/pages/resident/Vouchers")), ResidentStores = lazy(() => import("@/pages/resident/Stores")), ResidentActivity = lazy(() => import("@/pages/resident/Activity"));
const MerchantDashboard = lazy(() => import("@/pages/merchant/Dashboard")), Terminal = lazy(() => import("@/pages/merchant/Terminal")), MerchantInventory = lazy(() => import("@/pages/merchant/Inventory")), Sales = lazy(() => import("@/pages/merchant/Sales")), Reimbursements = lazy(() => import("@/pages/merchant/Reimbursements"));

/** Client-side route protection is only UX; every API call is re-checked on the server. */
function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-8"><PageSkeleton /></div>;
  if (!user) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-8"><PageSkeleton /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/app" element={<Protected><CoordinatorLayout /></Protected>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="programs" element={<Programs />} />
          <Route path="programs/:id" element={<ProgramDetail />} />
          <Route path="communities" element={<Communities />} />
          <Route path="communities/:id" element={<CommunityDetail />} />
          <Route path="residents" element={<Residents />} />
          <Route path="residents/:id" element={<ResidentDetail />} />
          <Route path="merchants" element={<Merchants />} />
          <Route path="merchants/:id" element={<MerchantDetail />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="intelligence" element={<Intelligence />} />
          <Route path="allocations" element={<Allocations />} />
          <Route path="allocations/:id" element={<AllocationDetail />} />
          <Route path="reconciliation" element={<Reconciliation />} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound inApp />} />
        </Route>
        <Route path="/resident" element={<Protected><ResidentLayout /></Protected>}>
          <Route index element={<ResidentHome />} />
          <Route path="vouchers" element={<ResidentVouchers />} />
          <Route path="merchants" element={<ResidentStores />} />
          <Route path="activity" element={<ResidentActivity />} />
        </Route>
        <Route path="/merchant" element={<Protected><MerchantLayout /></Protected>}>
          <Route index element={<MerchantDashboard />} />
          <Route path="terminal" element={<Terminal />} />
          <Route path="inventory" element={<MerchantInventory />} />
          <Route path="sales" element={<Sales />} />
          <Route path="reimbursements" element={<Reimbursements />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
