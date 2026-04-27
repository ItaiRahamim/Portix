"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Eye, Upload, AlertTriangle, CheckCircle, XCircle,
  Sparkles, Loader2, FileText, RotateCcw,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { getImportLicenses, getAccountProfiles } from "@/lib/db";
import type { ImportLicenseView, Profile } from "@/lib/supabase";
import { createBrowserSupabaseClient, STORAGE_BUCKETS } from "@/lib/supabase";
import { toast } from "sonner";

// ─── Display helpers ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  valid:         "bg-green-100 text-green-700",
  expiring_soon: "bg-yellow-100 text-yellow-700",
  expired:       "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<string, string> = {
  valid:         "Valid",
  expiring_soon: "Expiring Soon",
  expired:       "Expired",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ─── Form state type ──────────────────────────────────────────────────────────

type DialogMode = "ai" | "manual";  // which tab the user is on
type ExtractState = "idle" | "uploading" | "extracting" | "done" | "error";

// ─── Page component ───────────────────────────────────────────────────────────

export default function ImporterLicensesPage() {
  const [licenses, setLicenses]   = useState<ImportLicenseView[]>([]);
  const [suppliers, setSuppliers] = useState<Profile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // ── Dialog mode ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<DialogMode>("ai");

  // ── AI extraction state ────────────────────────────────────────────────────
  const [extractState, setExtractState]   = useState<ExtractState>("idle");
  const [aiFile, setAiFile]               = useState<File | null>(null);
  const [aiStoragePath, setAiStoragePath] = useState<string | null>(null); // already uploaded
  const [aiError, setAiError]             = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Form fields (shared between AI + manual modes) ─────────────────────────
  const [formSupplierId,    setFormSupplierId]    = useState("");
  const [formLicenseNumber, setFormLicenseNumber] = useState("");
  const [formProductType,   setFormProductType]   = useState("");
  const [formIssueDate,     setFormIssueDate]     = useState("");
  const [formExpDate,       setFormExpDate]        = useState("");
  const [formFile,          setFormFile]           = useState<File | null>(null);
  const [aiExtracted,       setAiExtracted]        = useState(false); // fields came from AI

  // ── Submit state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const [lics, sups] = await Promise.all([
      getImportLicenses(),
      getAccountProfiles("supplier"),
    ]);
    setLicenses(lics);
    setSuppliers(sups);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── KPI counts ─────────────────────────────────────────────────────────────

  const validCount       = licenses.filter((l) => l.license_status === "valid").length;
  const expiringSoonCount = licenses.filter((l) => l.license_status === "expiring_soon").length;
  const expiredCount     = licenses.filter((l) => l.license_status === "expired").length;

  // ── View license file ──────────────────────────────────────────────────────

  async function handleViewLicense(lic: ImportLicenseView) {
    if (!lic.storage_path) { toast.error("No file attached to this license."); return; }
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.licenseFiles)
      .createSignedUrl(lic.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Could not generate a view link."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  // ── Reset dialog ───────────────────────────────────────────────────────────

  function resetDialog() {
    setMode("ai");
    setExtractState("idle");
    setAiFile(null);
    setAiStoragePath(null);
    setAiError(null);
    setAiExtracted(false);
    setFormSupplierId("");
    setFormLicenseNumber("");
    setFormProductType("");
    setFormIssueDate("");
    setFormExpDate("");
    setFormFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── AI: upload file + invoke edge function ─────────────────────────────────

  async function handleExtract() {
    if (!aiFile) { toast.error("Please select a file first."); return; }

    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not authenticated."); return; }

    setAiError(null);
    setExtractState("uploading");

    try {
      // 1. Upload file to license-files bucket
      const ext  = aiFile.name.split(".").pop() ?? "pdf";
      const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKETS.licenseFiles)
        .upload(path, aiFile, { upsert: false });

      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);
      setAiStoragePath(path);

      // 2. Invoke the Gemini extraction edge function
      setExtractState("extracting");
      const { data: fnData, error: fnErr } = await supabase.functions.invoke(
        "extract-license-data",
        { body: { file_path: path } },
      );

      if (fnErr) throw new Error(fnErr.message);
      if (!fnData?.ok) throw new Error(fnData?.error ?? "Extraction failed — unknown error");

      // 3. Auto-fill form from extracted fields
      if (fnData.license_number)  setFormLicenseNumber(fnData.license_number);
      if (fnData.product_type)    setFormProductType(fnData.product_type);
      if (fnData.expiration_date) setFormExpDate(fnData.expiration_date);
      if (fnData.issue_date)      setFormIssueDate(fnData.issue_date);
      setFormFile(aiFile);         // keep reference so user knows which file was used
      setAiExtracted(true);
      setExtractState("done");

      toast.success("AI extraction complete — review the fields below.");
    } catch (err) {
      const msg = (err as Error).message;
      console.error("[extract-license]", msg);
      setAiError(msg);
      setExtractState("error");
    }
  }

  // ── Save (insert into DB) ──────────────────────────────────────────────────

  async function handleSave() {
    if (!formSupplierId)    { toast.error("Please select a supplier.");        return; }
    if (!formLicenseNumber) { toast.error("License Number is required.");      return; }
    if (!formExpDate)       { toast.error("Expiration Date is required.");     return; }
    if (!formIssueDate)     { toast.error("Issue Date is required.");          return; }

    setSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Determine storage path — either already uploaded (AI mode) or upload now (manual)
      let storagePath = aiStoragePath;
      let fileName    = aiFile?.name ?? null;

      if (!storagePath && formFile) {
        const ext  = formFile.name.split(".").pop() ?? "pdf";
        const path = `${user.id}/${Date.now()}_${formFile.name}`;
        const { error: storageErr } = await supabase.storage
          .from(STORAGE_BUCKETS.licenseFiles)
          .upload(path, formFile, { upsert: true });
        if (!storageErr) {
          storagePath = path;
          fileName    = formFile.name;
        }
      }

      const { error } = await supabase.from("import_licenses").insert({
        importer_id:     user.id,
        supplier_id:     formSupplierId,
        license_number:  formLicenseNumber.trim(),
        product_type:    formProductType.trim() || null,
        issue_date:      formIssueDate,
        expiration_date: formExpDate,
        storage_path:    storagePath,
        file_name:       fileName,
        file_size_bytes: formFile?.size ?? aiFile?.size ?? null,
      });

      if (error) throw error;

      toast.success("License saved successfully.");
      setDialogOpen(false);
      resetDialog();
      loadData();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to save license.");
    } finally {
      setSaving(false);
    }
  }

  // ── Derived: is the form ready to save? ────────────────────────────────────

  const canSave = !!formSupplierId && !!formLicenseNumber && !!formExpDate && !!formIssueDate;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout
      role="importer"
      title="Import Licenses"
      subtitle="Manage import licenses per supplier — AI extracts data from your PDF automatically"
    >
      {/* ── KPI row ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <KPICard label="Valid Licenses"  value={validCount}        icon={CheckCircle} color="text-green-600"  iconColor="text-green-600" />
        <KPICard label="Expiring Soon"   value={expiringSoonCount} icon={AlertTriangle} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Expired"         value={expiredCount}      icon={XCircle}     color="text-red-600"    iconColor="text-red-600" />
      </div>

      {/* ── Table card ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Licenses</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => { resetDialog(); setDialogOpen(true); }}>
              <Plus className="w-4 h-4" />
              Add License
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading licenses…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>License #</TableHead>
                    <TableHead>Product Type</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead className="text-center">Days Left</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>File</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {licenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No licenses yet — click &quot;Add License&quot; to upload your first one.
                      </TableCell>
                    </TableRow>
                  ) : licenses.map((lic) => (
                    <TableRow key={lic.id}>
                      <TableCell className="text-sm font-medium">
                        {suppliers.find((s) => s.id === lic.supplier_id)?.company_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{lic.license_number}</TableCell>
                      <TableCell className="text-sm text-gray-600 max-w-[160px] truncate">
                        {lic.product_type ?? <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                        {fmtDate(lic.issue_date)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                        {fmtDate(lic.expiration_date)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-sm font-medium ${
                          lic.days_remaining < 0   ? "text-red-600"
                          : lic.days_remaining <= 30 ? "text-yellow-600"
                          : "text-green-600"
                        }`}>
                          {lic.days_remaining < 0 ? "Expired" : `${lic.days_remaining}d`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`text-xs font-normal ${STATUS_STYLES[lic.license_status] ?? ""}`}>
                          {STATUS_LABELS[lic.license_status] ?? lic.license_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {lic.storage_path ? (
                          <Button
                            variant="ghost" size="sm"
                            className="text-blue-600 gap-1 h-auto py-1 px-2"
                            onClick={() => handleViewLicense(lic)}
                          >
                            <Eye className="w-3 h-3" />
                            <span className="text-xs">View</span>
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════
          ADD LICENSE DIALOG
         ═══════════════════════════════════════════════════════════════ */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => { if (!o && !saving) { setDialogOpen(false); resetDialog(); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Import License</DialogTitle>
            <DialogDescription>
              Upload your government-issued license. AI will extract the key fields automatically.
            </DialogDescription>
          </DialogHeader>

          {/* ── Mode tabs ─────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 -mx-1 mb-4">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                mode === "ai"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setMode("ai")}
            >
              <Sparkles className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" />
              AI Extract
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                mode === "manual"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setMode("manual")}
            >
              Manual Entry
            </button>
          </div>

          {/* ── AI mode: upload + extract ─────────────────────────────────── */}
          {mode === "ai" && extractState !== "done" && (
            <div className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              aiFile ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-gray-50/40"
            }`}>
              <FileText className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm font-medium text-gray-700 mb-1">
                {aiFile ? aiFile.name : "Drop your license PDF or image here"}
              </p>
              <p className="text-xs text-gray-400 mb-4">
                PDF, JPG, PNG — up to 20 MB
              </p>

              {!aiFile ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Choose File
                </Button>
              ) : (
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setAiFile(null); setExtractState("idle"); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Change
                  </Button>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                    onClick={handleExtract}
                    disabled={extractState === "uploading" || extractState === "extracting"}
                  >
                    {extractState === "uploading" ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Uploading…</>
                    ) : extractState === "extracting" ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Extracting…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" />Extract with AI</>
                    )}
                  </Button>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setAiFile(f);
                  setExtractState("idle");
                  setAiError(null);
                }}
              />

              {aiError && (
                <div className="mt-3 text-xs text-red-600 bg-red-50 rounded p-2 text-left">
                  <strong>Extraction failed:</strong> {aiError}
                  <br />
                  <button className="underline mt-1" onClick={() => setMode("manual")}>
                    Switch to Manual Entry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Form fields (shown after AI extracts OR in manual mode) ──── */}
          {(mode === "manual" || extractState === "done") && (
            <div className="space-y-4">

              {/* AI success banner */}
              {aiExtracted && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                  <span>Fields pre-filled by AI — review and edit before saving.</span>
                </div>
              )}

              {/* Supplier — always manual */}
              <div className="space-y-1.5">
                <Label>Supplier <span className="text-red-500">*</span></Label>
                <Select value={formSupplierId} onValueChange={setFormSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.company_name} — {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* License Number */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  License Number <span className="text-red-500">*</span>
                  {aiExtracted && formLicenseNumber && (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">AI</span>
                  )}
                </Label>
                <Input
                  placeholder="e.g. IL-2026-00123"
                  value={formLicenseNumber}
                  onChange={(e) => setFormLicenseNumber(e.target.value)}
                />
              </div>

              {/* Product Type */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Product / Commodity
                  {aiExtracted && formProductType && (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">AI</span>
                  )}
                </Label>
                <Input
                  placeholder="e.g. Fresh Citrus Fruits"
                  value={formProductType}
                  onChange={(e) => setFormProductType(e.target.value)}
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Issue Date <span className="text-red-500">*</span>
                    {aiExtracted && formIssueDate && (
                      <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">AI</span>
                    )}
                  </Label>
                  <Input
                    type="date"
                    value={formIssueDate}
                    onChange={(e) => setFormIssueDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    Expiration Date <span className="text-red-500">*</span>
                    {aiExtracted && formExpDate && (
                      <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">AI</span>
                    )}
                  </Label>
                  <Input
                    type="date"
                    value={formExpDate}
                    onChange={(e) => setFormExpDate(e.target.value)}
                  />
                </div>
              </div>

              {/* File upload (manual mode only — AI mode already uploaded it) */}
              {mode === "manual" && (
                <div className="space-y-1.5">
                  <Label>License File</Label>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.heic"
                    onChange={(e) => setFormFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-gray-400">Optional — PDF or image</p>
                </div>
              )}

              {/* Show which file was uploaded in AI mode */}
              {mode === "ai" && aiFile && (
                <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  {aiFile.name} ({(aiFile.size / 1024).toFixed(0)} KB) — already uploaded
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDialogOpen(false); resetDialog(); }}
              disabled={saving}
            >
              Cancel
            </Button>

            {/* Save button — only shown when form is visible */}
            {(mode === "manual" || extractState === "done") && (
              <Button onClick={handleSave} disabled={saving || !canSave}>
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" />Save License</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
