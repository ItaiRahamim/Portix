import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { XCircle } from "lucide-react";
import type { Document } from "../data/mockData";

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

  const handleClose = () => {
    setReason("");
    setInternalNote("");
    setError("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="w-5 h-5" />
            Reject Document
          </DialogTitle>
          <DialogDescription>
            Provide a reason for rejecting this document. The supplier will be notified.
          </DialogDescription>
        </DialogHeader>
        {document && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3">
              <div>
                <p className="text-xs text-gray-500">Document</p>
                <p className="text-sm">{document.type}</p>
              </div>
              {containerNumber && (
                <div>
                  <p className="text-xs text-gray-500">Container</p>
                  <p className="text-sm">{containerNumber}</p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>
                Rejection Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                placeholder="Explain why this document is being rejected..."
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setError("");
                }}
                rows={3}
                className={error ? "border-red-500" : ""}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <div className="space-y-2">
              <Label>Internal Note (optional)</Label>
              <Textarea
                placeholder="Add an internal note (not visible to supplier)..."
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleReject}>
            <XCircle className="w-4 h-4 mr-2" />
            Reject Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
