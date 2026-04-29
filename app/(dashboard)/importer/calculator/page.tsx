"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Calculator, Ship, Package, DollarSign, Landmark, Trash2, Plus, Save,
  FolderOpen, Download, RotateCcw, TrendingUp, ChevronDown, ChevronUp,
  Weight, BarChart3, Info,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getAccountProfiles } from "@/lib/db";
import type { Profile } from "@/lib/supabase";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────
interface CurrencyRate {
  code: string;
  symbol: string;
  rateToUSD: number; // 1 unit = X USD
}

interface ProductLine {
  id: string;
  productId: string;
  hsCode: string;
  quantity: number;       // units
  unitPriceOriginal: number;
  currency: string;
  packagingType: string;
}

interface CustomsCostLine {
  id: string;
  label: string;
  amount: number;
  isPercentage: boolean; // true = % of CIF, false = fixed NIS
}

interface RouteTemplate {
  id: string;
  name: string;
  originCountry: string;
  originPort: string;
  destinationPort: string;
  shippingLine: string;
  transitDays: number;
  freightCostUSD: number;
  insurancePercent: number;
}

// ─── Currency Data ──────────────────────────────────────────────
const CURRENCIES: CurrencyRate[] = [
  { code: "USD", symbol: "$", rateToUSD: 1.0 },
  { code: "EUR", symbol: "€", rateToUSD: 1.09 },
  { code: "GBP", symbol: "£", rateToUSD: 1.27 },
  { code: "ZAR", symbol: "R", rateToUSD: 0.055 },
  { code: "CLP", symbol: "CL$", rateToUSD: 0.00106 },
  { code: "NZD", symbol: "NZ$", rateToUSD: 0.61 },
  { code: "ILS", symbol: "₪", rateToUSD: 0.28 },
];

const USD_TO_ILS = 3.57; // For final NIS display

// ─── Default Route Templates ────────────────────────────────────
const DEFAULT_TEMPLATES: RouteTemplate[] = [
  { id: "RT001", name: "South Africa → Ashdod (Citrus)", originCountry: "South Africa", originPort: "Cape Town", destinationPort: "Ashdod", shippingLine: "MSC", transitDays: 14, freightCostUSD: 3200, insurancePercent: 0.5 },
  { id: "RT002", name: "Chile → Ashdod (Grapes)", originCountry: "Chile", originPort: "Valparaíso", destinationPort: "Ashdod", shippingLine: "Maersk", transitDays: 21, freightCostUSD: 4500, insurancePercent: 0.5 },
  { id: "RT003", name: "Spain → Haifa (Citrus)", originCountry: "Spain", originPort: "Valencia", destinationPort: "Haifa", shippingLine: "ZIM", transitDays: 5, freightCostUSD: 1800, insurancePercent: 0.3 },
  { id: "RT004", name: "New Zealand → Ashdod (Kiwi)", originCountry: "New Zealand", originPort: "Auckland", destinationPort: "Ashdod", shippingLine: "Maersk", transitDays: 28, freightCostUSD: 5200, insurancePercent: 0.6 },
];

// ─── Packaging types ────────────────────────────────────────────
const PACKAGING_TYPES = ["Open Top Carton", "Closed Carton", "Bag", "Crate", "Pallet Bin", "Other"];

// ─── Default customs cost lines ─────────────────────────────────
const defaultCustomsCosts = (): CustomsCostLine[] => [
  { id: "cc1", label: "Broker Invoice", amount: 0, isPercentage: false },
  { id: "cc2", label: "Inland Trucking", amount: 3500, isPercentage: false },
];

const emptyProductLine = (): ProductLine => ({
  id: crypto.randomUUID(),
  productId: "",
  hsCode: "",
  quantity: 0,
  unitPriceOriginal: 0,
  currency: "USD",
  packagingType: "",
});

// ─── Helper ─────────────────────────────────────────────────────
function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtNIS(n: number): string {
  return `₪${fmt(n)}`;
}

function fmtUSD(n: number): string {
  return `$${fmt(n)}`;
}

