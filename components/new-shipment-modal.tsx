"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Ship, Container as ContainerIcon, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { createShipmentWithContainers, getCurrentProfile, getAccountProfiles } from "@/lib/db";
import { useRef } from "react";
import type { Profile } from "@/lib/supabase";
import { toast } from "sonner";

interface NewContainerFields {
  containerNumber: string;
  containerType: "20ft" | "40ft" | "40ft_hc" | "reefer_40ft" | "";
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
  const [submitting, setSubmitting] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const aiFileRef = useRef<HTMLInputElement>(null);
  const [partyProfiles, setPartyProfiles] = useState<Profile[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);

  // Step 1 – Shipment fields
  const [chosenPartyId, setChosenPartyId] = useState("");
  const [productName, setProductName] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [voyageNumber, setVoyageNumber] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [destinationPort, setDestinationPort] = useState("");

  // Step 2 – Containers list
  const [containers, setContainers] = useState<NewContainerFields[]>([emptyContainer()]);

  // Load counterpart profiles when modal opens
  const counterpartRole = role === "importer" ? "supplier" : "importer";

  const loadParties = useCallback(async () => {
    setLoadingParties(true);
    const profiles = await getAccountProfiles(counterpartRole);
    setPartyProfiles(profiles);
    setLoadingParties(false);
  }, [counterpartRole]);

  useEffect(() => {
    if (open) {
      loadParties();
      // If supplier, pre-fill their own country via profile
      if (role === "supplier") {
        getCurrentProfile().then((p) => {
          // suppliers can update this field manually
          setOriginCountry("");
        });
      }
    }
  }, [open, role, loadParties]);

  const resetForm = () => {
    setStep(1);
    setChosenPartyId("");
    setProductName("");
    setVesselName("");
    setVoyageNumber("");
    setEtd("");
    setEta("");
    setOriginCountry("");
    setDestinationPort("");
    setContainers([emptyContainer()]);
  };

  const handleClose = () => { resetForm(); onClose(); };

