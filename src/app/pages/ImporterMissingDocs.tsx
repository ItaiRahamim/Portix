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
  FileWarning,
  Clock,
  XCircle,
  CheckCircle,
  Container as ContainerIcon,
  Eye,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import {
  mockContainers,
  mockDocuments,
  getSupplier,
  getProduct,
  getShipment,
  getDocumentsForContainer,
  daysBetween,
} from "../data/mockData";

export function ImporterMissingDocs() {
  const navigate = useNavigate();

  const containerRows = useMemo(() => {
    return mockContainers
      .filter((c) => {
        const docs = getDocumentsForContainer(c.id);
        return docs.some(
          (d) =>
            d.status === "missing" ||
            d.status === "rejected" ||
            d.status === "under-review"
        );
      })
      .map((c) => {
        const shipment = getShipment(c.shipmentId)!;
        const supplier = getSupplier(shipment.supplierId);
        const product = getProduct(shipment.productId);
        const docs = getDocumentsForContainer(c.id);
        const missing = docs.filter((d) => d.status === "missing");
        const rejected = docs.filter((d) => d.status === "rejected");
        const pending = docs.filter(
          (d) => d.status === "under-review" || d.status === "uploaded"
        );
        const daysToArrival = daysBetween(c.eta);

        let nextAction = "Waiting on supplier";
        if (rejected.length > 0) nextAction = "Supplier must replace rejected docs";
        else if (pending.length > 0) nextAction = "Awaiting customs review";
        else if (missing.length > 0) nextAction = "Supplier must upload docs";

        return {
          containerId: c.id,
          containerNumber: c.containerNumber,
          shipmentId: shipment.id,
          supplierName: supplier?.name || "",
          productName: product?.name || "",
          missingDocs: missing.map((d) => d.type),
          rejectedCount: rejected.length,
          pendingCount: pending.length,
          eta: c.eta,
          daysToArrival,
          nextAction,
        };
      });
  }, []);

  const totalMissing = mockDocuments.filter((d) => d.status === "missing").length;
  const containersMissingCritical = mockContainers.filter((c) => {
    const docs = getDocumentsForContainer(c.id);
    return docs.some((d) => d.status === "missing");
  }).length;
  const containersWaitingReview = mockContainers.filter(
    (c) => c.clearanceStatus === "waiting-for-review"
  ).length;
  const containersRejected = mockContainers.filter(
    (c) => c.clearanceStatus === "rejected-action-required"
  ).length;
  const containersReady = mockContainers.filter(
    (c) =>
      c.clearanceStatus === "ready-for-clearance" ||
      c.clearanceStatus === "released"
  ).length;

  return (
    <DashboardLayout
      role="importer"
      title="Missing Documents Dashboard"
      subtitle="Track containers blocked by missing, rejected, or pending documents"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard label="Total Missing Docs" value={totalMissing} icon={FileWarning} iconColor="text-gray-500" />
        <KPICard label="Containers Missing Critical Docs" value={containersMissingCritical} icon={ContainerIcon} color="text-orange-600" iconColor="text-orange-500" />
        <KPICard label="Waiting for Review" value={containersWaitingReview} icon={Clock} color="text-yellow-600" iconColor="text-yellow-500" />
        <KPICard label="Containers Rejected" value={containersRejected} icon={XCircle} color="text-red-600" iconColor="text-red-500" />
        <KPICard label="Ready for Clearance" value={containersReady} icon={CheckCircle} color="text-green-600" iconColor="text-green-500" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Containers with Document Issues</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Container #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Missing Documents</TableHead>
                  <TableHead className="text-center">Rejected</TableHead>
                  <TableHead className="text-center">Pending Review</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Days to Arrival</TableHead>
                  <TableHead>Next Action</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containerRows.map((row) => (
                  <TableRow key={row.containerId}>
                    <TableCell className="whitespace-nowrap">{row.shipmentId}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.containerNumber}</TableCell>
                    <TableCell className="text-sm">{row.supplierName}</TableCell>
                    <TableCell className="text-sm max-w-[120px] truncate">{row.productName}</TableCell>
                    <TableCell>
                      {row.missingDocs.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {row.missingDocs.map((d) => (
                            <span key={d} className="text-xs text-gray-600">{d}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.rejectedCount > 0 ? (
                        <span className="text-red-600 text-sm">{row.rejectedCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.pendingCount > 0 ? (
                        <span className="text-yellow-600 text-sm">{row.pendingCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{row.eta}</TableCell>
                    <TableCell>
                      <span className={`text-sm ${
                        row.daysToArrival <= 3 ? "text-red-600"
                        : row.daysToArrival <= 7 ? "text-orange-600"
                        : "text-gray-600"
                      }`}>
                        {row.daysToArrival > 0 ? `${row.daysToArrival}d` : "Arrived"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-600 max-w-[140px]">
                      {row.nextAction}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/importer/containers/${row.containerId}`)}>
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        View
                      </Button>
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
