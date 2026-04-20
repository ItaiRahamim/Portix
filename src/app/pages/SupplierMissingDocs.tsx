import { useState, useMemo } from "react";
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
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { DocStatusBadge } from "../components/StatusBadge";
import { DocumentUploadModal } from "../components/DocumentUploadModal";
import {
  mockDocuments,
  getShipment,
  getContainer,
  daysBetween,
  type DocumentType,
} from "../data/mockData";

export function SupplierMissingDocs() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreselect, setUploadPreselect] = useState<{
    shipmentId?: string;
    containerId?: string;
    docType?: DocumentType;
    isReplacement?: boolean;
  }>({});

  const actionableDocs = useMemo(() => {
    return mockDocuments
      .filter((d) => d.status === "missing" || d.status === "rejected")
      .map((d) => {
        const container = getContainer(d.containerId);
        const shipment = getShipment(d.shipmentId);
        return {
          ...d,
          containerNumber: container?.containerNumber || "",
          dueDate: shipment?.eta || "",
          daysToArrival: shipment ? daysBetween(shipment.eta) : 0,
        };
      });
  }, []);

  const missingDocs = actionableDocs.filter((d) => d.status === "missing").length;
  const rejectedDocs = actionableDocs.filter((d) => d.status === "rejected").length;
  const urgentShipments = new Set(
    actionableDocs.filter((d) => d.daysToArrival <= 7).map((d) => d.shipmentId)
  ).size;

  const handleUpload = (doc: (typeof actionableDocs)[0]) => {
    setUploadPreselect({
      shipmentId: doc.shipmentId,
      containerId: doc.containerId,
      docType: doc.type,
      isReplacement: doc.status === "rejected",
    });
    setUploadOpen(true);
  };

  return (
    <DashboardLayout
      role="supplier"
      title="Missing & Rejected Documents"
      subtitle="Documents that need to be uploaded or replaced"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Missing Documents" value={missingDocs} icon={FileWarning} iconColor="text-gray-500" />
        <KPICard label="Rejected Documents" value={rejectedDocs} icon={XCircle} color="text-red-600" iconColor="text-red-500" />
        <KPICard label="Awaiting Re-upload" value={rejectedDocs} icon={Upload} color="text-orange-600" iconColor="text-orange-500" />
        <KPICard label="Urgent Shipments" value={urgentShipments} icon={AlertTriangle} color="text-amber-600" iconColor="text-amber-500" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Documents Requiring Action</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Required Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rejection Reason</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionableDocs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="whitespace-nowrap">{doc.shipmentId}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{doc.containerNumber}</TableCell>
                    <TableCell className="text-sm">{doc.type}</TableCell>
                    <TableCell>
                      <DocStatusBadge status={doc.status} />
                    </TableCell>
                    <TableCell>
                      {doc.rejectionReason ? (
                        <span className="text-xs text-red-600 max-w-[200px] block">
                          {doc.rejectionReason}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`text-sm ${
                        doc.daysToArrival <= 3 ? "text-red-600"
                        : doc.daysToArrival <= 7 ? "text-orange-600"
                        : "text-gray-600"
                      }`}>
                        {doc.dueDate}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className={doc.status === "rejected" ? "text-red-600 border-red-200" : ""}
                        onClick={() => handleUpload(doc)}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1" />
                        {doc.status === "rejected" ? "Replace" : "Upload"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <DocumentUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        preselectedShipmentId={uploadPreselect.shipmentId}
        preselectedContainerId={uploadPreselect.containerId}
        preselectedDocType={uploadPreselect.docType}
        isReplacement={uploadPreselect.isReplacement}
      />
    </DashboardLayout>
  );
}
