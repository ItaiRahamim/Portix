"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Upload, Eye, FileText, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  getProfileById, getInvoicesByAccount, getCurrentProfile,
} from "@/lib/db";
import type { Profile, Invoice } from "@/lib/supabase";
import { createBrowserSupabaseClient, STORAGE_BUCKETS } from "@/lib/supabase";
import { toast } from "sonner";

interface AccountDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

const STATUS_STYLES: Record<string, string> = {
  unpaid: "bg-red-100 text-red-700",
  partially_paid: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function AccountDetailPage({ role }: AccountDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const accountId = params.accountId as string;

  const [account, setAccount] = useState<Profile | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload Invoice modal state
  const [uploadInvoiceOpen, setUploadInvoiceOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceCurrency, setInvoiceCurrency] = useState("USD");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [savingInvoice, setSavingInvoice] = useState(false);

  // Upload SWIFT modal state
  const [uploadSwiftOpen, setUploadSwiftOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [swiftFile, setSwiftFile] = useState<File | null>(null);
  const [savingSwift, setSavingSwift] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [profile, invList] = await Promise.all([
      getProfileById(accountId),
      getInvoicesByAccount(accountId),
    ]);
    setAccount(profile);
    setInvoices(invList);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed account summary ──────────────────────────────────
  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0);
  const paidAmount = invoices.reduce((s, i) => s + i.paid_amount, 0);
  const remainingBalance = totalAmount - paidAmount;

  // ── Upload Invoice ─────────────────────────────────────────────
  const handleUploadInvoice = async () => {
    if (!invoiceNumber.trim() || !invoiceAmount || !invoiceDate) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSavingInvoice(true);
    try {
      const currentProfile = await getCurrentProfile();
      if (!currentProfile) {
        toast.error("Not authenticated.");
        return;
      }

      const importerId = role === "importer" ? currentProfile.id : accountId;
      const supplierId = role === "supplier" ? currentProfile.id : accountId;

      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.from("invoices").insert({
        invoice_number: invoiceNumber.trim(),
        importer_id: importerId,
        supplier_id: supplierId,
        amount: parseFloat(invoiceAmount),
        paid_amount: 0,
        currency: invoiceCurrency,
        status: "unpaid",
        invoice_date: invoiceDate,
        due_date: invoiceDueDate || null,
      });

      if (error) {
        toast.error("Failed to create invoice: " + error.message);
        return;
      }

      toast.success("Invoice created successfully.");
      setUploadInvoiceOpen(false);
      setInvoiceNumber("");
      setInvoiceAmount("");
      setInvoiceDate("");
      setInvoiceDueDate("");
      setInvoiceCurrency("USD");
      loadData();
    } finally {
      setSavingInvoice(false);
    }
  };

  // ── Upload SWIFT ───────────────────────────────────────────────
  const handleUploadSwift = async () => {
    if (!swiftFile || !selectedInvoiceId) {
      toast.error("Please select a file.");
      return;
    }

    setSavingSwift(true);
    try {
      const supabase = createBrowserSupabaseClient();

      const ext = swiftFile.name.split(".").pop();
      const storagePath = `${selectedInvoiceId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.swiftDocuments)
        .upload(storagePath, swiftFile, { upsert: true });

      if (uploadError) {
        toast.error("Failed to upload file: " + uploadError.message);
        return;
      }

      const { error: updateError } = await supabase
        .from("invoices")
        .update({
          swift_storage_path: storagePath,
          swift_file_name: swiftFile.name,
        })
        .eq("id", selectedInvoiceId);

      if (updateError) {
        toast.error("Failed to link SWIFT document: " + updateError.message);
        return;
      }

      toast.success("SWIFT document uploaded successfully.");
      setUploadSwiftOpen(false);
      setSwiftFile(null);
      setSelectedInvoiceId(null);
      loadData();
    } finally {
      setSavingSwift(false);
    }
  };

  // ── View SWIFT document (signed URL) ──────────────────────────
  const handleViewSwift = async (invoice: Invoice) => {
    if (!invoice.swift_storage_path) return;
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.swiftDocuments)
      .createSignedUrl(invoice.swift_storage_path, 3600);

    if (error || !data?.signedUrl) {
      toast.error("Failed to generate view link.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  if (loading) {
    return (
      <DashboardLayout role={role} title="Account" subtitle="">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (!account) {
    return (
      <DashboardLayout role={role} title="Account Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Account not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.back()}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      role={role}
      title={account.company_name || account.full_name}
      subtitle="Invoice management and payment tracking"
    >
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-1.5"
        onClick={() => router.push(`/${role}/accounts`)}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Accounts
      </Button>

      {/* Account Summary */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Account Name</p>
              <p className="mt-0.5 font-medium">{account.company_name || account.full_name}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Total Invoices</p>
              <p className="mt-0.5">{invoices.length}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Total Amount</p>
              <p className="mt-0.5">${totalAmount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Paid Amount</p>
              <p className="mt-0.5 text-green-600">${paidAmount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Remaining Balance</p>
              <p className={`mt-0.5 ${remainingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                ${remainingBalance.toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Invoices</CardTitle>
            {(role === "importer" || role === "supplier") && (
              <Button size="sm" className="gap-1.5" onClick={() => setUploadInvoiceOpen(true)}>
                <Upload className="w-4 h-4" />
                New Invoice
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SWIFT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-gray-400">
                      No invoices found
                    </TableCell>
                  </TableRow>
                ) : invoices.map((inv) => {
                  const remaining = inv.amount - inv.paid_amount;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="text-sm font-medium">{inv.invoice_number}</TableCell>
                      <TableCell className="text-sm text-gray-500">{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {inv.currency} {inv.amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-sm text-green-600">
                        {inv.currency} {inv.paid_amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {remaining > 0 ? (
                          <span className="text-red-600">{inv.currency} {remaining.toLocaleString()}</span>
                        ) : (
                          <span className="text-green-600">$0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABELS[inv.status] ?? inv.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {inv.swift_storage_path ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600 gap-1 h-auto py-1 px-2"
                            onClick={() => handleViewSwift(inv)}
                          >
                            <FileText className="w-3 h-3" />
                            <span className="text-xs">View</span>
                          </Button>
                        ) : role === "importer" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-500 gap-1 h-auto py-1 px-2"
                            onClick={() => {
                              setSelectedInvoiceId(inv.id);
                              setUploadSwiftOpen(true);
                            }}
                          >
                            <Upload className="w-3 h-3" />
                            <span className="text-xs">Upload</span>
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* New Invoice Modal */}
      <Dialog open={uploadInvoiceOpen} onOpenChange={(o) => { if (!o && !savingInvoice) setUploadInvoiceOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Create a new invoice for this account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Invoice Number <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. INV-2026-001"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Amount <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={invoiceCurrency} onValueChange={setInvoiceCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="ILS">ILS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Date <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={invoiceDueDate}
                  onChange={(e) => setInvoiceDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadInvoiceOpen(false)} disabled={savingInvoice}>Cancel</Button>
            <Button onClick={handleUploadInvoice} disabled={savingInvoice}>
              {savingInvoice ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
              ) : (
                <><Eye className="w-4 h-4 mr-2" />Create Invoice</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload SWIFT Modal */}
      <Dialog open={uploadSwiftOpen} onOpenChange={(o) => { if (!o && !savingSwift) { setUploadSwiftOpen(false); setSwiftFile(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload SWIFT Confirmation</DialogTitle>
            <DialogDescription>Upload the SWIFT payment confirmation document.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>SWIFT Document <span className="text-red-500">*</span></Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setSwiftFile(e.target.files?.[0] ?? null)}
              />
              {swiftFile && (
                <p className="text-xs text-gray-500">{swiftFile.name} ({(swiftFile.size / 1024).toFixed(1)} KB)</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadSwiftOpen(false); setSwiftFile(null); }} disabled={savingSwift}>
              Cancel
            </Button>
            <Button onClick={handleUploadSwift} disabled={savingSwift || !swiftFile}>
              {savingSwift ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" />Upload</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