  // When importer picks a supplier → could auto-fill origin country if we had it
  const handlePartyChange = (id: string) => {
    setChosenPartyId(id);
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
    chosenPartyId && productName.trim() && vesselName.trim() &&
    etd && eta && originCountry.trim() && destinationPort.trim();

  const step2Valid = containers.every(
    (c) => c.containerNumber.trim() && c.containerType &&
            c.portOfLoading.trim() && c.portOfDestination.trim()
  );

  // ── AI Auto-fill ─────────────────────────────────────────────
  async function handleAiAutofill(file: File) {
    setAiParsing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-shipment", { method: "POST", body: form });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "AI parsing failed" }));
        toast.error(error ?? "AI parsing failed");
        return;
      }
      const { shipment, containers: parsedContainers } = await res.json();

      // Map Make response → form state (all fields remain editable)
      if (shipment.vesselName)      setVesselName(shipment.vesselName);
      if (shipment.voyageNumber)    setVoyageNumber(shipment.voyageNumber);
      if (shipment.originCountry)   setOriginCountry(shipment.originCountry);
      if (shipment.destinationPort) {
        setDestinationPort(shipment.destinationPort);
        setContainers((prev) =>
          prev.map((c) => ({ ...c, portOfDestination: shipment.destinationPort }))
        );
      }
      if (shipment.etd) setEtd(shipment.etd);
      if (shipment.eta) setEta(shipment.eta);

      if (Array.isArray(parsedContainers) && parsedContainers.length > 0) {
        setContainers(
          parsedContainers.map((pc: {
            containerNumber?: string;
            containerType?: string;
            portOfLoading?: string;
            portOfDestination?: string;
            temperature?: string;
          }) => ({
            containerNumber: pc.containerNumber ?? "",
            containerType: (pc.containerType as NewContainerFields["containerType"]) ?? "",
            portOfLoading:    pc.portOfLoading    ?? "",
            portOfDestination: pc.portOfDestination ?? shipment.destinationPort ?? "",
            temperature:      pc.temperature      ?? "",
          }))
        );
      }

      toast.success("Form filled from document — review and adjust before submitting.");
    } catch (err) {
      toast.error("AI parsing failed. Fill manually.");
    } finally {
      setAiParsing(false);
      if (aiFileRef.current) aiFileRef.current.value = "";
    }
  }

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const profile = await getCurrentProfile();
      if (!profile) {
        toast.error("Could not identify current user. Please log in again.");
        return;
      }

      const supplierId = role === "importer" ? chosenPartyId : profile.id;
      const importerId = role === "supplier" ? chosenPartyId : profile.id;

      // Generate a unique shipment number
      const shipmentNumber = `SHP-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

      // Atomic: shipment + all containers + 7 docs per container in one transaction
      const result = await createShipmentWithContainers({
        shipmentNumber,
        vesselName: vesselName.trim(),
        voyageNumber: voyageNumber.trim() || undefined,
        originCountry: originCountry.trim() || undefined,
        importerId,
        supplierId,
        productName: productName.trim(),
        etd,
        eta,
        containers: containers.map((cf) => ({
          containerNumber:    cf.containerNumber.toUpperCase().trim(),
          containerType:      cf.containerType as string,
          portOfLoading:      cf.portOfLoading.trim(),
          portOfDestination:  cf.portOfDestination.trim(),
          temperatureSetting: cf.temperature.trim() || undefined,
        })),
      });

      if (!result) {
        toast.error("Failed to create shipment. Please try again.");
        return;
      }

      toast.success(
        `Shipment ${shipmentNumber} created with ${containers.length} container${containers.length > 1 ? "s" : ""}.`
      );

      onCreated();
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived labels ───────────────────────────────────────────
  const isSupplier = role === "supplier";
  const partyLabel = isSupplier ? "Importer" : "Supplier";
  const partyPlaceholder = isSupplier ? "Select importer" : "Select supplier";

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

            {/* AI Auto-fill strip */}
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/60 px-4 py-2.5">
              <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
              <p className="text-xs text-blue-700 flex-1">
                Have a Bill of Lading or Shipping Instruction? Auto-fill the form with AI.
              </p>
              <label>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-blue-700 border-blue-300 bg-white hover:bg-blue-50"
                  asChild
                  disabled={aiParsing}
                >
                  <span>
                    {aiParsing
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Parsing…</>
                      : <><Sparkles className="w-3.5 h-3.5" />Auto-fill with AI</>}
                  </span>
                </Button>
                <input
                  ref={aiFileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  disabled={aiParsing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAiAutofill(f);
                  }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">

              {/* Supplier/Importer picker */}
              <div className="space-y-1.5">
                <Label>{partyLabel} <span className="text-red-500">*</span></Label>
                <Select value={chosenPartyId} onValueChange={handlePartyChange} disabled={loadingParties}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingParties ? "Loading…" : partyPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {partyProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.company_name || p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Product Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. Citrus Fruits"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Vessel Name <span className="text-red-500">*</span></Label>
                <Input placeholder="e.g. MSC Paloma" value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Voyage Number</Label>
                <Input placeholder="e.g. 241W" value={voyageNumber} onChange={(e) => setVoyageNumber(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Origin Country <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. South Africa"
                  value={originCountry}
                  onChange={(e) => setOriginCountry(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Destination Port <span className="text-red-500">*</span></Label>
                <Input placeholder="e.g. Rotterdam, NL" value={destinationPort} onChange={(e) => handleDestinationPortChange(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>ETD (Estimated Departure) <span className="text-red-500">*</span></Label>
                <Input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>ETA (Estimated Arrival) <span className="text-red-500">*</span></Label>
                <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
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
                        <SelectItem value="40ft_hc">40ft HC</SelectItem>
                        <SelectItem value="reefer_40ft">Reefer 40ft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {c.containerType === "reefer_40ft" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Temperature Setting (optional)</Label>
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
              <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>Cancel</Button>
            {step === 1 && (
              <Button disabled={!step1Valid} onClick={() => setStep(2)}>
                Next: Containers →
              </Button>
            )}
            {step === 2 && (
              <Button disabled={!step2Valid || submitting} onClick={handleSubmit}>
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
                ) : (
                  "Create Shipment"
                )}
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
