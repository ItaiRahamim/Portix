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
  Eye,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { ClearanceBadge } from "../components/StatusBadge";
import {
  mockContainers,
  getShipment,
  getSupplier,
  getImporter,
  getDocumentsForContainer,
} from "../data/mockData";

export function CustomsAgentMissingDocs() {
  const navigate = useNavigate();

  const containerRows = useMemo(() => {
    return mockContainers.map((c) => {
      const shipment = getShipment(c.shipmentId)!;
      const supplier = getSupplier(shipment.supplierId);
      const importer = getImporter(shipment.importerId);
      const docs = getDocumentsForContainer(c.id);
      const missingCount = docs.filter((d) => d.status === "missing").length;
      const pendingCount = docs.filter(
        (d) => d.status === "under-review" || d.status === "uploaded"
      ).length;
      const rejectedCount = docs.filter((d) => d.status === "rejected").length;
      return {
        containerId: c.id,
        containerNumber: c.containerNumber,
        shipmentId: shipment.id,
        importerName: importer?.name || "",
        supplierName: supplier?.name || "",
        missingCount,
        pendingCount,
        rejectedCount,
        clearanceStatus: c.clearanceStatus,
      };
    });
  }, []);

  const blockedByMissing = mockContainers.filter(
    (c) => c.clearanceStatus === "missing-documents"
  ).length;
  const blockedByPending = mockContainers.filter(
    (c) => c.clearanceStatus === "waiting-for-review"
  ).length;
  const blockedByRejected = mockContainers.filter(
    (c) => c.clearanceStatus === "rejected-action-required"
  ).length;
  const readyForClearance = mockContainers.filter(
    (c) =>
      c.clearanceStatus === "ready-for-clearance" ||
      c.clearanceStatus === "released"
  ).length;

  return (
    <DashboardLayout
      role="customs-agent"
      title="Document Completeness Overview"
      subtitle="Monitor containers blocked by document issues"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Blocked by Missing Docs" value={blockedByMissing} icon={FileWarning} color="text-gray-600" iconColor="text-gray-500" />
        <KPICard label="Blocked by Pending Review" value={blockedByPending} icon={Clock} color="text-yellow-600" iconColor="text-yellow-500" />
        <KPICard label="Blocked by Rejected Docs" value={blockedByRejected} icon={XCircle} color="text-red-600" iconColor="text-red-500" />
        <KPICard label="Ready for Clearance" value={readyForClearance} icon={CheckCircle} color="text-green-600" iconColor="text-green-500" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Containers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Importer</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-center">Missing Docs</TableHead>
                  <TableHead className="text-center">Pending Review</TableHead>
                  <TableHead className="text-center">Rejected Docs</TableHead>
                  <TableHead>Clearance Readiness</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containerRows.map((row) => (
                  <TableRow key={row.containerId}>
                    <TableCell className="whitespace-nowrap">{row.shipmentId}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.containerNumber}</TableCell>
                    <TableCell className="text-sm">{row.importerName}</TableCell>
                    <TableCell className="text-sm">{row.supplierName}</TableCell>
                    <TableCell className="text-center">
                      {row.missingCount > 0 ? (
                        <span className="text-gray-700">{row.missingCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.pendingCount > 0 ? (
                        <span className="text-yellow-600">{row.pendingCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.rejectedCount > 0 ? (
                        <span className="text-red-600">{row.rejectedCount}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClearanceBadge status={row.clearanceStatus} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/customs-agent/containers/${row.containerId}`)}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Review
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
