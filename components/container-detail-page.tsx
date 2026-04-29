"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, FileText, CheckCircle, XCircle, Clock, Upload, Eye,
  AlertTriangle, Camera, ImageIcon, Video, Loader2, PlayCircle, CheckSquare,
  Package, Anchor, Ship, Globe, CheckCheck, Truck, Sparkles, X, MapPin, Signal,
  Pencil,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRef } from "react";
import { CustomsAgentSelector } from "@/components/customs-agent-selector";
import { DashboardLayout } from "@/components/dashboard-layout";
import { DocStatusBadge, ContainerStatusBadge } from "@/components/status-badge";
import { DocumentUploadModal } from "@/components/document-upload-modal";
import { RejectDocumentModal } from "@/components/reject-document-modal";
import { DOCUMENT_TYPE_LABELS } from "@/lib/supabase";
import type { Document, DocumentType, ContainerView } from "@/lib/supabase";
import {
  getContainerById,
  getDocumentsForContainer,
  getCargoMediaForContainer,
  uploadCargoMedia,
  updateDocumentStatus,
  updateContainerStatus,
  updateContainerDates,
  getCurrentUserId,
  type CargoMedia,
} from "@/lib/db";
import { processFileForUpload, triggerMakeWebhook } from "@/lib/compress";
import { STORAGE_BUCKETS, getSignedUrl, createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

interface ContainerDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

// ─── Logistics Timeline ───────────────────────────────────────────────────────

type TimelineStage =
  | "created"
  | "loaded"
  | "sailed"
  | "arrived"
  | "docs_approved"
  | "in_clearance"
  | "released";

interface TimelineStep {
  key: TimelineStage;
  label: string;
  icon: React.ElementType;
  description: string;
}

// Order reflects real-world logistics: docs must be approved BEFORE arrival
// to avoid storage fees at destination port.
const TIMELINE_STEPS: TimelineStep[] = [
  { key: "created",      label: "Created",           icon: Package,     description: "Container created & documents requested" },
  { key: "loaded",       label: "Loaded at Port",    icon: Anchor,      description: "Cargo loaded onto vessel" },
  { key: "sailed",       label: "Sailed (ETD)",      icon: Ship,        description: "Vessel departed port of loading" },
  { key: "docs_approved",label: "Docs Approved",     icon: CheckCheck,  description: "All 7 documents reviewed and approved" },
  { key: "arrived",      label: "Arrived (ETA)",     icon: Globe,       description: "Vessel arrived at destination port" },
  { key: "in_clearance", label: "In Clearance",      icon: FileText,    description: "Customs clearance process underway" },
  { key: "released",     label: "Released",          icon: Truck,       description: "Container released from customs" },
];

// Statuses that confirm physical arrival at destination port
const ARRIVED_STATUSES = new Set(["ready_for_clearance", "in_clearance", "released"]);

function getCompletedStages(container: ContainerView): Set<TimelineStage> {
  const now = Date.now();
  const etd = new Date(container.etd).getTime();
  const s = container.status;
  const completed = new Set<TimelineStage>();

  // Date-driven steps
  completed.add("created");
  if (now >= etd - 3 * 86400000) completed.add("loaded");  // ~3 days pre-departure
  if (now >= etd)                 completed.add("sailed");  // past ETD

  // "arrived" ONLY green when status confirms physical arrival.
  // Passing ETA date alone is insufficient — vessel can be delayed.
  if (ARRIVED_STATUSES.has(s)) completed.add("arrived");

  // docs_approved: explicit count match OR status already past this gate
  const docsAllApproved =
    container.docs_total > 0 &&
    container.docs_approved === container.docs_total;
  if (docsAllApproved || ARRIVED_STATUSES.has(s)) {
    completed.add("docs_approved");
  }

  // Status-driven steps
  if (s === "in_clearance" || s === "released") completed.add("in_clearance");
  if (s === "released")                          completed.add("released");

  return completed;
}

/**
 * Returns steps that are "delayed" — past their expected date but not yet confirmed complete.
 * Only "arrived" can be delayed: ETA has passed but status hasn't reached arrived-statuses.
 */
function getDelayedStages(container: ContainerView): Set<TimelineStage> {
  const now = Date.now();
  const eta = new Date(container.eta).getTime();
  const delayed = new Set<TimelineStage>();
  if (now >= eta && !ARRIVED_STATUSES.has(container.status)) {
    delayed.add("arrived");
  }
  return delayed;
}

function LogisticsTimeline({
  container,
  role,
  onDateSaved,
}: {
  container: ContainerView;
  role: "importer" | "supplier" | "customs-agent";
  onDateSaved: () => void;
}) {
  const completed = getCompletedStages(container);
  const delayed   = getDelayedStages(container);

  // Active step = first incomplete, non-delayed step after the last completed one
  const lastCompleted = [...TIMELINE_STEPS].reverse().findIndex((s) => completed.has(s.key));
  const currentIdx = lastCompleted >= 0 ? TIMELINE_STEPS.length - 1 - lastCompleted : 0;

  // ── Edit Dates dialog state ────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editEtd, setEditEtd]   = useState(container.etd.slice(0, 10));
  const [editEta, setEditEta]   = useState(container.eta.slice(0, 10));
  const [saving, setSaving]     = useState(false);

  const handleSaveDates = async () => {
    if (!editEtd || !editEta) { toast.error("Both dates required."); return; }
    if (editEta <= editEtd)   { toast.error("ETA must be after ETD."); return; }
    setSaving(true);
    const ok = await updateContainerDates(container.id, { etd: editEtd, eta: editEta });
    setSaving(false);
    if (ok) {
      toast.success("Dates updated.");
      setEditOpen(false);
      onDateSaved();
    } else {
      toast.error("Failed to update dates. Check permissions.");
    }
  };

  const canEditDates = role === "importer" || role === "supplier";

  return (
    <>
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Ship className="w-4 h-4" />
              Logistics Timeline
            </CardTitle>
            {canEditDates && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => {
                  setEditEtd(container.etd.slice(0, 10));
                  setEditEta(container.eta.slice(0, 10));
                  setEditOpen(true);
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Dates
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Connector line */}
            <div className="absolute top-5 left-5 right-5 h-0.5 bg-gray-200" />

            <div className="relative flex justify-between">
              {TIMELINE_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const done    = completed.has(step.key);
                const warn    = !done && delayed.has(step.key);
                const active  = !done && !warn && idx === currentIdx + 1;

                return (
                  <div key={step.key} className="flex flex-col items-center gap-2 flex-1">
                    <div
                      className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                        done ? "bg-green-500 border-green-500 text-white"
                        : warn ? "bg-amber-400 border-amber-400 text-white"
                        : active ? "bg-white border-blue-500 text-blue-600"
                        : "bg-white border-gray-300 text-gray-400"
                      }`}
                    >
                      {done ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : warn ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className={`text-[11px] font-medium leading-tight ${
                        done   ? "text-green-700"
                        : warn   ? "text-amber-600"
                        : active ? "text-blue-700"
                        : "text-gray-400"
                      }`}>
                        {warn ? "Delayed / Pending" : step.label}
                      </p>
                      {step.key === "sailed" && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(container.etd).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        </p>
                      )}
                      {step.key === "arrived" && (
                        <p className={`text-[10px] mt-0.5 ${warn ? "text-amber-500" : "text-gray-400"}`}>
                          {new Date(container.eta).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dates dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Shipping Dates</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>ETD — Estimated Departure</Label>
              <Input
                type="date"
                value={editEtd}
                onChange={(e) => setEditEtd(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>ETA — Estimated Arrival</Label>
              <Input
                type="date"
                value={editEta}
                onChange={(e) => setEditEta(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-400">
              Timeline and delay indicators update immediately after save.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveDates} disabled={saving}>
              {saving ? "Saving…" : "Save Dates"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Cargo Photos Sub-component ───────────────────────────────────────────────

function CargoPhotosSection({
  containerId,
  role,
}: {
  containerId: string;
  role: "importer" | "supplier";
}) {
  const [photos, setPhotos] = useState<CargoMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const imageInputRef = useState<React.RefObject<HTMLInputElement>>(() => ({ current: null }))[0];
  const videoInputRef = useState<React.RefObject<HTMLInputElement>>(() => ({ current: null }))[0];

  const loadPhotos = useCallback(async () => {
    const media = await getCargoMediaForContainer(containerId);
    setPhotos(media);

    // Generate signed URLs for viewing
    const supabase = createBrowserSupabaseClient();
    const urls: Record<string, string> = {};
    await Promise.all(
      media.map(async (m) => {
        const url = await getSignedUrl(supabase, STORAGE_BUCKETS.cargoMedia, m.storage_path, 3600);
        if (url) urls[m.id] = url;
      })
    );
    setSignedUrls(urls);
  }, [containerId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    let succeeded = 0;
    let failed = 0;

    for (const rawFile of Array.from(files)) {
      const { file, error } = await processFileForUpload(rawFile);
      if (!file || error) {
        toast.error(error ?? `Could not process ${rawFile.name}`);
        failed++;
        continue;
      }

      const ext = file.name.split(".").pop() ?? "jpg";
      const storagePath = `${containerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const result = await uploadCargoMedia({
        containerId,
        file,
        storagePath,
        caption: caption.trim() || undefined,
      });

      if (result) {
        succeeded++;
        // Fire Make webhook (no-op until NEXT_PUBLIC_MAKE_WEBHOOK_URL is set)
        triggerMakeWebhook({
          event: "cargo_media_uploaded",
          containerId,
          storagePath,
          fileName: file.name,
          mediaType: result.media_type,
          uploadedAt: result.created_at,
        });
      } else {
        failed++;
      }
    }

    if (succeeded > 0) {
      toast.success(`${succeeded} file${succeeded > 1 ? "s" : ""} uploaded.`);
      setCaption("");
      loadPhotos();
    }
    if (failed > 0) {
      toast.error(`${failed} file${failed > 1 ? "s" : ""} failed to upload.`);
    }

    setUploading(false);
  }

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
                <Button variant="outline" size="sm" className="gap-1.5" asChild disabled={uploading}>
                  <span><ImageIcon className="w-4 h-4" />{uploading ? "Uploading…" : "Upload Images"}</span>
                </Button>
                <input
                  ref={imageInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
              <label>
                <Button variant="outline" size="sm" className="gap-1.5" asChild disabled={uploading}>
                  <span><Video className="w-4 h-4" />{uploading ? "Uploading…" : "Upload Video"}</span>
                </Button>
                <input
                  ref={videoInputRef}
                  type="file"
                  className="hidden"
                  accept="video/*"
                  multiple
                  disabled={uploading}
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Camera className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No cargo photos uploaded yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {photos.map((p) => {
              const url = signedUrls[p.id];
              return (
                <div key={p.id} className="rounded-lg border overflow-hidden group">
                  <a href={url ?? "#"} target="_blank" rel="noopener noreferrer" className="block">
                    <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden relative">
                      {p.media_type === "image" && url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={p.file_name ?? "cargo photo"} className="object-cover w-full h-full group-hover:opacity-90 transition-opacity" />
                      ) : p.media_type === "video" ? (
                        <Video className="w-8 h-8 text-gray-400" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-gray-300" />
                      )}
                    </div>
                  </a>
                  <div className="p-2">
                    <p className="text-xs text-gray-500">
                      {new Date(p.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                    {p.caption && <p className="text-xs text-gray-700 mt-0.5 line-clamp-2">{p.caption}</p>}
                    {p.file_size_bytes && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{(p.file_size_bytes / 1024).toFixed(0)} KB</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {role === "supplier" && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-gray-500 mb-2">Optional caption for next upload:</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Loaded and secured in container, Row A"
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Images are compressed to ≤1 MB automatically · Videos max 15 MB · Caption applies to the next batch you upload
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Smart Upload Zone ────────────────────────────────────────────────────────

interface ClassifyResult {
  document_type: string;
  container_number: string;
  success: boolean;
}

function SmartUploadZone({
  container,
  onDocumentsUpdated,
}: {
  container: ContainerView;
  onDocumentsUpdated: () => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ClassifyResult[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function runClassify(file: File) {
    setProcessing(true);
    setResult(null);
    try {
      // Edge Function handles Gemini classification, storage upload, and DB patching.
      const form = new FormData();
      form.append("file", file);
      form.append("containerId", container.id);

      const supabase = createBrowserSupabaseClient();
      const { data: body, error: fnError } = await supabase.functions.invoke(
        "classify-documents",
        { body: form },
      );

      if (fnError) {
        toast.error(fnError.message ?? "AI classification failed");
        return;
      }

      // No-documents case — Edge Function returns { ok: true, results: [], message: "..." }
      if (body?.message && !body?.results?.length) {
        toast.info(body.message);
        return;
      }

      const results: ClassifyResult[] = body?.results ?? [];

      console.log("[SmartUpload] AI classification results:", results);

      if (results.length === 0) {
        toast.warning("No documents identified. Check the file and retry.");
        return;
      }

      const succeeded = results.filter((r) => r.success);
      if (succeeded.length > 0) {
        const allLabel = succeeded.some((r) => r.container_number?.toUpperCase() === "ALL")
          ? " (applied to all containers in shipment)"
          : "";
        toast.success(
          `${succeeded.length} document type${succeeded.length > 1 ? "s" : ""} updated from AI classification${allLabel}.`
        );
        setResult(results);
        onDocumentsUpdated();
      } else {
        toast.warning("No documents could be updated. Check the file and retry.");
      }
    } catch {
      toast.error("Smart upload failed. Fill manually.");
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) runClassify(file);
  }

  return (
    <Card className="mb-4 border-blue-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-blue-700">
          <Sparkles className="w-4 h-4" />
          Smart Upload — AI Document Classification
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`relative rounded-lg border-2 border-dashed transition-colors p-6 text-center cursor-pointer ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-blue-200 bg-blue-50/40 hover:bg-blue-50"
          } ${processing ? "pointer-events-none opacity-60" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !processing && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            disabled={processing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runClassify(f);
            }}
          />
          {processing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <p className="text-sm text-blue-700">AI is classifying your documents…</p>
              <p className="text-xs text-gray-500">This may take 10–30 seconds</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Sparkles className="w-6 h-6 text-blue-400" />
              <p className="text-sm text-blue-700">
                Drop a document bundle here or{" "}
                <span className="underline">click to select</span>
              </p>
              <p className="text-xs text-gray-500">
                PDF, Word, or image · AI identifies document types and updates all matching containers
              </p>
            </div>
          )}
        </div>

        {/* Results summary */}
        {result && result.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {result.map((r, i) => (
              <span
                key={`${r.document_type}-${i}`}
                className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
                  r.success
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {r.success ? (
                  <CheckCircle className="w-3 h-3" />
                ) : (
                  <X className="w-3 h-3" />
                )}
                {r.document_type.replace(/_/g, " ")}
                {r.container_number?.toUpperCase() === "ALL" && (
                  <span className="opacity-60 ml-0.5">(all)</span>
                )}
              </span>
            ))}
            <button
              className="text-xs text-gray-400 underline ml-1"
              onClick={() => setResult(null)}
            >
              dismiss
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ContainerDetailPage({ role }: ContainerDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const containerId = params.containerId as string;

  const [container, setContainer] = useState<ContainerView | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreselect, setUploadPreselect] = useState<{
    docType?: DocumentType;
    isReplacement?: boolean;
  }>({});
  const [rejectDoc, setRejectDoc] = useState<Document | null>(null);
  const [advancingStatus, setAdvancingStatus] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [c, d] = await Promise.all([
      getContainerById(containerId),
      getDocumentsForContainer(containerId, role === "customs-agent"),
    ]);
    setContainer(c);
    setDocs(d);
    setLoading(false);
  }, [containerId, role]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleApproveDoc(doc: Document) {
    const userId = await getCurrentUserId();
    const ok = await updateDocumentStatus(doc.id, "approved", { reviewedBy: userId });
    if (ok) {
      toast.success(`${DOCUMENT_TYPE_LABELS[doc.document_type]} approved.`);
      loadData();
    } else {
      toast.error("Failed to approve document.");
    }
  }

  async function handleRejectDoc(docId: string, reason: string, internalNote: string) {
    const userId = await getCurrentUserId();
    const ok = await updateDocumentStatus(docId, "rejected", {
      rejectionReason: reason,
      internalNote: internalNote || null,
      reviewedBy: userId,
    });
    if (ok) {
      toast.error("Document rejected.");
      loadData();
    } else {
      toast.error("Failed to reject document.");
    }
  }

  async function handleViewDoc(doc: Document) {
    if (!doc.storage_path) return;
    const supabase = createBrowserSupabaseClient();
    const url = await getSignedUrl(supabase, STORAGE_BUCKETS.documents, doc.storage_path, 3600);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Could not generate a view link. Please try again.");
    }
  }

  async function handleAdvanceStatus(nextStatus: "in_clearance" | "released") {
    if (!container) return;
    setAdvancingStatus(true);
    const ok = await updateContainerStatus(container.id, nextStatus);
    if (ok) {
      const label = nextStatus === "in_clearance" ? "In Clearance" : "Released";
      toast.success(`Container moved to ${label}.`);
      loadData();
    } else {
      toast.error("Failed to update container status.");
    }
    setAdvancingStatus(false);
  }

  const basePath = `/${role}`;

  if (loading) {
    return (
      <DashboardLayout role={role} title="Loading…" subtitle="">
        <div className="py-12 text-center text-gray-400 text-sm">Loading container data…</div>
      </DashboardLayout>
    );
  }

  if (!container) {
    return (
      <DashboardLayout role={role} title="Container Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Container not found or access denied.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push(basePath)}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const docsApproved = docs.filter((d) => d.status === "approved").length;
  const docsRejected = docs.filter((d) => d.status === "rejected").length;
  const docsUploaded = docs.filter((d) => d.status !== "missing").length;
  const docsPending = docs.filter((d) => d.status === "uploaded" || d.status === "under_review").length;
  const docsMissing = docs.filter((d) => d.status === "missing").length;
  const docsTotal = docs.length || container.docs_total;

  return (
    <DashboardLayout
      role={role}
      title={`Container ${container.container_number}`}
      subtitle={`${container.shipment_number} · ${container.supplier_company}`}
    >
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-1.5"
        onClick={() => router.push(basePath)}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Button>

      {/* Header Info Card */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Container Number</p>
              <p className="mt-0.5 font-medium">{container.container_number}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Shipment</p>
              <p className="mt-0.5">{container.shipment_number}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Importer</p>
              <p className="mt-0.5">{container.importer_company}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Supplier</p>
              <p className="mt-0.5">{container.supplier_company}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Product</p>
              <p className="mt-0.5">{container.product_name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Vessel</p>
              <p className="mt-0.5">{container.vessel_name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ETD</p>
              <p className="mt-0.5">{new Date(container.etd).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">ETA</p>
              <p className="mt-0.5">{new Date(container.eta).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Port of Loading</p>
              <p className="mt-0.5">{container.port_of_loading}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Port of Destination</p>
              <p className="mt-0.5">{container.port_of_destination}</p>
            </div>

            {/* Carrier tracking fields — only shown when the Edge Function has polled */}
            {container.current_location && (
              <div>
                <p className="text-gray-500 text-xs flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-blue-400" />
                  Live Location
                </p>
                <p className="mt-0.5 text-blue-700 font-medium">{container.current_location}</p>
              </div>
            )}
            {container.api_eta && (
              <div>
                <p className="text-gray-500 text-xs flex items-center gap-1">
                  <Signal className="w-3 h-3 text-blue-400" />
                  Carrier ETA
                </p>
                <p className="mt-0.5 text-blue-700">
                  {new Date(container.api_eta).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>

          {/* Last tracking update timestamp */}
          {container.last_tracking_update && (
            <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1">
              <Signal className="w-3 h-3" />
              Live tracking last updated{" "}
              {new Date(container.last_tracking_update).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}

          <div className="mt-4 pt-4 border-t flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500">Status:</span>
            <ContainerStatusBadge status={container.status} />

            {/* Customs agent: advance container through clearance flow */}
            {role === "customs-agent" && container.status === "ready_for_clearance" && (
              <Button
                size="sm"
                className="gap-1.5 ml-auto bg-blue-600 hover:bg-blue-700"
                disabled={advancingStatus}
                onClick={() => handleAdvanceStatus("in_clearance")}
              >
                {advancingStatus
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <PlayCircle className="w-4 h-4" />}
                Move to Clearance
              </Button>
            )}
            {role === "customs-agent" && container.status === "in_clearance" && (
              <Button
                size="sm"
                className="gap-1.5 ml-auto bg-green-600 hover:bg-green-700"
                disabled={advancingStatus}
                onClick={() => handleAdvanceStatus("released")}
              >
                {advancingStatus
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <CheckSquare className="w-4 h-4" />}
                Mark as Released
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Customs Agent Assignment — Importer only.
          Uses container.shipment_id (always present) and container.customs_agent_id
          (now included in v_containers view) so the selector is visible regardless
          of who created the shipment (importer or supplier). */}
      {role === "importer" && (
        <CustomsAgentSelector
          shipmentId={container.shipment_id}
          currentAgentId={container.customs_agent_id}
          onAssigned={loadData}
        />
      )}

      {/* Clearance Progress Summary */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clearance Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            <div className="text-center p-3 rounded-lg bg-gray-50">
              <FileText className="w-5 h-5 mx-auto text-gray-500 mb-1" />
              <p className="text-2xl text-gray-900">{docsTotal}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Required</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50">
              <Upload className="w-5 h-5 mx-auto text-blue-500 mb-1" />
              <p className="text-2xl text-blue-600">{docsUploaded}</p>
              <p className="text-xs text-gray-500 mt-0.5">Uploaded</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50">
              <CheckCircle className="w-5 h-5 mx-auto text-green-500 mb-1" />
              <p className="text-2xl text-green-600">{docsApproved}</p>
              <p className="text-xs text-gray-500 mt-0.5">Approved</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50">
              <XCircle className="w-5 h-5 mx-auto text-red-500 mb-1" />
              <p className="text-2xl text-red-600">{docsRejected}</p>
              <p className="text-xs text-gray-500 mt-0.5">Rejected</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50">
              <Clock className="w-5 h-5 mx-auto text-yellow-500 mb-1" />
              <p className="text-2xl text-yellow-600">{docsPending}</p>
              <p className="text-xs text-gray-500 mt-0.5">Pending Review</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-gray-50">
              <AlertTriangle className="w-5 h-5 mx-auto text-gray-400 mb-1" />
              <p className="text-2xl text-gray-600">{docsMissing}</p>
              <p className="text-xs text-gray-500 mt-0.5">Missing</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Overall Progress</span>
              <span>{docsApproved}/{docsTotal} approved</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden flex">
              {docsApproved > 0 && (
                <div className="h-full bg-green-500" style={{ width: `${(docsApproved / docsTotal) * 100}%` }} />
              )}
              {docsPending > 0 && (
                <div className="h-full bg-yellow-400" style={{ width: `${(docsPending / docsTotal) * 100}%` }} />
              )}
              {docsRejected > 0 && (
                <div className="h-full bg-red-400" style={{ width: `${(docsRejected / docsTotal) * 100}%` }} />
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

      {/* Smart Upload Zone — supplier only */}
      {role === "supplier" && (
        <SmartUploadZone container={container} onDocumentsUpdated={loadData} />
      )}

      {/* Document Checklist Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Document Checklist</CardTitle>
            {role === "supplier" && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => { setUploadPreselect({}); setUploadOpen(true); }}
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
                  <TableHead>Status</TableHead>
                  <TableHead>Upload Date</TableHead>
                  <TableHead>Rejection Reason</TableHead>
                  {role === "customs-agent" && <TableHead>Internal Note</TableHead>}
                  <TableHead>File</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-sm font-medium">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                    </TableCell>
                    <TableCell><DocStatusBadge status={doc.status} /></TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {doc.uploaded_at
                        ? new Date(doc.uploaded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {doc.rejection_reason ? (
                        <span className="text-xs text-red-600 max-w-[200px] block">{doc.rejection_reason}</span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </TableCell>
                    {role === "customs-agent" && (
                      <TableCell>
                        {"internal_note" in doc && (doc as Document & { internal_note?: string }).internal_note ? (
                          <span className="text-xs text-gray-600 italic max-w-[180px] block">
                            {(doc as Document & { internal_note?: string }).internal_note}
                          </span>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </TableCell>
                    )}
                    <TableCell>
                      {doc.status !== "missing" && doc.storage_path ? (
                        <Button
                          variant="ghost" size="sm"
                          className="text-blue-600 gap-1 h-auto py-1 px-2"
                          onClick={() => handleViewDoc(doc)}
                        >
                          <Eye className="w-3 h-3" /><span className="text-xs">View</span>
                        </Button>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </TableCell>
                    <TableCell>
                      {/* Supplier Actions */}
                      {role === "supplier" && doc.status === "missing" && (
                        <Button
                          variant="outline" size="sm"
                          onClick={() => { setUploadPreselect({ docType: doc.document_type }); setUploadOpen(true); }}
                        >
                          <Upload className="w-3.5 h-3.5 mr-1" />Upload
                        </Button>
                      )}
                      {role === "supplier" && doc.status === "rejected" && (
                        <Button
                          variant="outline" size="sm" className="text-red-600 border-red-200"
                          onClick={() => { setUploadPreselect({ docType: doc.document_type, isReplacement: true }); setUploadOpen(true); }}
                        >
                          <Upload className="w-3.5 h-3.5 mr-1" />Replace
                        </Button>
                      )}
                      {role === "supplier" && doc.status !== "missing" && doc.status !== "rejected" && (
                        <span className="text-xs text-gray-400">—</span>
                      )}

                      {/* Customs Agent Actions */}
                      {role === "customs-agent" && (doc.status === "uploaded" || doc.status === "under_review") && (
                        <div className="flex gap-1">
                          <Button
                            variant="outline" size="sm" className="text-green-600 border-green-200"
                            onClick={() => handleApproveDoc(doc)}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                          </Button>
                          <Button
                            variant="outline" size="sm" className="text-red-600 border-red-200"
                            onClick={() => setRejectDoc(doc)}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />Reject
                          </Button>
                        </div>
                      )}
                      {role === "customs-agent" && doc.status !== "uploaded" && doc.status !== "under_review" && (
                        <span className="text-xs text-gray-400">—</span>
                      )}

                      {/* Importer (read-only) */}
                      {role === "importer" && <span className="text-xs text-gray-400">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Logistics Timeline */}
      <LogisticsTimeline container={container} role={role} onDateSaved={loadData} />

      {/* Pre-Loading Cargo Photos — not for customs agent */}
      {role !== "customs-agent" && (
        <CargoPhotosSection containerId={container.id} role={role as "importer" | "supplier"} />
      )}

      {/* Modals */}
      <DocumentUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        preselectedContainerId={container.id}
        preselectedContainerNumber={container.container_number}
        preselectedShipmentNumber={container.shipment_number}
        preselectedDocType={uploadPreselect.docType}
        isReplacement={uploadPreselect.isReplacement}
        onUploaded={loadData}
        containerImporterId={container.importer_id}
      />
      <RejectDocumentModal
        document={rejectDoc}
        containerNumber={container.container_number}
        open={!!rejectDoc}
        onClose={() => setRejectDoc(null)}
        onReject={handleRejectDoc}
      />
    </DashboardLayout>
  );
}
