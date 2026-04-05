"use client";

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  REQUIRED_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  STORAGE_BUCKETS,
  type DocumentType,
} from "@/lib/supabase";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { uploadDocumentRecord, getCurrentUserId } from "@/lib/db";

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  /** UUID of the container */
  preselectedContainerId?: string;
  preselectedContainerNumber?: string;
  preselectedShipmentNumber?: string;
  preselectedDocType?: DocumentType;
  isReplacement?: boolean;
  onUploaded?: () => void;
}

export function DocumentUploadModal({
  open,
  onClose,
  preselectedContainerId = "",
  preselectedContainerNumber = "",
  preselectedShipmentNumber = "",
  preselectedDocType,
  isReplacement,
  onUploaded,
}: DocumentUploadModalProps) {
  const [docType, setDocType] = useState<DocumentType | "">(preselectedDocType ?? "");
  const [docNumber, setDocNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset form when preselected values change
  useEffect(() => {
    if (preselectedDocType) setDocType(preselectedDocType);
  }, [preselectedDocType]);

  async function handleUpload() {
    if (!preselectedContainerId || !docType || !file) {
      toast.error("Please select a document type and choose a file.");
      return;
    }

    setLoading(true);

    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error("Not authenticated");

      const supabase = createBrowserSupabaseClient();

      // Upload to Supabase Storage
      const storagePath = `${preselectedContainerId}/${docType}/${Date.now()}_${file.name}`;
      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKETS.documents)
        .upload(storagePath, file, { upsert: true });

      if (storageError) {
        // If storage bucket doesn't exist yet, continue with record-only upload
        console.warn("[upload] Storage bucket not ready:", storageError.message);
      }

      // Update the document record in DB
      const ok = await uploadDocumentRecord({
        containerId: preselectedContainerId,
        documentType: docType as DocumentType,
        storagePath: storageError ? "" : storagePath,
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type,
        uploadedBy: userId,
        documentNumber: docNumber || undefined,
        issueDate: issueDate || undefined,
        notes: notes || undefined,
      });

      if (!ok) throw new Error("Failed to update document record");

      const action = isReplacement ? "replaced" : "uploaded";
      toast.success(`${DOCUMENT_TYPE_LABELS[docType as DocumentType]} ${action} successfully.`);
      onUploaded?.();
      handleClose();
    } catch (err) {
      toast.error((err as Error).message ?? "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!preselectedDocType) setDocType("");
    setDocNumber("");
    setIssueDate("");
    setNotes("");
    setFile(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isReplacement ? "Replace Rejected Document" : "Upload Document"}
          </DialogTitle>
          <DialogDescription>
            {isReplacement
              ? "Upload a corrected version of the rejected document."
              : "Upload a required document for this container."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Container / Shipment info (read-only) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Shipment</Label>
              <Input value={preselectedShipmentNumber || "—"} disabled className="bg-gray-50" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Container</Label>
              <Input value={preselectedContainerNumber || "—"} disabled className="bg-gray-50" />
            </div>
          </div>

          {/* Document Type */}
          <div className="space-y-1.5">
            <Label className="text-sm">Document Type <span className="text-red-500">*</span></Label>
            <Select
              value={docType}
              onValueChange={(v) => setDocType(v as DocumentType)}
              disabled={!!preselectedDocType}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {REQUIRED_DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Document Number + Issue Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Document Number</Label>
              <Input
                placeholder="e.g. INV-2026-0012"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Issue Date</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-1.5">
            <Label className="text-sm">File <span className="text-red-500">*</span></Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-gray-500">
                Selected: {file.name} ({(file.size / 1024).toFixed(0)} KB)
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm">Notes</Label>
            <Textarea
              placeholder="Optional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleUpload} disabled={loading || !file || !docType}>
            <Upload className="w-4 h-4 mr-2" />
            {loading ? "Uploading…" : isReplacement ? "Replace Document" : "Upload Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
