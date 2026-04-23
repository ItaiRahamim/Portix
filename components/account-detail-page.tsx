"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Upload, FileText, Loader2, CheckCircle, XCircle,
  CreditCard, Receipt, ReceiptText,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  getMyCompany, getCompanyTransactions,
  createTransaction, approveTransaction, rejectTransaction,
  uploadTransactionDocument,
} from "@/lib/db";
import type { Transaction, Company, TransactionType } from "@/lib/db";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

// ─── Status & type display helpers ───────────────────────────────────────────

const TXN_STATUS_STYLES: Record<string, string> = {
  active:           "bg-blue-100 text-blue-700",
  pending_approval: "bg-yellow-100 text-yellow-700",
  approved:         "bg-green-100 text-green-700",
  rejected:         "bg-red-100 text-red-700",
  voided:           "bg-gray-100 text-gray-500",
};

const TXN_STATUS_LABELS: Record<string, string> = {
  active:           "Active",
  pending_approval: "Pending Approval",
  approved:         "Approved",
  rejected:         "Rejected",
  voided:           "Voided",
};

const TXN_TYPE_LABELS: Record<string, string> = {
  invoice:     "Invoice",
  payment:     "Payment",
  credit_note: "Credit Note",
};

const TXN_TYPE_STYLES: Record<string, string> = {
  invoice:     "bg-slate-100 text-slate-700",
  payment:     "bg-teal-100 text-teal-700",
  credit_note: "bg-purple-100 text-purple-700",
};

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AccountDetailPage({ role }: AccountDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const counterpartCompanyId = params.accountId as string;

  const [myCompany, setMyCompany] = useState<Company | null>(null);
  const [counterpartCompany, setCounterpartCompany] = useState<Company | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Modal state ────────────────────────────────────────────────
  // Invoice modal
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invRef, setInvRef] = useState("");
  const [invAmount, setInvAmount] = useState("");
  const [invCurrency, setInvCurrency] = useState("USD");
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invDueDate, setInvDueDate] = useState("");
  const [invNotes, setInvNotes] = useState("");
  const [savingInv, setSavingInv] = useState(false);

  // Credit note modal
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditRef, setCreditRef] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditCurrency, setCreditCurrency] = useState("USD");
  const [creditNotes, setCreditNotes] = useState("");
  const [savingCredit, setSavingCredit] = useState(false);

  // Payment modal
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payCurrency, setPayCurrency] = useState("USD");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payParentId, setPayParentId] = useState<string | null>(null);
  const [savingPay, setSavingPay] = useState(false);

  // Approve/Reject dialog
  const [approveDialogTxn, setApproveDialogTxn] = useState<Transaction | null>(null);
  const [processingApproval, setProcessingApproval] = useState(false);

  // ── Data loading ───────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const my = await getMyCompany();
    if (!my) { setLoading(false); return; }
    setMyCompany(my);

    // Fetch counterpart company info + transactions in parallel
    const supabase = createBrowserSupabaseClient();
    const [{ data: cpData }, txns] = await Promise.all([
      supabase.from("companies").select("*").eq("id", counterpartCompanyId).single(),
      getCompanyTransactions(my.id, counterpartCompanyId),
    ]);

    setCounterpartCompany(cpData ?? null);
    setTransactions(txns);
    setLoading(false);
  }, [counterpartCompanyId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed balance ───────────────────────────────────────────
  const totalInvoiced = transactions
    .filter((t) => t.type === "invoice")
    .reduce((s, t) => s + t.amount, 0);
  const totalPaid = transactions
    .filter((t) => t.type === "payment" && t.status === "approved")
    .reduce((s, t) => s + t.amount, 0);
  const totalCredits = transactions
    .filter((t) => t.type === "credit_note" && !["voided", "rejected"].includes(t.status))
    .reduce((s, t) => s + t.amount, 0);
  const currentBalance = totalInvoiced - totalPaid - totalCredits;

  // ── Role capabilities ──────────────────────────────────────────
  // Supplier/broker creates invoices & credit notes; importer submits payments
  const amICreditor = role === "supplier"; // supplier = creditor perspective
  const amIDebtor   = role === "importer"; // importer = debtor perspective
  // For a given transaction, check if I am the creditor
  const iAmCreditorOf = (t: Transaction) => myCompany && t.creditor_company_id === myCompany.id;

  // ── Handlers ──────────────────────────────────────────────────

  const handleIssueInvoice = async () => {
    if (!invRef.trim() || !invAmount || !invDate || !myCompany) {
      toast.error("Fill in Invoice #, Amount, and Date.");
      return;
    }
    setSavingInv(true);
    try {
      const result = await createTransaction({
        type: "invoice",
        creditorCompanyId: myCompany.id,
        debtorCompanyId: counterpartCompanyId,
        amount: parseFloat(invAmount),
        currency: invCurrency,
        referenceNumber: invRef.trim() || undefined,
        notes: invNotes.trim() || undefined,
        transactionDate: invDate,
        dueDate: invDueDate || undefined,
      });
      if (!result) { toast.error("Failed to create invoice."); return; }
      toast.success("Invoice created.");
      setInvoiceOpen(false);
      setInvRef(""); setInvAmount(""); setInvDueDate(""); setInvNotes("");
      loadData();
    } finally { setSavingInv(false); }
  };

  const handleIssueCreditNote = async () => {
    if (!creditAmount || !myCompany) {
      toast.error("Enter the credit note amount.");
      return;
    }
    setSavingCredit(true);
    try {
      const result = await createTransaction({
        type: "credit_note",
        creditorCompanyId: myCompany.id,
        debtorCompanyId: counterpartCompanyId,
        amount: parseFloat(creditAmount),
        currency: creditCurrency,
        referenceNumber: creditRef.trim() || undefined,
        notes: creditNotes.trim() || undefined,
      });
      if (!result) { toast.error("Failed to create credit note."); return; }
      toast.success("Credit note issued.");
      setCreditOpen(false);
      setCreditRef(""); setCreditAmount(""); setCreditNotes("");
      loadData();
    } finally { setSavingCredit(false); }
  };

  const handleSubmitPayment = async () => {
    if (!payAmount || !myCompany) {
      toast.error("Enter the payment amount.");
      return;
    }
    setSavingPay(true);
    try {
      const result = await createTransaction({
        type: "payment",
        creditorCompanyId: counterpartCompanyId, // counterpart is the creditor
        debtorCompanyId: myCompany.id,
        amount: parseFloat(payAmount),
        currency: payCurrency,
        referenceNumber: payRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
        transactionDate: payDate,
        parentTransactionId: payParentId ?? undefined,
      });
      if (!result) { toast.error("Failed to submit payment."); return; }

      // If a proof file was selected, upload it now
      if (payFile && result.id) {
        const ok = await uploadTransactionDocument(result.id, payFile);
        if (!ok) toast.warning("Payment created but file upload failed — retry later.");
      }

      toast.success("Payment submitted. Awaiting counterpart approval.");
      setPaymentOpen(false);
      setPayAmount(""); setPayRef(""); setPayNotes(""); setPayFile(null); setPayParentId(null);
      loadData();
    } finally { setSavingPay(false); }
  };

  const handleApprove = async (txn: Transaction) => {
    setProcessingApproval(true);
    const ok = await approveTransaction(txn.id);
    if (ok) {
      toast.success("Payment approved. Balance updated.");
    } else {
      toast.error("Failed to approve payment.");
    }
    setApproveDialogTxn(null);
    setProcessingApproval(false);
    loadData();
  };

  const handleReject = async (txn: Transaction) => {
    setProcessingApproval(true);
    const ok = await rejectTransaction(txn.id);
    if (ok) {
      toast.success("Payment rejected.");
    } else {
      toast.error("Failed to reject payment.");
    }
    setApproveDialogTxn(null);
    setProcessingApproval(false);
    loadData();
  };

  const handleViewDoc = async (txn: Transaction) => {
    if (!txn.document_storage_path) return;
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.storage
      .from("swift-documents")
      .createSignedUrl(txn.document_storage_path, 3600);
    if (error || !data?.signedUrl) {
      toast.error("Could not generate download link.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  // ── Render guards ──────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout role={role} title="Account Ledger" subtitle="">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (!counterpartCompany) {
    return (
      <DashboardLayout role={role} title="Company Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Company account not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.back()}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <DashboardLayout
      role={role}
      title={counterpartCompany.name}
      subtitle="Transaction ledger and account balance"
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

      {/* Balance summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
            <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Approved Payments</p>
            <p className="text-lg font-semibold text-green-600">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Credit Notes</p>
            <p className="text-lg font-semibold text-blue-600">{formatCurrency(totalCredits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Current Balance</p>
            <p className={`text-lg font-semibold ${currentBalance > 0 ? "text-red-600" : currentBalance < 0 ? "text-green-600" : "text-gray-400"}`}>
              {formatCurrency(Math.abs(currentBalance))}
              {currentBalance < 0 && <span className="text-xs ml-1 font-normal">credit</span>}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transaction ledger */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Transaction Ledger</CardTitle>
            <div className="flex gap-2">
              {/* Creditor actions */}
              {amICreditor && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreditOpen(true)}>
                    <ReceiptText className="w-3.5 h-3.5" />
                    Credit Note
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => setInvoiceOpen(true)}>
                    <Receipt className="w-3.5 h-3.5" />
                    Issue Invoice
                  </Button>
                </>
              )}
              {/* Debtor actions */}
              {amIDebtor && (
                <Button size="sm" className="gap-1.5" onClick={() => { setPayParentId(null); setPaymentOpen(true); }}>
                  <CreditCard className="w-3.5 h-3.5" />
                  Submit Payment
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                      No transactions yet. {amICreditor ? "Issue an invoice to get started." : "Transactions will appear here once your supplier issues an invoice."}
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((txn) => {
                    const isPendingPayment = txn.type === "payment" && txn.status === "pending_approval";
                    const canApprove = isPendingPayment && iAmCreditorOf(txn);
                    const canPayAgainst = txn.type === "invoice" && txn.status === "active" && amIDebtor;

                    return (
                      <TableRow key={txn.id} className="text-sm">
                        <TableCell className="text-gray-500 whitespace-nowrap">
                          {formatDate(txn.transaction_date)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-xs font-normal ${TXN_TYPE_STYLES[txn.type] ?? "bg-gray-100"}`}
                          >
                            {TXN_TYPE_LABELS[txn.type] ?? txn.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-700">
                          {txn.reference_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-gray-500 max-w-[160px] truncate">
                          {txn.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {txn.type === "payment" || txn.type === "credit_note" ? (
                            <span className="text-green-600">− {formatCurrency(txn.amount, txn.currency)}</span>
                          ) : (
                            <span>{formatCurrency(txn.amount, txn.currency)}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-xs font-normal ${TXN_STATUS_STYLES[txn.status] ?? "bg-gray-100"}`}
                          >
                            {TXN_STATUS_LABELS[txn.status] ?? txn.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {txn.document_storage_path ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 gap-1 h-auto py-1 px-2"
                              onClick={() => handleViewDoc(txn)}
                            >
                              <FileText className="w-3 h-3" />
                              <span className="text-xs">View</span>
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {/* Creditor: approve/reject pending payments */}
                            {canApprove && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 border-green-200 hover:bg-green-50 h-7 px-2 text-xs gap-1"
                                onClick={() => setApproveDialogTxn(txn)}
                              >
                                <CheckCircle className="w-3 h-3" />
                                Review
                              </Button>
                            )}
                            {/* Debtor: pay against an invoice */}
                            {canPayAgainst && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => {
                                  setPayParentId(txn.id);
                                  setPayAmount(String(txn.amount));
                                  setPayCurrency(txn.currency);
                                  setPaymentOpen(true);
                                }}
                              >
                                <CreditCard className="w-3 h-3" />
                                Pay
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Issue Invoice Modal ─────────────────────────────────── */}
      <Dialog open={invoiceOpen} onOpenChange={(o) => { if (!o && !savingInv) setInvoiceOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Invoice</DialogTitle>
            <DialogDescription>
              Create a new invoice for <strong>{counterpartCompany.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Invoice Number <span className="text-red-500">*</span></Label>
              <Input placeholder="e.g. INV-2026-001" value={invRef} onChange={(e) => setInvRef(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount <span className="text-red-500">*</span></Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={invCurrency} onValueChange={setInvCurrency}>
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
                <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={invDueDate} onChange={(e) => setInvDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes…" value={invNotes} onChange={(e) => setInvNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)} disabled={savingInv}>Cancel</Button>
            <Button onClick={handleIssueInvoice} disabled={savingInv}>
              {savingInv ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : <>
                <Receipt className="w-4 h-4 mr-2" />Create Invoice
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Issue Credit Note Modal ─────────────────────────────── */}
      <Dialog open={creditOpen} onOpenChange={(o) => { if (!o && !savingCredit) setCreditOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Credit Note</DialogTitle>
            <DialogDescription>
              Immediately reduces the outstanding balance for <strong>{counterpartCompany.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reference Number</Label>
              <Input placeholder="e.g. CN-2026-001" value={creditRef} onChange={(e) => setCreditRef(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount <span className="text-red-500">*</span></Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={creditCurrency} onValueChange={setCreditCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="ILS">ILS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Reason for credit note…" value={creditNotes} onChange={(e) => setCreditNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)} disabled={savingCredit}>Cancel</Button>
            <Button onClick={handleIssueCreditNote} disabled={savingCredit}>
              {savingCredit ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Issuing…</> : <>
                <ReceiptText className="w-4 h-4 mr-2" />Issue Credit Note
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Submit Payment Modal ────────────────────────────────── */}
      <Dialog open={paymentOpen} onOpenChange={(o) => { if (!o && !savingPay) { setPaymentOpen(false); setPayFile(null); setPayParentId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Payment</DialogTitle>
            <DialogDescription>
              Submit a payment to <strong>{counterpartCompany.name}</strong>. It will be marked as pending until they approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {payParentId && (
              <div className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Linked to invoice — amount pre-filled.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount <span className="text-red-500">*</span></Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={payCurrency} onValueChange={setPayCurrency}>
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
                <Label>Payment Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reference / SWIFT Ref</Label>
                <Input placeholder="Optional" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes…" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Proof (optional)</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
              {payFile && (
                <p className="text-xs text-gray-500">{payFile.name} ({(payFile.size / 1024).toFixed(1)} KB)</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPaymentOpen(false); setPayFile(null); setPayParentId(null); }} disabled={savingPay}>
              Cancel
            </Button>
            <Button onClick={handleSubmitPayment} disabled={savingPay}>
              {savingPay ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : <>
                <Upload className="w-4 h-4 mr-2" />Submit Payment
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Approve / Reject Dialog ─────────────────────────────── */}
      <Dialog
        open={!!approveDialogTxn}
        onOpenChange={(o) => { if (!o && !processingApproval) setApproveDialogTxn(null); }}
      >
        {approveDialogTxn && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Review Payment</DialogTitle>
              <DialogDescription>
                {formatCurrency(approveDialogTxn.amount, approveDialogTxn.currency)} submitted by{" "}
                <strong>{counterpartCompany.name}</strong> on{" "}
                {formatDate(approveDialogTxn.transaction_date)}.
                {approveDialogTxn.reference_number && ` Ref: ${approveDialogTxn.reference_number}.`}
              </DialogDescription>
            </DialogHeader>
            {approveDialogTxn.document_storage_path && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => handleViewDoc(approveDialogTxn)}
              >
                <FileText className="w-4 h-4" />
                View Payment Proof
              </Button>
            )}
            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => handleReject(approveDialogTxn)}
                disabled={processingApproval}
              >
                {processingApproval ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4 mr-1" />Reject</>}
              </Button>
              <Button
                className="flex-1"
                onClick={() => handleApprove(approveDialogTxn)}
                disabled={processingApproval}
              >
                {processingApproval ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-1" />Approve</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </DashboardLayout>
  );
}
