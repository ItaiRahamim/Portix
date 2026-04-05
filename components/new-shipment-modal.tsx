"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Ship, Container as ContainerIcon, CheckCircle2 } from "lucide-react";
import {
  mockSuppliers, mockImporters, mockProducts,
  mockShipments, mockContainers, mockDocuments,
  ALL_DOCUMENT_TYPES, type Container, type Shipment, type Document,
} from "@/lib/mock-data";
import { toast } from "sonner";

// ─── Logged-in mock identities ────────────────────────────────
const CURRENT_IMPORTER_ID = "IMP001";
const CURRENT_SUPPLIER_ID = "SUP001";

interface NewContainerFields {
  containerNumber: string;
  containerType: "20ft" | "40ft" | "40ft HC" | "Reefer 40ft" | "";
  temperature: string;
  portOfLoading: string;
  portOfDestination: string;
}

const emptyContainer = (): NewContainerFields => ({
  containerNumber: "",
  containerType: "",
  temperature: "",
  portOfLoading: "",
  portOfDestination: "",
});

interface NewShipmentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Who is creating this shipment. Determines which party to pick vs. auto-assign. */
  role?: "importer" | "supplier";
}

export function NewShipmentModal({
  open, onClose, onCreated, role = "importer",
}: NewShipmentModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 – Shipment fields
  // When importer: supplierId is chosen, importerId is auto
  // When supplier: importerId is chosen, supplierId is auto
  const [chosenPartyId, setChosenPartyId] = useState(""); // supplier (importer role) OR importer (supplier role)
  const [productId, setProductId] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [originCountry, setOriginCountry] = useState(() =>
    // Supplier always knows their own origin country
    role === "supplier"
      ? (mockSuppliers.find((s) => s.id === CURRENT_SUPPLIER_ID)?.country ?? "")
      : ""
  );
  const [destinationPort, setDestinationPort] = useState("");

  // Step 2 – Containers list
  const [containers, setContainers] = useState<NewContainerFields[]>([emptyContainer()]);

  const resetForm = () => {
    setStep(1);
    setChosenPartyId("");
    setProductId("");
    setVesselName("");
    setEtd("");
    setEta("");
    setOriginCountry(
      role === "supplier"
        ? (mockSuppliers.find((s) => s.id === CURRENT_SUPPLIER_ID)?.country ?? "")
        : ""
    );
    setDestinationPort("");
    setContainers([emptyContainer()]);
  };

  const handleClose = () => { resetForm(); onClose(); };

  // When importer picks a supplier → auto-fill origin country
  const handlePartyChange = (id: string) => {
    setChosenPartyId(id);
    if (role === "importer") {
      const supplier = mockSuppliers.find((s) => s.id === id);
      if (supplier) setOriginCountry(supplier.country);
    }
  };

  const handleDestinationPortChange = (value: string) => {
    setDestinationPort(value);
    setContainers((prev) => prev.map((c) => ({ ...c, portOfDestination: value })));
  };

  const updateContainer = (idx: number, field: keyof NewContainerFields, value: string) => {
    setContainers((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const addContainer = () =>
    setContainers((prev) => [...prev, { ...emptyContainer(), portOfDestination: destinationPort }]);

  const removeContainer = (idx: number) => {
    if (containers.length === 1) return;
    setContainers((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Validation ──────────────────────────────────────────────
  const step1Valid =
    chosenPartyId && productId && vesselName.trim() &&
    etd && eta && originCountry.trim() && destinationPort.trim();

  const step2Valid = containers.every(
    (c) => c.containerNumber.trim() && c.containerType &&
            c.portOfLoading.trim() && c.portOfDestination.trim()
  );

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = () => {
    const supplierId = role === "importer" ? chosenPartyId : CURRENT_SUPPLIER_ID;
    const importerId = role === "supplier" ? chosenPartyId : CURRENT_IMPORTER_ID;

    const nextShipmentNum = mockShipments.length + 1;
    const shipmentId = `SHP-2026-${String(nextShipmentNum).padStart(3, "0")}`;

    const newShipment: Shipment = {
      id: shipmentId,
      supplierId,
      importerId,
      productId,
      originCountry,
      destinationPort,
      vesselName,
      etd,
      eta,
      status: "in-transit",
      createdAt: new Date().toISOString().split("T")[0],
    };
    mockShipments.push(newShipment);

    containers.forEach((cf) => {
      const containerId = `CNT${String(mockContainers.length + 1).padStart(3, "0")}`;

      const newContainer: Container = {
        id: containerId,
        shipmentId,
        containerNumber: cf.containerNumber.toUpperCase(),
        containerType: cf.containerType as Container["containerType"],
        temperature: cf.temperature || undefined,
        eta,
        clearanceStatus: "missing-documents",
        portOfLoading: cf.portOfLoading,
        portOfDestination: cf.portOfDestination,
      };
      mockContainers.push(newContainer);

      ALL_DOCUMENT_TYPES.forEach((docType) => {
        const newDoc: Document = {
          id: `DOC${String(mockDocuments.length + 1).padStart(3, "0")}`,
          type: docType,
          status: "missing",
          containerId,
          shipmentId,
        };
        mockDocuments.push(newDoc);
      });
    });

    toast.success(
      `Shipment ${shipmentId} created with ${containers.length} container${containers.length > 1 ? "s" : ""}.`
    );
    onCreated();
    handleClose();
  };

  // ── Derived labels ───────────────────────────────────────────
  const isSupplier = role === "supplier";
  const partyLabel = isSupplier ? "Importer" : "Supplier";
  const partyPlaceholder = isSupplier ? "Select importer" : "Select supplier";
  const partyOptions = isSupplier ? mockImporters : mockSuppliers;

  const docNoteText = isSupplier
    ? "You can start uploading the required documents right away from the container page."
    : "The supplier will be notified and can start uploading documents right away.";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">New Shipment</DialogTitle>
          <div className="flex items-center gap-2 pt-2">
            <StepBadge n={1} current={step} label="Shipment Details" icon={<Ship className="w-3.5 h-3.5" />} />
            <div className="flex-1 h-px bg-gray-200" />
            <StepBadge n={2} current={step} label="Containers" icon={<ContainerIcon className="w-3.5 h-3.5" />} />
          </div>
        </DialogHeader>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">

              {/* Supplier/Importer picker (depends on role) */}
              <div className="space-y-1.5">
                <Label>{partyLabel} <span className="text-red-500">*</span></Label>
                <Select value={chosenPartyId} onValueChange={handlePartyChange}>
                  <SelectTrigger><SelectValue placeholder={partyPlaceholder} /></SelectTrigger>
                  <SelectContent>
                    {partyOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Product <span className="text-red-500">*</span></Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {mockProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Vessel Name <span className="text-red-500">*</span></Label>
                <Input placeholder="e.g. MSC Paloma" value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Origin Country <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. South Africa"
                  value={originCountry}
                  onChange={(e) => setOriginCountry(e.target.value)}
                  // Supplier's own country is auto-filled but still editable
                />
              </div>

              <div className="space-y-1.5">
                <Label>ETD (Estimated Departure) <span className="text-red-500">*</span></Label>
                <Input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>ETA (Estimated Arrival) <span className="text-red-500">*</span></Label>
                <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label>Destination Port <span className="text-red-500">*</span></Label>
                <Input placeholder="e.g. Rotterdam, NL" value={destinationPort} onChange={(e) => handleDestinationPortChange(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            {containers.map((c, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">Container #{idx + 1}</p>
                  {containers.length > 1 && (
                    <Button variant="ghost" size="sm" className="text-red-500 h-auto p-1" onClick={() => removeContainer(idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Container Number <span className="text-red-500">*</span></Label>
                    <Input
                      placeholder="e.g. MSCU-1234567"
                      value={c.containerNumber}
                      onChange={(e) => updateContainer(idx, "containerNumber", e.target.value)}
                      className="uppercase placeholder:normal-case"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Container Type <span className="text-red-500">*</span></Label>
                    <Select value={c.containerType} onValueChange={(v) => updateContainer(idx, "containerType", v)}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20ft">20ft</SelectItem>
                        <SelectItem value="40ft">40ft</SelectItem>
                        <SelectItem value="40ft HC">40ft HC</SelectItem>
                        <SelectItem value="Reefer 40ft">Reefer 40ft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {c.containerType === "Reefer 40ft" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Temperature (optional)</Label>
                      <Input placeholder="e.g. -1°C" value={c.temperature} onChange={(e) => updateContainer(idx, "temperature", e.target.value)} />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">Port of Loading <span className="text-red-500">*</span></Label>
                    <Input placeholder="e.g. Cape Town" value={c.portOfLoading} onChange={(e) => updateContainer(idx, "portOfLoading", e.target.value)} />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Port of Destination <span className="text-red-500">*</span></Label>
                    <Input placeholder="e.g. Rotterdam" value={c.portOfDestination} onChange={(e) => updateContainer(idx, "portOfDestination", e.target.value)} />
                  </div>
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={addContainer}>
              <Plus className="w-4 h-4" />
              Add Another Container
            </Button>

            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Each container will automatically get <strong>7 required documents</strong> (Commercial Invoice, Packing List, Phytosanitary Certificate, Bill of Lading, Certificate of Origin, Cooling Report, Insurance) — all starting as <strong>Missing</strong>.{" "}
                {docNoteText}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            {step === 1 && (
              <Button disabled={!step1Valid} onClick={() => setStep(2)}>
                Next: Containers →
              </Button>
            )}
            {step === 2 && (
              <Button disabled={!step2Valid} onClick={handleSubmit}>
                Create Shipment
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepBadge({ n, current, label, icon }: { n: number; current: number; label: string; icon: React.ReactNode }) {
  const done = current > n;
  const active = current === n;
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
        done ? "bg-green-500 text-white"
        : active ? "bg-blue-600 text-white"
        : "bg-gray-200 text-gray-500"
      }`}>
        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
      </div>
      <span className={`hidden sm:flex items-center gap-1 text-xs ${active ? "text-gray-900 font-medium" : "text-gray-400"}`}>
        {icon}{label}
      </span>
    </div>
  );
}
