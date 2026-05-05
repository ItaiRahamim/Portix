"use client";

/**
 * EditContainerDialog
 *
 * Manual-override dialog for core AI-extracted container fields.
 * Available to importer and supplier roles only.
 *
 * Pre-fills from the current ContainerView. On submit, updates:
 *   - portix.containers  → carrier, etd, eta
 *   - portix.shipments   → vessel_name
 *   - portix.documents   → document_number on the bill_of_lading row
 *
 * After success: closes, shows toast, calls onSuccess() so the parent can refresh.
 */

import { useState } from "react";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateContainerDetails } from "@/lib/db";
import { CARRIER_LABELS, type CarrierKey } from "@/lib/tracking";
import type { ContainerView } from "@/lib/supabase";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Convert a TIMESTAMPTZ/date string to the YYYY-MM-DD needed by <input type="date">. */
function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  // Use local-time components to avoid UTC midnight shift
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  container: ContainerView;
  /** Called after a successful save so the parent can reload / refresh. */
  onSuccess: () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

export function EditContainerDialog({ container, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state — pre-filled from current container data
  const [blNumber, setBlNumber] = useState(container.bill_of_lading_number ?? "");
  const [carrier, setCarrier] = useState(container.carrier ?? "");
  const [vessel, setVessel] = useState(container.vessel_name ?? "");
  const [etd, setEtd] = useState(toDateInputValue(container.etd));
  const [eta, setEta] = useState(toDateInputValue(container.eta));

  function handleOpen() {
    // Re-sync state with latest container prop when dialog opens
    setBlNumber(container.bill_of_lading_number ?? "");
    setCarrier(container.carrier ?? "");
    setVessel(container.vessel_name ?? "");
    setEtd(toDateInputValue(container.etd));
    setEta(toDateInputValue(container.eta));
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!etd || !eta) {
      toast.error("ETD and ETA are required.");
      return;
    }

    setSaving(true);
    const ok = await updateContainerDetails(container.id, container.shipment_id, {
      bill_of_lading_number: blNumber,
      carrier: carrier || null,
      vessel_name: vessel,
      etd,
      eta,
    });
    setSaving(false);

    if (ok) {
      toast.success("Container details updated.");
      setOpen(false);
      onSuccess();
    } else {
      toast.error("Failed to save. Check your permissions and try again.");
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleOpen}>
        <Pencil className="w-3.5 h-3.5" />
        Edit Details
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Container Details</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Bill of Lading Number */}
            <div className="space-y-1.5">
              <Label htmlFor="bl-number">Bill of Lading Number</Label>
              <Input
                id="bl-number"
                placeholder="e.g. ZIMUMEX12345678"
                value={blNumber}
                onChange={(e) => setBlNumber(e.target.value)}
              />
            </div>

            {/* Carrier */}
            <div className="space-y-1.5">
              <Label htmlFor="carrier">Carrier</Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger id="carrier">
                  <SelectValue placeholder="Select carrier…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unknown / Not listed</SelectItem>
                  {(Object.entries(CARRIER_LABELS) as [CarrierKey, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Vessel */}
            <div className="space-y-1.5">
              <Label htmlFor="vessel">Vessel Name</Label>
              <Input
                id="vessel"
                placeholder="e.g. MSC LORETTA"
                value={vessel}
                onChange={(e) => setVessel(e.target.value)}
              />
            </div>

            {/* ETD / ETA side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="etd">ETD</Label>
                <Input
                  id="etd"
                  type="date"
                  value={etd}
                  onChange={(e) => setEtd(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eta">ETA</Label>
                <Input
                  id="eta"
                  type="date"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
