import { createBrowserRouter } from "react-router";
import { LandingPage } from "./pages/LandingPage";
import { ImporterDashboard } from "./pages/ImporterDashboard";
import { SupplierDashboard } from "./pages/SupplierDashboard";
import { CustomAgentDashboard } from "./pages/CustomAgentDashboard";
import { ImporterMissingDocs } from "./pages/ImporterMissingDocs";
import { SupplierMissingDocs } from "./pages/SupplierMissingDocs";
import { CustomsAgentMissingDocs } from "./pages/CustomsAgentMissingDocs";
import { ShipmentDetailPage } from "./pages/ShipmentDetailPage";
import { ContainerDetailPage } from "./pages/ContainerDetailPage";
import { AccountsPage } from "./pages/AccountsPage";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { ClaimsPage } from "./pages/ClaimsPage";
import { ClaimDetailPage } from "./pages/ClaimDetailPage";
import { LicensesPage } from "./pages/LicensesPage";

function ImporterShipmentDetail() {
  return <ShipmentDetailPage role="importer" />;
}
function SupplierShipmentDetail() {
  return <ShipmentDetailPage role="supplier" />;
}
function CustomsShipmentDetail() {
  return <ShipmentDetailPage role="customs-agent" />;
}
function ImporterContainerDetail() {
  return <ContainerDetailPage role="importer" />;
}
function SupplierContainerDetail() {
  return <ContainerDetailPage role="supplier" />;
}
function CustomsContainerDetail() {
  return <ContainerDetailPage role="customs-agent" />;
}
function ImporterAccounts() {
  return <AccountsPage role="importer" />;
}
function SupplierAccounts() {
  return <AccountsPage role="supplier" />;
}
function CustomsAccounts() {
  return <AccountsPage role="customs-agent" />;
}
function ImporterAccountDetail() {
  return <AccountDetailPage role="importer" />;
}
function SupplierAccountDetail() {
  return <AccountDetailPage role="supplier" />;
}
function CustomsAccountDetail() {
  return <AccountDetailPage role="customs-agent" />;
}

export const router = createBrowserRouter([
  { path: "/", Component: LandingPage },

  // Importer routes
  { path: "/importer", Component: ImporterDashboard },
  { path: "/importer/shipments/:shipmentId", Component: ImporterShipmentDetail },
  { path: "/importer/containers/:containerId", Component: ImporterContainerDetail },
  { path: "/importer/missing-docs", Component: ImporterMissingDocs },
  { path: "/importer/accounts", Component: ImporterAccounts },
  { path: "/importer/accounts/:accountId", Component: ImporterAccountDetail },
  { path: "/importer/claims", Component: ClaimsPage },
  { path: "/importer/claims/:claimId", Component: ClaimDetailPage },
  { path: "/importer/licenses", Component: LicensesPage },

  // Supplier routes
  { path: "/supplier", Component: SupplierDashboard },
  { path: "/supplier/shipments/:shipmentId", Component: SupplierShipmentDetail },
  { path: "/supplier/containers/:containerId", Component: SupplierContainerDetail },
  { path: "/supplier/missing-docs", Component: SupplierMissingDocs },
  { path: "/supplier/accounts", Component: SupplierAccounts },
  { path: "/supplier/accounts/:accountId", Component: SupplierAccountDetail },

  // Customs Agent routes
  { path: "/customs-agent", Component: CustomAgentDashboard },
  { path: "/customs-agent/shipments/:shipmentId", Component: CustomsShipmentDetail },
  { path: "/customs-agent/containers/:containerId", Component: CustomsContainerDetail },
  { path: "/customs-agent/missing-docs", Component: CustomsAgentMissingDocs },
  { path: "/customs-agent/accounts", Component: CustomsAccounts },
  { path: "/customs-agent/accounts/:accountId", Component: CustomsAccountDetail },
]);
