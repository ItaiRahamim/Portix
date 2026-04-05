"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  ALL_DOCUMENT_TYPES,
  mockShipments,
  getContainersForShipment,
  type DocumentType,
} from "@/lib/mock-data";

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  preselectedShipmentId?: string;
  preselectedContainerId?: string;
  preselectedDocType?: DocumentType;
  isReplacement?: boolean;
}

export function DocumentUploadModal({
  open,
  onClose,
  preselectedShipmentId,
  preselectedContainerId,
  preselectedDocType,
  isReplacement,
}: DocumentUploadModalProps) {
  const [shipmentId, setShipmentId] = useState(preselectedShipmentId || "");
  const [containerId, setContainerId] = useState(preselectedContainerId || "");
  const [docType, setDocType] = useState<string>(preselectedDocType || "");
  const [docNumber, setDocNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const containers = shipmentId ? getContainersForShipment(shipmentId) : [];

  const handleUpload = () => {
    if (!shipmentId || !containerId || !docType || !file) {
      toast.error("Please fill in required fields: Shipment, Container, Document Type, and File.");
      return;
    }
    const action = isReplacement ? "replaced" : "uploaded";
    toast.success(`${docType} ${action} successfully for container ${containerId}`);
    handleClose();
  };

  const handleClose = () => {
    if (!preselectedShipmentId) setShipmentId("");
    if (!preselectedContainerId) setContainerId("");
    if (!preselectedDocType) setDocType("");
    setDocNumber("");
    setIssueDate("");
    setNotes("");
    setFile(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isReplacement ? "Replace Rejected Document" : "Upload Document"}
          </DialogTitle>
          <DialogDescription>
            {isReplacement
              ? "Upload a corrected version of the rejected document."
              : "Upload a required document for a shipment container."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Shipment <span className="text-red-500">*</span></Label>
              <Select
                value={shipmentId}
                onValueChange={(v) => {
                  setShipmentId(v);
                  setContainerId("");
                }}
                disabled={!!preselectedShipmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select shipment" />
                </SelectTrigger>
                <SelectContent>
                  {mockShipments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Container <span className="text-red-500">*</span></Label>
              <Select
                value={containerId}
                onValueChange={setContainerId}
                disabled={!!preselectedContainerId || containers.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select container" />
                </SelectTrigger>
                <SelectContent>
                  {containers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.containerNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Document Type <span className="text-red-500">*</span></Label>
            <Select value={docType} onValueChange={setDocType} disabled={!!preselectedDocType}>
              <SelectTrigger>
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {ALL_DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Document Number</Label>
              <Input placeholder="e.g. INV-2026-0012" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Issue Date</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>File <span className="text-red-500">*</span></Label>
            <Input type="file" accept=".pdf,.doc,.docx,.jpg,.png,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {file && <p className="text-xs text-gray-500">Selected: {file.name}</p>}
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea placeholder="Optional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleUpload}>
            <Upload className="w-4 h-4 mr-2" />
            {isReplacement ? "Replace Document" : "Upload Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