// ─── Component ──────────────────────────────────────────────────
export default function CalculatorPage() {
  // ── Section collapse state ──
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }));

  // ── Section 1: Shipment Info ──
  const [supplierId, setSupplierId] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [originPort, setOriginPort] = useState("");
  const [destinationPort, setDestinationPort] = useState("");
  const [shippingLine, setShippingLine] = useState("");
  const [transitDays, setTransitDays] = useState(0);
  const [containerType, setContainerType] = useState<string>("Reefer 40ft");
  const [containersCount, setContainersCount] = useState(1);
  const [freightCostUSD, setFreightCostUSD] = useState(0);
  const [insurancePercent, setInsurancePercent] = useState(0.5);

  // ── Section 2: Product Lines ──
  const [productLines, setProductLines] = useState<ProductLine[]>([emptyProductLine()]);

  // ── Section 3: Customs & Local Costs ──
  const [customsCosts, setCustomsCosts] = useState<CustomsCostLine[]>(defaultCustomsCosts());
  const [includeVAT, setIncludeVAT] = useState(true);
  const VAT_RATE = 17; // Israel VAT

  // ── Section 4: Profit Simulation ──
  const [targetSellingPricePerKg, setTargetSellingPricePerKg] = useState(0);

  // ── Supplier profiles ──
  const [supplierProfiles, setSupplierProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    getAccountProfiles("supplier").then(setSupplierProfiles);
  }, []);

  // ── Route Templates ──
  const [savedTemplates, setSavedTemplates] = useState<RouteTemplate[]>(DEFAULT_TEMPLATES);
  const [templateName, setTemplateName] = useState("");

  // No origin country auto-fill — Profile has no country field; user enters manually

  // ── Product line handlers ──
  const updateProductLine = useCallback((id: string, field: keyof ProductLine, value: string | number) => {
    setProductLines((prev) =>
      prev.map((pl) => {
        if (pl.id !== id) return pl;
        const updated = { ...pl, [field]: value };
        // Auto-fill HS code when product selected
        // No product auto-fill — product name is free text
        return updated;
      })
    );
  }, []);

  const addProductLine = () => setProductLines((prev) => [...prev, emptyProductLine()]);
  const removeProductLine = (id: string) => {
    if (productLines.length <= 1) return;
    setProductLines((prev) => prev.filter((pl) => pl.id !== id));
  };

  // ── Customs cost handlers ──
  const updateCustomsCost = (id: string, field: keyof CustomsCostLine, value: string | number | boolean) => {
    setCustomsCosts((prev) => prev.map((cc) => cc.id === id ? { ...cc, [field]: value } : cc));
  };
  const addCustomsCostLine = () => {
    setCustomsCosts((prev) => [...prev, { id: crypto.randomUUID(), label: "", amount: 0, isPercentage: false }]);
  };
  const removeCustomsCostLine = (id: string) => {
    setCustomsCosts((prev) => prev.filter((cc) => cc.id !== id));
  };

  // ── Route Template handlers ──
  const applyTemplate = (template: RouteTemplate) => {
    setOriginCountry(template.originCountry);
    setOriginPort(template.originPort);
    setDestinationPort(template.destinationPort);
    setShippingLine(template.shippingLine);
    setTransitDays(template.transitDays);
    setFreightCostUSD(template.freightCostUSD);
    setInsurancePercent(template.insurancePercent);
    toast.success(`Applied template: ${template.name}`);
  };

  const saveAsTemplate = () => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    const newTemplate: RouteTemplate = {
      id: crypto.randomUUID(),
      name: templateName,
      originCountry,
      originPort,
      destinationPort,
      shippingLine,
      transitDays,
      freightCostUSD,
      insurancePercent,
    };
    setSavedTemplates((prev) => [...prev, newTemplate]);
    setTemplateName("");
    toast.success(`Template "${newTemplate.name}" saved`);
  };

  // ── Reset all ──
  const resetAll = () => {
    setSupplierId("");
    setOriginCountry("");
    setOriginPort("");
    setDestinationPort("");
    setShippingLine("");
    setTransitDays(0);
    setContainerType("Reefer 40ft");
    setContainersCount(1);
    setFreightCostUSD(0);
    setInsurancePercent(0.5);
    setProductLines([emptyProductLine()]);
    setCustomsCosts(defaultCustomsCosts());
    setIncludeVAT(true);
    setTargetSellingPricePerKg(0);
    setTemplateName("");
    toast.success("Calculator reset");
  };

  // ═══════════════════════════════════════════════════════════════
  // CALCULATIONS
  // ═══════════════════════════════════════════════════════════════
  const calculations = useMemo(() => {
    // Total quantity across all product lines
    const totalQuantityUnits = productLines.reduce((sum, pl) => sum + (pl.quantity || 0), 0);

    // FOB — sum of (quantity × unitPrice converted to USD) per line
    const fobPerLineUSD = productLines.map((pl) => {
      const rate = CURRENCIES.find((c) => c.code === pl.currency)?.rateToUSD ?? 1;
      return (pl.quantity || 0) * (pl.unitPriceOriginal || 0) * rate;
    });
    const totalFobUSD = fobPerLineUSD.reduce((a, b) => a + b, 0);

    // Freight
    const totalFreightUSD = freightCostUSD * containersCount;

    // Insurance (% of FOB)
    const totalInsuranceUSD = totalFobUSD * (insurancePercent / 100);

    // CIF = FOB + Freight + Insurance
    const cifUSD = totalFobUSD + totalFreightUSD + totalInsuranceUSD;
    const cifNIS = cifUSD * USD_TO_ILS;

    // Customs & Local Costs (NIS)
    const customsCostsBreakdown = customsCosts.map((cc) => {
      const amountNIS = cc.isPercentage ? (cifNIS * (cc.amount / 100)) : (cc.amount || 0);
      return { ...cc, computedNIS: amountNIS };
    });
    const totalCustomsCostsNIS = customsCostsBreakdown.reduce((sum, cc) => sum + cc.computedNIS, 0);

    // VAT
    const vatBaseNIS = cifNIS + totalCustomsCostsNIS;
    const vatAmountNIS = includeVAT ? vatBaseNIS * (VAT_RATE / 100) : 0;

    // TOTAL LANDED COST (NIS)
    const totalLandedCostNIS = cifNIS + totalCustomsCostsNIS + vatAmountNIS;

    // Cost per unit
    const costPerUnitNIS = totalQuantityUnits > 0 ? totalLandedCostNIS / totalQuantityUnits : 0;
    const costPerUnitUSD = costPerUnitNIS / USD_TO_ILS;

    // Profit simulation
    const sellingPriceNIS = targetSellingPricePerKg * totalQuantityUnits;
    const grossProfitNIS = sellingPriceNIS - totalLandedCostNIS;
    const grossMarginPercent = sellingPriceNIS > 0 ? (grossProfitNIS / sellingPriceNIS) * 100 : 0;
    const profitPerUnitNIS = totalQuantityUnits > 0 ? grossProfitNIS / totalQuantityUnits : 0;

    return {
      totalQuantityUnits,
      fobPerLineUSD,
      totalFobUSD,
      totalFreightUSD,
      totalInsuranceUSD,
      cifUSD,
      cifNIS,
      customsCostsBreakdown,
      totalCustomsCostsNIS,
      vatAmountNIS,
      totalLandedCostNIS,
      costPerUnitNIS,
      costPerUnitUSD,
      sellingPriceNIS,
      grossProfitNIS,
      grossMarginPercent,
      profitPerUnitNIS,
    };
  }, [productLines, freightCostUSD, containersCount, insurancePercent, customsCosts, includeVAT, targetSellingPricePerKg]);

  // ── Section header helper ──
  const SectionHeader = ({ id, icon, title, subtitle }: { id: string; icon: React.ReactNode; title: string; subtitle: string }) => (
    <button
      className="flex items-center gap-3 w-full text-left py-1"
      onClick={() => toggle(id)}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      {collapsed[id] ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
    </button>
  );

  return (
    <DashboardLayout
      role="importer"
      title="Import Landed Cost Calculator"
      subtitle="Calculate the full landed cost of fresh produce imports — FOB to final shelf"
    >
      <div className="flex gap-6 items-start">
        {/* ── LEFT: Input Sections ── */}
        <div className="flex-1 space-y-4 min-w-0">

          {/* ══════════════ SECTION 1: Shipment Info ══════════════ */}
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                id="shipment"
                icon={<Ship className="w-4 h-4" />}
                title="Shipment Information"
                subtitle="Route, carrier, freight & insurance"
              />
            </CardHeader>
            {!collapsed.shipment && (
              <CardContent className="space-y-4">
                {/* Route Templates */}
                <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
                    <FolderOpen className="w-3.5 h-3.5" />
                    Route Templates
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {savedTemplates.map((t) => (
                      <Button
                        key={t.id}
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => applyTemplate(t)}
                      >
                        {t.name}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Input
                      placeholder="Template name…"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      className="text-xs h-7 flex-1"
                    />
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={saveAsTemplate}>
                      <Save className="w-3 h-3" /> Save Current
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Supplier</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>
                        {supplierProfiles.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.company_name || s.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Origin Country</Label>
                    <Input className="h-9" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder="e.g. South Africa" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Origin Port</Label>
                    <Input className="h-9" value={originPort} onChange={(e) => setOriginPort(e.target.value)} placeholder="e.g. Cape Town" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Destination Port</Label>
                    <Input className="h-9" value={destinationPort} onChange={(e) => setDestinationPort(e.target.value)} placeholder="e.g. Ashdod" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Shipping Line</Label>
                    <Input className="h-9" value={shippingLine} onChange={(e) => setShippingLine(e.target.value)} placeholder="e.g. MSC, Maersk" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transit Days</Label>
                    <Input className="h-9" type="number" min={0} value={transitDays || ""} onChange={(e) => setTransitDays(Number(e.target.value))} />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Container Type</Label>
                    <Select value={containerType} onValueChange={setContainerType}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20ft">20ft</SelectItem>
                        <SelectItem value="40ft">40ft</SelectItem>
                        <SelectItem value="40ft HC">40ft HC</SelectItem>
                        <SelectItem value="Reefer 40ft">Reefer 40ft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs"># of Containers</Label>
                    <Input className="h-9" type="number" min={1} value={containersCount || ""} onChange={(e) => setContainersCount(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Freight Cost / Container (USD)</Label>
                    <Input className="h-9" type="number" min={0} step={100} value={freightCostUSD || ""} onChange={(e) => setFreightCostUSD(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Insurance (% of FOB)</Label>
                    <Input className="h-9" type="number" min={0} step={0.1} max={10} value={insurancePercent || ""} onChange={(e) => setInsurancePercent(Number(e.target.value))} />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* ══════════════ SECTION 2: Product Details ══════════════ */}
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                id="products"
                icon={<Package className="w-4 h-4" />}
                title="Product Details & Purchase Price"
                subtitle="Products, quantities, pricing in any currency"
              />
            </CardHeader>
            {!collapsed.products && (
              <CardContent className="space-y-3">
                {productLines.map((pl, idx) => (
                  <div key={pl.id} className="border rounded-lg p-3 space-y-3 relative">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-600">Product Line #{idx + 1}</p>
                      {productLines.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-red-500 h-auto p-1" onClick={() => removeProductLine(pl.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Product</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Citrus Fruits"
                          value={pl.productId}
                          onChange={(e) => updateProductLine(pl.id, "productId", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">HS Code</Label>
                        <Input className="h-8 text-xs" value={pl.hsCode} onChange={(e) => updateProductLine(pl.id, "hsCode", e.target.value)} placeholder="Auto-filled" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Quantity (Units)</Label>
                        <Input className="h-8 text-xs" type="number" min={0} value={pl.quantity || ""} onChange={(e) => updateProductLine(pl.id, "quantity", Number(e.target.value))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unit Price</Label>
                        <div className="flex gap-1">
                          <Select value={pl.currency} onValueChange={(v) => updateProductLine(pl.id, "currency", v)}>
                            <SelectTrigger className="h-8 text-xs w-[80px] shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>{c.code} {c.symbol}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input className="h-8 text-xs" type="number" min={0} step={0.01} value={pl.unitPriceOriginal || ""} onChange={(e) => updateProductLine(pl.id, "unitPriceOriginal", Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Packaging</Label>
                        <Select value={pl.packagingType} onValueChange={(v) => updateProductLine(pl.id, "packagingType", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {PACKAGING_TYPES.map((pt) => (
                              <SelectItem key={pt} value={pt}>{pt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Line subtotal */}
                    {pl.quantity > 0 && pl.unitPriceOriginal > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 pt-1 border-t">
                        <span>Line FOB:</span>
                        <span className="font-medium text-gray-700">
                          {fmtUSD(calculations.fobPerLineUSD[idx] || 0)}
                        </span>
                        {pl.currency !== "USD" && (
                          <span className="text-gray-400">
                            (from {CURRENCIES.find((c) => c.code === pl.currency)?.symbol}{fmt(pl.quantity * pl.unitPriceOriginal)} {pl.currency})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1.5 w-full text-xs" onClick={addProductLine}>
                  <Plus className="w-3.5 h-3.5" /> Add Product Line
                </Button>
              </CardContent>
            )}
          </Card>

          {/* ══════════════ SECTION 3: Customs & Local Costs ══════════════ */}
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                id="customs"
                icon={<Landmark className="w-4 h-4" />}
                title="Customs & Local Costs"
                subtitle="Duties, port fees, trucking, inspection — in NIS"
              />
            </CardHeader>
            {!collapsed.customs && (
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <Switch id="vat-toggle" checked={includeVAT} onCheckedChange={setIncludeVAT} />
                    <Label htmlFor="vat-toggle" className="text-xs cursor-pointer">
                      Include VAT ({VAT_RATE}%)
                    </Label>
                  </div>
                  <span className="text-xs text-gray-400">
                    CIF base: {fmtNIS(calculations.cifNIS)}
                  </span>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cost Item</TableHead>
                      <TableHead className="text-xs w-[100px]">Type</TableHead>
                      <TableHead className="text-xs w-[120px]">Amount</TableHead>
                      <TableHead className="text-xs w-[100px] text-right">Computed (₪)</TableHead>
                      <TableHead className="text-xs w-[40px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculations.customsCostsBreakdown.map((cc) => (
                      <TableRow key={cc.id}>
                        <TableCell>
                          <Input
                            className="h-7 text-xs border-0 bg-transparent px-0"
                            value={cc.label}
                            onChange={(e) => updateCustomsCost(cc.id, "label", e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={cc.isPercentage ? "percent" : "fixed"}
                            onValueChange={(v) => updateCustomsCost(cc.id, "isPercentage", v === "percent")}
                          >
                            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">Fixed ₪</SelectItem>
                              <SelectItem value="percent">% of CIF</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-7 text-xs w-[100px]"
                            type="number"
                            min={0}
                            step={cc.isPercentage ? 0.1 : 100}
                            value={cc.amount || ""}
                            onChange={(e) => updateCustomsCost(cc.id, "amount", Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {fmtNIS(cc.computedNIS)}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gray-400 hover:text-red-500" onClick={() => removeCustomsCostLine(cc.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7" onClick={addCustomsCostLine}>
                    <Plus className="w-3 h-3" /> Add Cost Line
                  </Button>
                  <div className="text-xs text-gray-500">
                    Subtotal: <span className="font-medium text-gray-700">{fmtNIS(calculations.totalCustomsCostsNIS)}</span>
                    {includeVAT && (
                      <span className="ml-2">
                        + VAT: <span className="font-medium text-gray-700">{fmtNIS(calculations.vatAmountNIS)}</span>
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* ══════════════ SECTION 4: Profit Simulation ══════════════ */}
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                id="profit"
                icon={<TrendingUp className="w-4 h-4" />}
                title="Profit Simulation"
                subtitle="Set target selling price and see projected margins"
              />
            </CardHeader>
            {!collapsed.profit && (
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Target Selling Price (₪/unit)</Label>
                    <Input className="h-9" type="number" min={0} step={0.5} value={targetSellingPricePerKg || ""} onChange={(e) => setTargetSellingPricePerKg(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-400">Total Revenue</Label>
                    <div className="h-9 flex items-center text-sm font-medium">{fmtNIS(calculations.sellingPriceNIS)}</div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-400">Gross Profit</Label>
                    <div className={`h-9 flex items-center text-sm font-bold ${calculations.grossProfitNIS >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmtNIS(calculations.grossProfitNIS)}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-400">Gross Margin</Label>
                    <div className={`h-9 flex items-center text-sm font-bold ${calculations.grossMarginPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmt(calculations.grossMarginPercent, 1)}%
                    </div>
                  </div>
                </div>
                {targetSellingPricePerKg > 0 && (
                  <div className={`mt-3 rounded-lg p-3 text-xs flex items-center gap-2 ${calculations.grossProfitNIS >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                    <TrendingUp className="w-4 h-4" />
                    {calculations.grossProfitNIS >= 0
                      ? `Profit of ${fmtNIS(calculations.profitPerUnitNIS)}/unit on ${fmt(calculations.totalQuantityUnits, 0)} units.`
                      : `Loss of ${fmtNIS(Math.abs(calculations.profitPerUnitNIS))}/unit — consider negotiating lower purchase price or reducing costs.`
                    }
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── RIGHT: Sticky Cost Summary Panel ── */}
        <div className="w-[340px] shrink-0 hidden lg:block">
          <div className="sticky top-[72px] space-y-4">
            <Card className="border-2 border-blue-200 shadow-lg">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    Cost Summary
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-gray-400" onClick={resetAll}>
                    <RotateCcw className="w-3 h-3" /> Reset
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Main KPI */}
                <div className="rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 p-4 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total Landed Cost</p>
                  <p className="text-2xl font-bold text-gray-900">{fmtNIS(calculations.totalLandedCostNIS)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtUSD(calculations.totalLandedCostNIS / USD_TO_ILS)}</p>
                </div>

                {/* Cost per unit */}
                <div className="rounded-lg bg-gray-50 p-2.5 text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Cost/Unit</p>
                  <p className="text-sm font-bold text-gray-800 mt-0.5">{fmtNIS(calculations.costPerUnitNIS)}</p>
                  <p className="text-[10px] text-gray-400">{fmtUSD(calculations.costPerUnitUSD)}</p>
                </div>

                <Separator />

                {/* Breakdown */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">FOB</span>
                    <span className="font-medium">{fmtUSD(calculations.totalFobUSD)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Freight ({containersCount}×)</span>
                    <span className="font-medium">{fmtUSD(calculations.totalFreightUSD)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Insurance ({insurancePercent}%)</span>
                    <span className="font-medium">{fmtUSD(calculations.totalInsuranceUSD)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-1">
                    <span>CIF</span>
                    <span>{fmtUSD(calculations.cifUSD)}</span>
                  </div>

                  <Separator />

                  <div className="flex justify-between">
                    <span className="text-gray-500">Customs & Local</span>
                    <span className="font-medium">{fmtNIS(calculations.totalCustomsCostsNIS)}</span>
                  </div>
                  {includeVAT && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">VAT ({VAT_RATE}%)</span>
                      <span className="font-medium">{fmtNIS(calculations.vatAmountNIS)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-1 text-sm">
                    <span>Total Landed</span>
                    <span>{fmtNIS(calculations.totalLandedCostNIS)}</span>
                  </div>
                </div>

                <Separator />

                {/* Quantity summary */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500 flex items-center gap-1"><Weight className="w-3 h-3" /> Total Qty</span>
                    <span>{fmt(calculations.totalQuantityUnits, 0)} units</span>
                  </div>
                </div>

                {/* Profit bar if selling price set */}
                {targetSellingPricePerKg > 0 && (
                  <>
                    <Separator />
                    <div className={`rounded-lg p-3 text-center ${calculations.grossProfitNIS >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Projected Profit</p>
                      <p className={`text-lg font-bold ${calculations.grossProfitNIS >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmtNIS(calculations.grossProfitNIS)}
                      </p>
                      <p className={`text-xs ${calculations.grossMarginPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                        Margin: {fmt(calculations.grossMarginPercent, 1)}% · {fmtNIS(calculations.profitPerUnitNIS)}/unit
                      </p>
                    </div>
                  </>
                )}

                {/* Export buttons — coming post-MVP */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-8 gap-1 cursor-not-allowed opacity-50"
                    disabled
                    title="Coming soon"
                  >
                    <Download className="w-3 h-3" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-8 gap-1 cursor-not-allowed opacity-50"
                    disabled
                    title="Coming soon"
                  >
                    <Download className="w-3 h-3" /> Excel
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Exchange rates card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-gray-500 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  Exchange Rates (Mock)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {CURRENCIES.filter((c) => c.code !== "USD").map((c) => (
                    <div key={c.code} className="flex justify-between text-gray-500">
                      <span>{c.code}</span>
                      <span className="font-mono">{c.rateToUSD.toFixed(4)}</span>
                    </div>
                  ))}
                  <div className="col-span-2 border-t mt-1 pt-1 flex justify-between font-medium text-gray-700">
                    <span>USD → ILS</span>
                    <span className="font-mono">{USD_TO_ILS}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Mobile Summary (visible < lg) ── */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 z-40">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Total Landed Cost</p>
            <p className="text-lg font-bold">{fmtNIS(calculations.totalLandedCostNIS)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Cost/Unit</p>
            <p className="text-sm font-bold">{fmtNIS(calculations.costPerUnitNIS)}</p>
          </div>
          {targetSellingPricePerKg > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Margin</p>
              <p className={`text-sm font-bold ${calculations.grossMarginPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                {fmt(calculations.grossMarginPercent, 1)}%
              </p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
