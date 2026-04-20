import { useState, useMemo } from "react";
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
  XCircle,
  Upload,
  AlertTriangle,
  Eye,
  Plus,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { DocumentUploadModal } from "../components/DocumentUploadModal";
import {
  mockContainers,
  getShipment,
  getImporter,
  getProduct,
  getDocumentsForContainer,
  daysBetween,
} from "../data/mockData";

export function SupplierDashboard() {
  const navigate = useNavigate();
  const [showUpload, setShowUpload] = useState(false);

  const enrichedContainers = useMemo(() => {
    return mockContainers.map((c) => {
      const shipment = getShipment(c.shipmentId)!;
      const importer = getImporter(shipment.importerId);
      const product = getProduct(shipment.productId);
      const docs = getDocumentsForContainer(c.id);
      const requiredDocs = docs.length;
      const uploadedDocs = docs.filter((d) => d.status !== "missing").length;
      const rejectedDocs = docs.filter((d) => d.status === "rejected").length;
      const missingDocs = docs.filter((d) => d.status === "missing").length;
      const underReviewDocs = docs.filter((d) => d.status === "under-review").length;
      const approvedDocs = docs.filter((d) => d.status === "approved").length;

      let reviewStatus = "Pending";
      if (rejectedDocs > 0) reviewStatus = "Has Rejections";
      else if (approvedDocs === requiredDocs && requiredDocs > 0) reviewStatus = "All Approved";
      else if (underReviewDocs > 0) reviewStatus = "Under Review";
      else if (missingDocs === requiredDocs) reviewStatus = "Not Started";

      let nextAction = "Upload missing docs";
      if (rejectedDocs > 0) nextAction = "Replace rejected docs";
      else if (missingDocs === 0 && approvedDocs < requiredDocs) nextAction = "Awaiting review";
      else if (approvedDocs === requiredDocs) nextAction = "Complete";

      const daysToArrival = daysBetween(c.eta);

      return {
        ...c,
        shipmentId: shipment.id,
        importerName: importer?.name || "",
        productName: product?.name || "",
        requiredDocs,
        uploadedDocs,
        rejectedDocs,
        missingDocs,
        reviewStatus,
        nextAction,
        daysToArrival,
      };
    });
  }, []);

  // KPIs
  const totalMissing = enrichedContainers.reduce((sum, c) => sum + c.missingDocs, 0);
  const totalRejected = enrichedContainers.reduce((sum, c) => sum + c.rejectedDocs, 0);
  const awaitingReupload = totalRejected;
  const urgentContainers = enrichedContainers.filter(
    (c) => c.daysToArrival <= 7 && (c.missingDocs > 0 || c.rejectedDocs > 0)
  ).length;

  return (
    <DashboardLayout
      role="supplier"
      title="Container Overview"
      subtitle="Upload and manage required documents per container"
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Missing Documents" value={totalMissing} icon={FileWarning} color="text-gray-600" iconColor="text-gray-500" />
        <KPICard label="Rejected Documents" value={totalRejected} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Awaiting Re-upload" value={awaitingReupload} icon={Upload} color="text-orange-600" iconColor="text-orange-500" />
        <KPICard label="Urgent Containers" value={urgentContainers} icon={AlertTriangle} color="text-amber-600" iconColor="text-amber-500" />
      </div>

      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowUpload(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          Upload New Document
        </Button>
      </div>

      {/* Container Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Containers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container Number</TableHead>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Importer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead className="text-center">Required Docs</TableHead>
                  <TableHead>Uploaded Docs</TableHead>
                  <TableHead>Review Status</TableHead>
                  <TableHead className="text-center">Rejected</TableHead>
                  <TableHead>Next Action</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichedContainers.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/supplier/containers/${c.id}`)}>
                    <TableCell className="whitespace-nowrap">{c.containerNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipmentId}</TableCell>
                    <TableCell className="text-sm">{c.importerName}</TableCell>
                    <TableCell className="text-sm max-w-[130px] truncate">{c.productName}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      <span className={c.daysToArrival <= 3 && c.daysToArrival > 0 ? "text-red-600" : ""}>
                        {c.eta}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{c.requiredDocs}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${c.requiredDocs > 0 ? (c.uploadedDocs / c.requiredDocs) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{c.uploadedDocs}/{c.requiredDocs}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        c.reviewStatus === "All Approved" ? "bg-green-100 text-green-700"
                        : c.reviewStatus === "Has Rejections" ? "bg-red-100 text-red-700"
                        : c.reviewStatus === "Under Review" ? "bg-yellow-100 text-yellow-700"
                        : c.reviewStatus === "Not Started" ? "bg-gray-100 text-gray-500"
                        : "bg-gray-100 text-gray-700"
                      }`}>
                        {c.reviewStatus}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {c.rejectedDocs > 0 ? (
                        <span className="text-red-600 text-sm">{c.rejectedDocs}</span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${
                        c.nextAction === "Replace rejected docs" ? "text-red-600"
                        : c.nextAction === "Complete" ? "text-green-600"
                        : "text-gray-600"
                      }`}>
                        {c.nextAction}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/supplier/containers/${c.id}`)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                        {c.missingDocs > 0 && (
                          <Button variant="outline" size="sm" className="text-blue-600 border-blue-200" onClick={() => setShowUpload(true)}>
                            <Upload className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {c.rejectedDocs > 0 && (
                          <Button variant="outline" size="sm" className="text-red-600 border-red-200" onClick={() => navigate(`/supplier/containers/${c.id}`)}>
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <DocumentUploadModal open={showUpload} onClose={() => setShowUpload(false)} />
    </DashboardLayout>
  );
}
