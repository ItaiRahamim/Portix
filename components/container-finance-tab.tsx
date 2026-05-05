"use client";

/**
 * ContainerFinanceTab
 *
 * Landed-cost inputs for a single container. Loads existing data from
 * portix.container_costs on mount, lets the user edit all 6 components,
 * shows a real-time summary sidebar, and saves via upsert on "Save Financials".
 *
 * Formula:
 *   CIF          = FOB + Freight + Insurance
 *   VAT base     = CIF + Customs Duty + Port Handling
 *   VAT (18%)    = VAT base × 0.18
 *   Total Landed = CIF + Customs Duty + Port Handling + Inland Trucking + VAT
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, Save, Loader2, Ship, Landmark, Truck, Package,
  Anchor, ShieldCheck, TrendingUp,
} from "lucide-react";
import { getContainerCosts, upsertContainerCosts } from "@/lib/db";
import type { ContainerCosts } from "@/lib/db";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

const VAT_RATE = 0.18;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Field Definitions ────────────────────────────────────────────────────────

interface CostField {
  key: keyof Omit<ContainerCosts, "container_id" | "updated_at">;
  label: string;
  hint: string;
  Icon: React.ElementType;
}

const COST_FIELDS: CostField[] = [
  { key: "fob_value",       label: "FOB Value",        hint: "Free On Board — goods value at origin port", Icon: Package },
  { key: "freight",         label: "Freight",           hint: "Ocean / air shipping cost",                  Icon: Ship },
  { key: "insurance",       label: "Insurance",         hint: "Cargo insurance premium",                    Icon: ShieldCheck },
  { key: "customs_duty",    label: "Customs Duty",      hint: "Import tariff charged at destination",       Icon: Landmark },
  { key: "port_handling",   label: "Port Handling",     hint: "Port charges, terminal handling fees",       Icon: Anchor },
  { key: "inland_trucking", label: "Inland Trucking",   hint: "Trucking from port to warehouse",            Icon: Truck },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type CostFormState = Record<CostField["key"], string>; // string so inputs can hold "0" without clearing

const emptyForm = (): CostFormState => ({
  fob_value: "0",
  freight: "0",
  insurance: "0",
  customs_duty: "0",
  port_handling: "0",
  inland_trucking: "0",
});

function formToNumbers(f: CostFormState): Omit<ContainerCosts, "container_id" | "updated_at"> {
  return {
    fob_value:       parseFloat(f.fob_value)       || 0,
    freight:         parseFloat(f.freight)         || 0,
    insurance:       parseFloat(f.insurance)       || 0,
    customs_duty:    parseFloat(f.customs_duty)    || 0,
    port_handling:   parseFloat(f.port_handling)   || 0,
    inland_trucking: parseFloat(f.inland_trucking) || 0,
  };
}

function costsToForm(c: ContainerCosts): CostFormState {
  return {
    fob_value:       String(c.fob_value),
    freight:         String(c.freight),
    insurance:       String(c.insurance),
    customs_duty:    String(c.customs_duty),
    port_handling:   String(c.port_handling),
    inland_trucking: String(c.inland_trucking),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  containerId: string;
  role: "importer" | "supplier" | "customs-agent";
}

export function ContainerFinanceTab({ containerId, role }: Props) {
  const [form, setForm] = useState<CostFormState>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const isReadOnly = role === "customs-agent";

  // Load existing data on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await getContainerCosts(containerId);
      if (!cancelled) {
        if (data) {
          setForm(costsToForm(data));
          setLastSaved(data.updated_at);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [containerId]);

  // Real-time derived numbers
  const summary = useMemo(() => {
    const n = formToNumbers(form);
    const cif         = n.fob_value + n.freight + n.insurance;
    const vatBase     = cif + n.customs_duty + n.port_handling;
    const vat         = vatBase * VAT_RATE;
    const totalLanded = vatBase + n.inland_trucking + vat;
    return { ...n, cif, vatBase, vat, totalLanded };
  }, [form]);

  const handleChange = (key: CostField["key"], value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setSaving(true);
    const result = await upsertContainerCosts(containerId, formToNumbers(form));
    setSaving(false);
    if (result) {
      setLastSaved(result.updated_at);
      toast.success("Financials saved");
    } else {
      toast.error("Failed to save financials");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading cost data…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ── Left: Input Form ─────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-gray-400" />
                Cost Components
              </CardTitle>
              {lastSaved && (
                <p className="text-xs text-gray-400">
                  Last saved {new Date(lastSaved).toLocaleString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {COST_FIELDS.map(({ key, label, hint, Icon }) => (
              <div key={key} className="grid grid-cols-2 md:grid-cols-3 items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-shrink-0 w-7 h-7 rounded-md bg-gray-50 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium leading-none">{label}</Label>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{hint}</p>
                  </div>
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-3 text-xs text-gray-400 select-none pointer-events-none">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    disabled={isReadOnly}
                    className="pl-7 h-9 text-sm"
                    placeholder="0.00"
                  />
                </div>
              </div>
            ))}

            {!isReadOnly && (
              <>
                <Separator className="mt-2" />
                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                    {saving
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Save className="w-4 h-4" />}
                    Save Financials
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Right: Live Summary ───────────────────────────────────── */}
      <div className="space-y-4">
        <Card className="border-blue-100 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Cost Summary
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3 text-sm">
            {/* CIF breakdown */}
            <div className="rounded-lg bg-white border px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">CIF</p>
              <SummaryRow label="FOB Value"   value={summary.fob_value} />
              <SummaryRow label="+ Freight"   value={summary.freight} />
              <SummaryRow label="+ Insurance" value={summary.insurance} />
              <Separator />
              <SummaryRow label="CIF Total" value={summary.cif} bold />
            </div>

            {/* Local / customs */}
            <div className="rounded-lg bg-white border px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Local Costs</p>
              <SummaryRow label="Customs Duty"    value={summary.customs_duty} />
              <SummaryRow label="Port Handling"   value={summary.port_handling} />
              <SummaryRow label="Inland Trucking" value={summary.inland_trucking} />
            </div>

            {/* VAT */}
            <div className="rounded-lg bg-white border px-3 py-2.5 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">VAT</p>
              <SummaryRow label="VAT Base (CIF + Customs + Port)" value={summary.vatBase} />
              <SummaryRow label={`VAT @ ${VAT_RATE * 100}%`}      value={summary.vat} />
            </div>

            {/* Total */}
            <div className="rounded-xl bg-blue-600 text-white px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total Landed Cost</span>
                <span className="text-lg font-bold">${fmt(summary.totalLanded)}</span>
              </div>
              <p className="text-xs text-blue-200 mt-0.5">CIF + Customs + Port + Trucking + VAT</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Mini helper ──────────────────────────────────────────────────────────────

function SummaryRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-600">{label}</span>
      <span className={bold ? "text-gray-900" : "text-gray-800"}>${fmt(value)}</span>
    </div>
  );
}
