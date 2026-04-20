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
import {
  ArrowLeft,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Upload,
  Eye,
  AlertTriangle,
  Camera,
  Image,
  Video,
  MessageSquare,
} from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { DocStatusBadge, ClearanceBadge } from "../components/StatusBadge";
import { DocumentUploadModal } from "../components/DocumentUploadModal";
import { RejectDocumentModal } from "../components/RejectDocumentModal";
import {
  getContainer,
  getShipment,
  getSupplier,
  getImporter,
  getProduct,
  getDocumentsForContainer,
  getCargoPhotosForContainer,
  type Document,
  type DocumentType,
} from "../data/mockData";
import { toast } from "sonner";

interface ContainerDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

export function ContainerDetailPage({ role }: ContainerDetailPageProps) {
  const { containerId } = useParams();
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreselect, setUploadPreselect] = useState<{
    docType?: DocumentType;
    isReplacement?: boolean;
  }>({});
  const [rejectDoc, setRejectDoc] = useState<Document | null>(null);

  const container = getContainer(containerId || "");
  const shipment = container ? getShipment(container.shipmentId) : null;
  const supplier = shipment ? getSupplier(shipment.supplierId) : null;
  const importer = shipment ? getImporter(shipment.importerId) : null;
  const product = shipment ? getProduct(shipment.productId) : null;

  if (!container || !shipment) {
    return (
      <DashboardLayout role={role} title="Container Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Container not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const docs = getDocumentsForContainer(container.id);
  const totalRequired = docs.length;
  const uploadedCount = docs.filter((d) => d.status !== "missing").length;
  const approvedCount = docs.filter((d) => d.status === "approved").length;
  const rejectedCount = docs.filter((d) => d.status === "rejected").length;
  const pendingCount = docs.filter(
    (d) => d.status === "under-review" || d.status === "uploaded"
  ).length;
  const missingCount = docs.filter((d) => d.status === "missing").length;

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
      title={`Container ${container.containerNumber}`}
      subtitle={`Shipment ${shipment.id} · ${supplier?.name}`}
    >
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-1.5"
        onClick={() => navigate(basePath)}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Button>

      {/* ── Header Information ── */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Container Number</p>
              <p className="mt-0.5">{container.containerNumber}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Shipment ID</p>
              <p className="mt-0.5">{shipment.id}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Importer</p>
              <p className="mt-0.5">{importer?.name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Supplier</p>
              <p className="mt-0.5">{supplier?.name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Product</p>
              <p className="mt-0.5">{product?.name}</p>
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
              <p className="mt-0.5">{container.eta}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Port of Loading</p>
              <p className="mt-0.5">{container.portOfLoading}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Port of Destination</p>
              <p className="mt-0.5">{container.portOfDestination}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t flex items-center gap-2">
            <span className="text-xs text-gray-500">Clearance Status:</span>
            <ClearanceBadge status={container.clearanceStatus} />
          </div>
        </CardContent>
      </Card>

      {/* ── Clearance Progress Summary ── */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clearance Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            <div className="text-center p-3 rounded-lg bg-gray-50">
              <FileText className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <p className="text-2xl text-gray-900">{totalRequired}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Required</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50">
              <Upload className="w-5 h-5 mx-auto text-blue-500 mb-1" />
              <p className="text-2xl text-blue-600">{uploadedCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Uploaded</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50">
              <CheckCircle className="w-5 h-5 mx-auto text-green-500 mb-1" />
              <p className="text-2xl text-green-600">{approvedCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Approved</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50">
              <XCircle className="w-5 h-5 mx-auto text-red-500 mb-1" />
              <p className="text-2xl text-red-600">{rejectedCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Rejected</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50">
              <Clock className="w-5 h-5 mx-auto text-yellow-500 mb-1" />
              <p className="text-2xl text-yellow-600">{pendingCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Pending Review</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-gray-50">
              <AlertTriangle className="w-5 h-5 mx-auto text-gray-400 mb-1" />
              <p className="text-2xl text-gray-600">{missingCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Missing</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Overall Progress</span>
              <span>{approvedCount}/{totalRequired} approved</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden flex">
              {approvedCount > 0 && (
                <div className="h-full bg-green-500" style={{ width: `${(approvedCount / totalRequired) * 100}%` }} />
              )}
              {pendingCount > 0 && (
                <div className="h-full bg-yellow-400" style={{ width: `${(pendingCount / totalRequired) * 100}%` }} />
              )}
              {rejectedCount > 0 && (
                <div className="h-full bg-red-400" style={{ width: `${(rejectedCount / totalRequired) * 100}%` }} />
              )}
            </div>
            <div className="flex gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Approved</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Pending</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Rejected</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" /> Missing</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Document Checklist Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Document Checklist</CardTitle>
            {role === "supplier" && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setUploadPreselect({});
                  setUploadOpen(true);
                }}
              >
                <Upload className="w-4 h-4" />
                Upload Document
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Upload Status</TableHead>
                  <TableHead>Upload Date</TableHead>
                  <TableHead>Review Status</TableHead>
                  <TableHead>Rejection Reason</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-sm">{doc.type}</TableCell>
                    <TableCell>
                      <DocStatusBadge status={doc.status} />
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {doc.uploadedAt || "-"}
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
                    <TableCell>
                      {doc.rejectionReason ? (
                        <span className="text-xs text-red-600 max-w-[220px] block">
                          {doc.rejectionReason}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.status !== "missing" ? (
                        <Button variant="ghost" size="sm" className="text-blue-600 gap-1 h-auto py-1 px-2">
                          <Eye className="w-3 h-3" />
                          <span className="text-xs">View</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* ─── Supplier Actions ─── */}
                      {role === "supplier" && doc.status === "missing" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setUploadPreselect({ docType: doc.type });
                            setUploadOpen(true);
                          }}
                        >
                          <Upload className="w-3.5 h-3.5 mr-1" />
                          Upload
                        </Button>
                      )}
                      {role === "supplier" && doc.status === "rejected" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-200"
                          onClick={() => {
                            setUploadPreselect({ docType: doc.type, isReplacement: true });
                            setUploadOpen(true);
                          }}
                        >
                          <Upload className="w-3.5 h-3.5 mr-1" />
                          Replace
                        </Button>
                      )}
                      {role === "supplier" && doc.status !== "missing" && doc.status !== "rejected" && (
                        <span className="text-xs text-gray-400">-</span>
                      )}

                      {/* ─── Customs Agent Actions ─── */}
                      {role === "customs-agent" && (doc.status === "under-review" || doc.status === "uploaded") && (
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-green-600 border-green-200"
                            onClick={() => handleApproveDoc(doc)}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200"
                            onClick={() => setRejectDoc(doc)}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                      {role === "customs-agent" && doc.status !== "under-review" && doc.status !== "uploaded" && (
                        <span className="text-xs text-gray-400">-</span>
                      )}

                      {/* ─── Importer (read-only) ─── */}
                      {role === "importer" && (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Pre-Loading Cargo Photos ── */}
      {(role === "supplier" || role === "importer") && (
        <CargoPhotosSection containerId={container.id} role={role} />
      )}

      {/* ── Modals ── */}
      <DocumentUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        preselectedShipmentId={shipment.id}
        preselectedContainerId={container.id}
        preselectedDocType={uploadPreselect.docType}
        isReplacement={uploadPreselect.isReplacement}
      />
      <RejectDocumentModal
        document={rejectDoc}
        containerNumber={container.containerNumber}
        open={!!rejectDoc}
        onClose={() => setRejectDoc(null)}
        onReject={handleRejectDoc}
      />
    </DashboardLayout>
  );
}

// ── Pre-Loading Cargo Photos Sub-component ──
function CargoPhotosSection({
  containerId,
  role,
}: {
  containerId: string;
  role: "importer" | "supplier";
}) {
  const photos = getCargoPhotosForContainer(containerId);
  const [comment, setComment] = useState("");

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Pre-Loading Cargo Photos
          </CardTitle>
          {role === "supplier" && (
            <div className="flex gap-2">
              <label>
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <span>
                    <Image className="w-4 h-4" />
                    Upload Images
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  multiple
                  onChange={() => toast.success("Images uploaded successfully.")}
                />
              </label>
              <label>
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <span>
                    <Video className="w-4 h-4" />
                    Upload Videos
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept="video/*"
                  multiple
                  onChange={() => toast.success("Videos uploaded successfully.")}
                />
              </label>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No cargo photos uploaded yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {photos.map((photo) => (
                <div key={photo.id} className="rounded-lg border overflow-hidden">
                  <div className="aspect-square bg-gray-100 flex items-center justify-center">
                    {photo.type === "image" ? (
                      <Image className="w-8 h-8 text-gray-300" />
                    ) : (
                      <Video className="w-8 h-8 text-gray-300" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-gray-500">{photo.uploadedAt}</p>
                    <p className="text-xs text-gray-700 mt-0.5 line-clamp-2">{photo.comment}</p>
                    <p className="text-[10px] text-gray-400 mt-1">By: {photo.uploadedBy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {role === "supplier" && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add a comment about the cargo..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="flex-1 rounded-md border px-3 py-2 text-sm"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (comment.trim()) {
                    toast.success("Comment added.");
                    setComment("");
                  }
                }}
              >
                <MessageSquare className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}