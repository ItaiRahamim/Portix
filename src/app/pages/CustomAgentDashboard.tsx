import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Ship,
  XCircle,
  CheckCircle,
  Clock,
  Eye,
  FileText,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { ClearanceBadge } from "../components/StatusBadge";
import {
  mockContainers,
  getShipment,
  getSupplier,
  getImporter,
  getProduct,
  getDocumentsForContainer,
} from "../data/mockData";

export function CustomAgentDashboard() {
  const navigate = useNavigate();

  const enrichedContainers = useMemo(() => {
    return mockContainers.map((c) => {
      const shipment = getShipment(c.shipmentId)!;
      const supplier = getSupplier(shipment.supplierId);
      const importer = getImporter(shipment.importerId);
      const product = getProduct(shipment.productId);
      const docs = getDocumentsForContainer(c.id);
      const totalDocs = docs.length;
      const uploadedDocs = docs.filter((d) => d.status !== "missing").length;
      const pendingReviewDocs = docs.filter(
        (d) => d.status === "under-review" || d.status === "uploaded"
      ).length;
      const rejectedDocs = docs.filter((d) => d.status === "rejected").length;

      return {
        ...c,
        shipmentId: shipment.id,
        importerName: importer?.name || "",
        supplierName: supplier?.name || "",
        productName: product?.name || "",
        totalDocs,
        uploadedDocs,
        pendingReviewDocs,
        rejectedDocs,
      };
    });
  }, []);

  // KPIs
  const containersAwaitingReview = enrichedContainers.filter(
    (c) => c.pendingReviewDocs > 0
  ).length;
  const totalPendingReviewDocs = enrichedContainers.reduce(
    (sum, c) => sum + c.pendingReviewDocs, 0
  );
  const totalRejectedDocs = enrichedContainers.reduce(
    (sum, c) => sum + c.rejectedDocs, 0
  );
  const containersReady = enrichedContainers.filter(
    (c) =>
      c.clearanceStatus === "ready-for-clearance" ||
      c.clearanceStatus === "released"
  ).length;

  return (
    <DashboardLayout
      role="customs-agent"
      title="Container Review Queue"
      subtitle="Review and approve documents per container for import clearance"
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Containers Awaiting Review" value={containersAwaitingReview} icon={Ship} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Documents Pending Review" value={totalPendingReviewDocs} icon={Clock} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Rejected Documents" value={totalRejectedDocs} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Containers Ready for Clearance" value={containersReady} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      {/* Container Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Container Review List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container Number</TableHead>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Importer</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Uploaded Docs</TableHead>
                  <TableHead className="text-center">Pending Review</TableHead>
                  <TableHead className="text-center">Rejected</TableHead>
                  <TableHead>Clearance Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedContainers.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/customs-agent/containers/${c.id}`)}>
                    <TableCell className="whitespace-nowrap">{c.containerNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipmentId}</TableCell>
                    <TableCell className="text-sm">{c.importerName}</TableCell>
                    <TableCell className="text-sm">{c.supplierName}</TableCell>
                    <TableCell className="text-sm max-w-[130px] truncate">{c.productName}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.eta}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${c.totalDocs > 0 ? (c.uploadedDocs / c.totalDocs) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{c.uploadedDocs}/{c.totalDocs}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {c.pendingReviewDocs > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs">
                          {c.pendingReviewDocs}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {c.rejectedDocs > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">
                          {c.rejectedDocs}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClearanceBadge status={c.clearanceStatus} />
                    </TableCell>
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/customs-agent/containers/${c.id}`)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          Review
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
