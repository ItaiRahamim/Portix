import { useState } from "react";
import { useParams, useNavigate } from "react-router";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  FileText,
  FileWarning,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Upload,
  Container as ContainerIcon,
  ArrowLeft,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { DocStatusBadge, ClearanceBadge, ShipmentBadge } from "../components/StatusBadge";
import { DocumentUploadModal } from "../components/DocumentUploadModal";
import { RejectDocumentModal } from "../components/RejectDocumentModal";
import {
  getShipment,
  getSupplier,
  getProduct,
  getImporter,
  getContainersForShipment,
  getDocumentsForShipment,
  getDocumentsForContainer,
  getActivitiesForShipment,
  type Document,
  type DocumentType,
} from "../data/mockData";
import { toast } from "sonner";

interface ShipmentDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

export function ShipmentDetailPage({ role }: ShipmentDetailPageProps) {
  const { shipmentId } = useParams();
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreselect, setUploadPreselect] = useState<{
    containerId?: string;
    docType?: DocumentType;
    isReplacement?: boolean;
  }>({});
  const [rejectDoc, setRejectDoc] = useState<Document | null>(null);
  const [rejectContainerNum, setRejectContainerNum] = useState("");

  const shipment = getShipment(shipmentId || "");
  if (!shipment) {
    return (
      <DashboardLayout role={role} title="Shipment Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Shipment not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const supplier = getSupplier(shipment.supplierId);
  const product = getProduct(shipment.productId);
  const importer = getImporter(shipment.importerId);
  const containers = getContainersForShipment(shipment.id);
  const allDocs = getDocumentsForShipment(shipment.id);
  const activities = getActivitiesForShipment(shipment.id);

  const totalDocs = allDocs.length;
  const uploadedDocs = allDocs.filter((d) => d.status !== "missing").length;
  const missingDocs = allDocs.filter((d) => d.status === "missing").length;
  const underReviewDocs = allDocs.filter((d) => d.status === "under-review").length;
  const rejectedDocs = allDocs.filter((d) => d.status === "rejected").length;
  const approvedDocs = allDocs.filter((d) => d.status === "approved").length;

  const handleOpenUpload = (containerId?: string, docType?: DocumentType, isReplacement?: boolean) => {
    setUploadPreselect({ containerId, docType, isReplacement });
    setUploadOpen(true);
  };

  const handleApproveDoc = (doc: Document) => {
    toast.success(`${doc.type} approved successfully.`);
  };

  const handleRejectDoc = (docId: string, reason: string) => {
    toast.error(`Document rejected: ${reason}`);
  };

  const basePath = `/${role}`;

  return (
    <DashboardLayout
      role={role}
      title={`Shipment ${shipment.id}`}
      subtitle={`${supplier?.name} -> ${shipment.destinationPort}`}
    >
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5" onClick={() => navigate(basePath)}>
        <ArrowLeft className="w-4 h-4" />
        Back to Shipments
      </Button>

      {/* Header Info */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Shipment ID</p>
              <p className="mt-0.5">{shipment.id}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Supplier</p>
              <p className="mt-0.5">{supplier?.name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Importer</p>
              <p className="mt-0.5">{importer?.name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Product</p>
              <p className="mt-0.5">{product?.name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Origin</p>
              <p className="mt-0.5">{shipment.originCountry}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Destination</p>
              <p className="mt-0.5">{shipment.destinationPort}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Vessel</p>
              <p className="mt-0.5">{shipment.vesselName}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ETD</p>
              <p className="mt-0.5">{shipment.etd}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ETA</p>
              <p className="mt-0.5">{shipment.eta}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Status</p>
              <div className="mt-0.5">
                <ShipmentBadge status={shipment.status} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <KPICard label="Containers" value={containers.length} icon={ContainerIcon} />
        <KPICard label="Docs Uploaded" value={uploadedDocs} icon={FileText} iconColor="text-blue-500" />
        <KPICard label="Missing" value={missingDocs} icon={FileWarning} color={missingDocs > 0 ? "text-gray-700" : ""} iconColor="text-gray-500" />
        <KPICard label="Under Review" value={underReviewDocs} icon={Clock} color="text-yellow-600" iconColor="text-yellow-500" />
        <KPICard label="Rejected" value={rejectedDocs} icon={XCircle} color="text-red-600" iconColor="text-red-500" />
        <KPICard label="Approved" value={approvedDocs} icon={CheckCircle} color="text-green-600" iconColor="text-green-500" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="containers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="documents">Documents Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity Timeline</TabsTrigger>
        </TabsList>

        {/* Containers Tab */}
        <TabsContent value="containers">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Containers ({containers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Temp</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Docs Status</TableHead>
                      <TableHead>Clearance Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {containers.map((c) => {
                      const cDocs = getDocumentsForContainer(c.id);
                      const cApproved = cDocs.filter((d) => d.status === "approved").length;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="whitespace-nowrap">{c.containerNumber}</TableCell>
                          <TableCell className="text-sm">{c.containerType}</TableCell>
                          <TableCell className="text-sm">{c.temperature || "-"}</TableCell>
                          <TableCell className="text-sm">{c.eta}</TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-600">
                              {cApproved}/{cDocs.length} approved
                            </span>
                            <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
                              <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${cDocs.length > 0 ? (cApproved / cDocs.length) * 100 : 0}%` }}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <ClearanceBadge status={c.clearanceStatus} />
                          </TableCell>
                          <TableCell>
                            <Button variant="outline" size="sm" onClick={() => navigate(`/${role}/containers/${c.id}`)}>
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Overview Tab */}
        <TabsContent value="documents">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">All Documents</CardTitle>
                {role === "supplier" && (
                  <Button size="sm" className="gap-1.5" onClick={() => handleOpenUpload()}>
                    <Upload className="w-4 h-4" />
                    Upload
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Upload Status</TableHead>
                      <TableHead>Review Status</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Upload Date</TableHead>
                      <TableHead>Rejection Reason</TableHead>
                      {(role === "supplier" || role === "customs-agent") && (
                        <TableHead>Action</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allDocs.map((doc) => {
                      const container = containers.find((c) => c.id === doc.containerId);
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {container?.containerNumber || "-"}
                          </TableCell>
                          <TableCell className="text-sm">{doc.type}</TableCell>
                          <TableCell>
                            <DocStatusBadge status={doc.status} />
                          </TableCell>
                          <TableCell>
                            {doc.reviewStatus ? (
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                doc.reviewStatus === "approved" ? "bg-green-100 text-green-700"
                                : doc.reviewStatus === "rejected" ? "bg-red-100 text-red-700"
                                : "bg-yellow-100 text-yellow-700"
                              }`}>
                                {doc.reviewStatus}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{doc.uploadedBy || "-"}</TableCell>
                          <TableCell className="text-sm">{doc.uploadedAt || "-"}</TableCell>
                          <TableCell>
                            {doc.rejectionReason ? (
                              <span className="text-xs text-red-600 max-w-[200px] block truncate">
                                {doc.rejectionReason}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </TableCell>
                          {role === "supplier" && (
                            <TableCell>
                              {doc.status === "missing" && (
                                <Button variant="outline" size="sm" onClick={() => handleOpenUpload(doc.containerId, doc.type)}>
                                  <Upload className="w-3.5 h-3.5 mr-1" />
                                  Upload
                                </Button>
                              )}
                              {doc.status === "rejected" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-red-600 border-red-200"
                                  onClick={() => handleOpenUpload(doc.containerId, doc.type, true)}
                                >
                                  <Upload className="w-3.5 h-3.5 mr-1" />
                                  Replace
                                </Button>
                              )}
                            </TableCell>
                          )}
                          {role === "customs-agent" && (
                            <TableCell>
                              {(doc.status === "under-review" || doc.status === "uploaded") && (
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-green-600 border-green-200"
                                    onClick={() => handleApproveDoc(doc)}
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 border-red-200"
                                    onClick={() => {
                                      setRejectDoc(doc);
                                      setRejectContainerNum(container?.containerNumber || "");
                                    }}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Timeline Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {activities.map((event, idx) => (
                  <div key={event.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full mt-1.5 ${
                          event.type === "doc-rejected"
                            ? "bg-red-500"
                            : event.type === "docs-approved" || event.type === "clearance"
                            ? "bg-green-500"
                            : event.type === "docs-uploaded"
                            ? "bg-blue-500"
                            : "bg-gray-400"
                        }`}
                      />
                      {idx < activities.length - 1 && (
                        <div className="w-px flex-1 bg-gray-200" />
                      )}
                    </div>
                    <div className="pb-6">
                      <p className="text-sm">{event.description}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {event.timestamp} {event.user && `- ${event.user}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <DocumentUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        preselectedShipmentId={shipment.id}
        preselectedContainerId={uploadPreselect.containerId}
        preselectedDocType={uploadPreselect.docType}
        isReplacement={uploadPreselect.isReplacement}
      />
      <RejectDocumentModal
        document={rejectDoc}
        containerNumber={rejectContainerNum}
        open={!!rejectDoc}
        onClose={() => setRejectDoc(null)}
        onReject={handleRejectDoc}
      />
    </DashboardLayout>
  );
}
