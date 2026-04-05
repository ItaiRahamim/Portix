"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, Eye, Upload, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { getImportLicenses, getAccountProfiles } from "@/lib/db";
import type { ImportLicenseView, Profile } from "@/lib/supabase";
import { createBrowserSupabaseClient, STORAGE_BUCKETS } from "@/lib/supabase";
import { toast } from "sonner";

const statusStyles: Record<string, string> = {
  valid: "bg-green-100 text-green-700",
  expiring_soon: "bg-yellow-100 text-yellow-700",
  expired: "bg-red-100 text-red-700",
};
const statusLabels: Record<string, string> = {
  valid: "Valid",
  expiring_soon: "Expiring Soon",
  expired: "Expired",
};

export default function ImporterLicensesPage() {
  const [licenses, setLicenses] = useState<ImportLicenseView[]>([]);
  const [suppliers, setSuppliers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // Add license form state
  const [formSupplierId, setFormSupplierId] = useState("");
  const [formLicenseNumber, setFormLicenseNumber] = useState("");
  const [formIssueDate, setFormIssueDate] = useState("");
  const [formExpDate, setFormExpDate] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

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

  const validCount = licenses.filter((l) => l.license_status === "valid").length;
  const expiringSoonCount = licenses.filter((l) => l.license_status === "expiring_soon").length;
  const expiredCount = licenses.filter((l) => l.license_status === "expired").length;

  async function handleAddLicense() {
    if (!formSupplierId || !formLicenseNumber || !formIssueDate || !formExpDate) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let storagePath = null;
      let fileName = null;

      if (formFile) {
        const path = `${user.id}/${Date.now()}_${formFile.name}`;
        const { error: storageErr } = await supabase.storage
          .from(STORAGE_BUCKETS.licenseFiles)
          .upload(path, formFile, { upsert: true });
        if (!storageErr) {
          storagePath = path;
          fileName = formFile.name;
        }
      }

      const { error } = await supabase.from("import_licenses").insert({
        importer_id: user.id,
        supplier_id: formSupplierId,
        license_number: formLicenseNumber,
        issue_date: formIssueDate,
        expiration_date: formExpDate,
        storage_path: storagePath,
        file_name: fileName,
      });

      if (error) throw error;

      toast.success("License added successfully.");
      setCreateOpen(false);
      setFormSupplierId("");
      setFormLicenseNumber("");
      setFormIssueDate("");
      setFormExpDate("");
      setFormFile(null);
      loadData();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to add license.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout
      role="importer"
      title="Import Licenses"
      subtitle="Manage import licenses per supplier and track expiration dates"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <KPICard label="Valid Licenses" value={validCount} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
        <KPICard label="Expiring Soon" value={expiringSoonCount} icon={AlertTriangle} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Expired" value={expiredCount} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Licenses</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />Add License
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
                    <TableHead>License Number</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Expiration Date</TableHead>
                    <TableHead className="text-center">Days Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {licenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No licenses found
                      </TableCell>
                    </TableRow>
                  ) : licenses.map((lic) => (
                    <TableRow key={lic.id}>
                      <TableCell className="text-sm">
                        {suppliers.find((s) => s.id === lic.supplier_id)?.company_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{lic.license_number}</TableCell>
                      <TableCell>
                        {lic.file_name ? (
                          <Button variant="ghost" size="sm" className="text-blue-600 gap-1 h-auto py-1 px-2">
                            <Eye className="w-3 h-3" />
                            <span className="text-xs truncate max-w-[120px]">{lic.file_name}</span>
                          </Button>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(lic.issue_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(lic.expiration_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-sm ${
                          lic.days_remaining < 0 ? "text-red-600"
                          : lic.days_remaining <= 30 ? "text-yellow-600"
                          : "text-green-600"
                        }`}>
                          {lic.days_remaining < 0 ? "Expired" : `${lic.days_remaining}d`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${statusStyles[lic.license_status] ?? ""}`}>
                          {statusLabels[lic.license_status] ?? lic.license_status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          <Eye className="w-3.5 h-3.5 mr-1" />View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add License Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Import License</DialogTitle>
            <DialogDescription>Upload a new import license for a supplier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier <span className="text-red-500">*</span></Label>
              <Select value={formSupplierId} onValueChange={setFormSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name} — {s.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>License Number <span className="text-red-500">*</span></Label>
              <Input
                placeholder="e.g. LIC-2026-005"
                value={formLicenseNumber}
                onChange={(e) => setFormLicenseNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>License File</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setFormFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Issue Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={formIssueDate} onChange={(e) => setFormIssueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiration Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={formExpDate} onChange={(e) => setFormExpDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddLicense} disabled={saving}>
              <Upload className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Add License"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
