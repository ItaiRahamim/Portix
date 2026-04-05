"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { XCircle } from "lucide-react";
import type { Document } from "@/lib/supabase";
import { DOCUMENT_TYPE_LABELS } from "@/lib/supabase";

interface RejectDocumentModalProps {
  document: Document | null;
  containerNumber?: string;
  open: boolean;
  onClose: () => void;
  onReject: (documentId: string, reason: string, internalNote: string) => void;
}

export function RejectDocumentModal({
  document,
  containerNumber,
  open,
  onClose,
  onReject,
}: RejectDocumentModalProps) {
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [error, setError] = useState("");

  const handleReject = () => {
    if (!reason.trim()) {
      setError("Rejection reason is mandatory.");
      return;
    }
    if (document) {
      onReject(document.id, reason, internalNote);
    }
    setReason("");
    setInternalNote("");
    setError("");
    onClose();
  };

  function handleClose() {
    setReason("");
    setInternalNote("");
    setError("");
    onClose();
  }

  const docLabel = document ? (DOCUMENT_TYPE_LABELS[document.document_type] ?? document.document_type) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-500" />
            Reject Document
          </DialogTitle>
          <DialogDescription>
            You are rejecting <strong>{docLabel}</strong>
            {containerNumber && ` for container ${containerNumber}`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Rejection Reason — mandatory */}
          <div className="space-y-1.5">
            <Label htmlFor="reason" className="text-sm">
              Rejection Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Describe why this document is being rejected (required)…"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(""); }}
              rows={3}
              className={error ? "border-red-500" : ""}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          {/* Internal Note — optional, customs agent only */}
          <div className="space-y-1.5">
            <Label htmlFor="note" className="text-sm text-gray-600">
              Internal Note <span className="text-gray-400">(optional — only visible to customs agents)</span>
            </Label>
            <Textarea
              id="note"
              placeholder="Add an internal note for your records…"
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button variant="destructive" onClick={handleReject} disabled={!reason.trim()}>
            <XCircle className="w-4 h-4 mr-2" />
            Reject Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
