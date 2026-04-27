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
  ArrowLeft, FileText, Loader2, CheckCircle, XCircle,
  CreditCard, Receipt, ReceiptText, Paperclip, Clock,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  getPartnerTransactions,
  createAccountTransaction,
  approveAccountTransaction,
  rejectAccountTransaction,
} from "@/lib/db";
import type { AccountTransaction } from "@/lib/db";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

// ─── Display helpers ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft:    "bg-amber-100 text-amber-700",
  pending:  "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<string, string> = {
  draft:    "Draft",
  pending:  "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

const TYPE_STYLES: Record<string, string> = {
  invoice: "bg-slate-100 text-slate-700",
  payment: "bg-teal-100 text-teal-700",
  credit:  "bg-purple-100 text-purple-700",
};
const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit:  "Credit Note",
};

function fmt(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ─── Upload helper (upload-first flow) ───────────────────────────────────────

async function uploadToSwiftBucket(file: File): Promise<string | null> {
  const supabase = createBrowserSupabaseClient();
  const ext = file.name.split(".").pop() ?? "pdf";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage
    .from("swift-documents")
    .upload(path, file, { upsert: false });
  if (error) {
    console.error("[uploadToSwiftBucket]", error.message);
    return null;
  }
  return path;
}

// ─── Required file input sub-component ───────────────────────────────────────

function FileField({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <Paperclip className="w-3.5 h-3.5 text-gray-400" />
        Document <span className="text-red-500">*</span>
      </Label>
      <Input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <p className="text-xs text-green-600">✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
      ) : (
        <p className="text-xs text-gray-400">PDF or image required — upload before submitting</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AccountDetailPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

export function AccountDetailPage({ role }: AccountDetailPageProps) {
  const params = useParams();
  const router = useRouter();

  // URL param is now a UUID (partner's representative profile ID)
  const partnerId = params.accountId as string;

  const [myCompanyName, setMyCompanyName] = useState<string | null>(null);
  const [myUserIds, setMyUserIds] = useState<string[]>([]);
  const [partnerDisplayName, setPartnerDisplayName] = useState<string>("");
  const [partnerUserIds, setPartnerUserIds] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Role capabilities
  // Supplier + Customs-Agent = creditors (issue invoices / credits, approve payments)
  // Importer = debtor (submits payment proofs)
  const amICreditor = role === "supplier" || role === "customs-agent";
  const amIDebtor   = role === "importer";

  // UUID sets used for balance splitting and uploader detection
  const myUserIdSet = new Set(myUserIds);
  const partnerUserIdSet = new Set(partnerUserIds);

  // ── Modal state: Invoice ───────────────────────────────────────
  const [invOpen, setInvOpen] = useState(false);
  const [invRef, setInvRef] = useState("");
  const [invAmt, setInvAmt] = useState("");
  const [invCur, setInvCur] = useState("USD");
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invDue, setInvDue] = useState("");
  const [invNotes, setInvNotes] = useState("");
  const [invFile, setInvFile] = useState<File | null>(null);
  const [savingInv, setSavingInv] = useState(false);

  // ── Modal state: Credit Note ───────────────────────────────────
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditRef, setCreditRef] = useState("");
  const [creditAmt, setCreditAmt] = useState("");
  const [creditCur, setCreditCur] = useState("USD");
  const [creditNotes, setCreditNotes] = useState("");
  const [creditFile, setCreditFile] = useState<File | null>(null);
  const [savingCredit, setSavingCredit] = useState(false);

  // ── Modal state: Payment ───────────────────────────────────────
  const [payOpen, setPayOpen] = useState(false);
  const [payAmt, setPayAmt] = useState("");
  const [payCur, setPayCur] = useState("USD");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [savingPay, setSavingPay] = useState(false);

  // ── Approve / Reject dialog ────────────────────────────────────
  const [reviewTxn, setReviewTxn] = useState<AccountTransaction | null>(null);
  const [processingReview, setProcessingReview] = useState(false);

  // ── Data loading ───────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createBrowserSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Fetch my profile and partner profile in parallel
    const [{ data: myProfile }, { data: partnerProfile }] = await Promise.all([
      supabase.from('profiles').select('company_name').eq('id', user.id).single(),
      supabase.from('profiles').select('company_name').eq('id', partnerId).single(),
    ]);

    const myName = myProfile?.company_name ?? null;
    const partnerName = partnerProfile?.company_name ?? "";
    setMyCompanyName(myName);
    setPartnerDisplayName(partnerName);

    if (!myName || !partnerName) { setLoading(false); return; }

    // Resolve all user IDs for both companies in parallel
    const [{ data: myUsersData }, { data: partnerUsersData }] = await Promise.all([
      supabase.from('profiles').select('id').eq('company_name', myName),
      supabase.from('profiles').select('id').eq('company_name', partnerName),
    ]);

    const resolvedMyUserIds = (myUsersData ?? []).map((u: { id: string }) => u.id);
    const resolvedPartnerUserIds = (partnerUsersData ?? []).map((u: { id: string }) => u.id);
    setMyUserIds(resolvedMyUserIds);
    setPartnerUserIds(resolvedPartnerUserIds);

    const txns = await getPartnerTransactions(
      resolvedMyUserIds, myName, resolvedPartnerUserIds, partnerName
    );
    setTransactions(txns);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Balance computed from transactions ─────────────────────────
  const myTxns    = transactions.filter((t) => myUserIdSet.has(t.uploader_user_id));
  const theirTxns = transactions.filter((t) => partnerUserIdSet.has(t.uploader_user_id));

  const invoicesIssued   = myTxns.filter((t) => t.type === "invoice").reduce((s, t) => s + t.amount, 0);
  const invoicesOwed     = theirTxns.filter((t) => t.type === "invoice").reduce((s, t) => s + t.amount, 0);
  const paymentsReceived = theirTxns.filter((t) => t.type === "payment" && t.status === "approved").reduce((s, t) => s + t.amount, 0);
  const paymentsMade     = myTxns.filter((t) => t.type === "payment" && t.status === "approved").reduce((s, t) => s + t.amount, 0);
  const creditsIssued    = myTxns.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const creditsReceived  = theirTxns.filter((t) => t.type === "credit").reduce((s, t) => s + t.amount, 0);

  // Net from my perspective: positive = they owe me
  const netBalance = invoicesIssued - paymentsReceived - creditsIssued - invoicesOwed + paymentsMade + creditsReceived;

  // Draft transactions — auto-created from commercial_invoice uploads
  const drafts = transactions.filter((t) => t.status === "draft");

  // ── Reset helpers ──────────────────────────────────────────────

  function resetInv()    { setInvRef(""); setInvAmt(""); setInvDue(""); setInvNotes(""); setInvFile(null); setInvDate(new Date().toISOString().slice(0, 10)); }
  function resetCredit() { setCreditRef(""); setCreditAmt(""); setCreditNotes(""); setCreditFile(null); }
  function resetPay()    { setPayAmt(""); setPayRef(""); setPayNotes(""); setPayFile(null); setPayDate(new Date().toISOString().slice(0, 10)); }

  // ── Handlers ──────────────────────────────────────────────────

  async function handleUploadInvoice() {
    if (!invFile) { toast.error("Please attach the invoice document."); return; }
    if (!invRef.trim() || !invAmt) { toast.error("Invoice # and Amount are required."); return; }
    if (!myCompanyName) return;

    setSavingInv(true);
    try {
      const storagePath = await uploadToSwiftBucket(invFile);
      if (!storagePath) { toast.error("File upload failed. Please try again."); return; }

      const result = await createAccountTransaction({
        myCompanyName,
        partnerCompanyName: partnerDisplayName,
        targetProfileId: partnerId,
        type: "invoice",
        amount: parseFloat(invAmt),
        currency: invCur,
        referenceNumber: invRef.trim(),
        notes: invNotes.trim() || undefined,
        transactionDate: invDate,
        dueDate: invDue || undefined,
        documentStoragePath: storagePath,
        documentFileName: invFile.name,
      });

      if (!result) { toast.error("Failed to create invoice."); return; }
      toast.success("Invoice uploaded successfully.");
      setInvOpen(false);
      resetInv();
      loadData();
    } finally { setSavingInv(false); }
  }

  async function handleUploadCreditNote() {
    if (!creditFile) { toast.error("Please attach the credit note document."); return; }
    if (!creditAmt) { toast.error("Amount is required."); return; }
    if (!myCompanyName) return;

    setSavingCredit(true);
    try {
      const storagePath = await uploadToSwiftBucket(creditFile);
      if (!storagePath) { toast.error("File upload failed. Please try again."); return; }

      const result = await createAccountTransaction({
        myCompanyName,
        partnerCompanyName: partnerDisplayName,
        targetProfileId: partnerId,
        type: "credit",
        amount: parseFloat(creditAmt),
        currency: creditCur,
        referenceNumber: creditRef.trim() || undefined,
        notes: creditNotes.trim() || undefined,
        documentStoragePath: storagePath,
        documentFileName: creditFile.name,
      });

      if (!result) { toast.error("Failed to create credit note."); return; }
      toast.success("Credit note issued.");
      setCreditOpen(false);
      resetCredit();
      loadData();
    } finally { setSavingCredit(false); }
  }

  async function handleUploadPayment() {
    if (!payFile) { toast.error("Please attach your payment proof."); return; }
    if (!payAmt) { toast.error("Amount is required."); return; }
    if (!myCompanyName) return;

    setSavingPay(true);
    try {
      const storagePath = await uploadToSwiftBucket(payFile);
      if (!storagePath) { toast.error("File upload failed. Please try again."); return; }

      const result = await createAccountTransaction({
        myCompanyName,
        partnerCompanyName: partnerDisplayName,
        targetProfileId: partnerId,
        type: "payment",
        amount: parseFloat(payAmt),
        currency: payCur,
        referenceNumber: payRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
        transactionDate: payDate,
        documentStoragePath: storagePath,
        documentFileName: payFile.name,
      });

      if (!result) { toast.error("Failed to submit payment."); return; }
      toast.success("Payment submitted and proof uploaded. Awaiting approval.");
      setPayOpen(false);
      resetPay();
      loadData();
    } finally { setSavingPay(false); }
  }

  async function handleApprove(txn: AccountTransaction) {
    setProcessingReview(true);
    const ok = await approveAccountTransaction(txn.id);
    if (ok) toast.success("Payment approved — balance updated.");
    else toast.error("Approval failed.");
    setReviewTxn(null);
    setProcessingReview(false);
    loadData();
  }

  async function handleReject(txn: AccountTransaction) {
    setProcessingReview(true);
    const ok = await rejectAccountTransaction(txn.id);
    if (ok) toast.success("Payment rejected.");
    else toast.error("Rejection failed.");
    setReviewTxn(null);
    setProcessingReview(false);
    loadData();
  }

  async function handleApproveDraft(txn: AccountTransaction) {
    const ok = await approveAccountTransaction(txn.id);
    if (ok) toast.success("Draft approved — invoice added to ledger.");
    else toast.error("Approval failed.");
    loadData();
  }

  async function handleViewDraftDoc(txn: AccountTransaction) {
    if (!txn.document_storage_path) return;
    const supabase = createBrowserSupabaseClient();
    // Drafts are auto-created from document uploads → always in 'documents' bucket
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(txn.document_storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Could not generate download link."); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function handleViewDoc(txn: AccountTransaction) {
    if (!txn.document_storage_path) return;
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.storage
      .from("swift-documents")
      .createSignedUrl(txn.document_storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Could not generate download link."); return; }
    window.open(data.signedUrl, "_blank");
  }

  // ── Loading guard ──────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout role={role} title="Account Ledger" subtitle="">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  const currencies = ["USD", "EUR", "GBP", "ILS"];

  return (
    <DashboardLayout
      role={role}
      title={partnerDisplayName}
      subtitle="Transaction ledger — invoices, payments, and credit notes"
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

      {/* ── Pending Drafts ────────────────────────────────────── */}
      {drafts.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Drafts
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-medium w-5 h-5">
                {drafts.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between gap-4 bg-white rounded-lg border border-amber-100 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{fmt(draft.amount, draft.currency)}</p>
                    <p className="text-xs text-gray-500 truncate">
                      Auto-extracted · {draft.document_file_name ?? "commercial invoice"} · {fmtDate(draft.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {draft.document_storage_path && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleViewDraftDoc(draft)}
                    >
                      <FileText className="w-3 h-3" />
                      View Doc
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs gap-1 bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={() => handleApproveDraft(draft)}
                  >
                    <CheckCircle className="w-3 h-3" />
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Balance summary ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Invoiced",    value: fmt(invoicesIssued + invoicesOwed), color: "" },
          { label: "Approved Payments", value: fmt(paymentsReceived + paymentsMade), color: "text-green-600" },
          { label: "Credits Issued",    value: fmt(creditsIssued + creditsReceived), color: "text-blue-600" },
          (() => {
            const totalPayments = paymentsReceived + paymentsMade + creditsIssued + creditsReceived;
            const totalInvoices = invoicesIssued + invoicesOwed;
            const isCredit = totalPayments > totalInvoices + 0.005;
            return {
              label: "Net Balance",
              value: Math.abs(netBalance) <= 0.005
                ? fmt(0)
                : isCredit
                ? `${fmt(Math.abs(netBalance))} credit`
                : netBalance > 0
                ? `${fmt(netBalance)} owed to you`
                : `${fmt(Math.abs(netBalance))} you owe`,
              color: Math.abs(netBalance) <= 0.005
                ? "text-gray-400"
                : isCredit
                ? "text-emerald-600"
                : "text-red-600",
            };
          })(),
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-lg font-semibold ${color || "text-gray-900"}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Transaction ledger ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Transaction Ledger</CardTitle>
            <div className="flex gap-2">
              {amICreditor && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreditOpen(true)}>
                    <ReceiptText className="w-3.5 h-3.5" />
                    Credit Note
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => setInvOpen(true)}>
                    <Receipt className="w-3.5 h-3.5" />
                    Upload Invoice
                  </Button>
                </>
              )}
              {amIDebtor && (
                <Button size="sm" className="gap-1.5" onClick={() => { resetPay(); setPayOpen(true); }}>
                  <CreditCard className="w-3.5 h-3.5" />
                  Upload Payment Proof
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
                  <TableHead>Uploaded by</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Doc</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-sm text-gray-400">
                      {amICreditor
                        ? "No transactions yet — click \"Upload Invoice\" to create the first one."
                        : "No transactions yet — invoices will appear here once your supplier uploads them."}
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((txn) => {
                    const uploaderIsMe = myUserIdSet.has(txn.uploader_user_id);
                    const isPendingPayment = txn.type === "payment" && txn.status === "pending";
                    // Creditor can approve payments that were submitted TO them by the partner
                    const canReview = isPendingPayment && amICreditor && !uploaderIsMe;

                    return (
                      <TableRow key={txn.id} className="text-sm">
                        <TableCell className="text-gray-500 whitespace-nowrap">
                          {fmtDate(txn.transaction_date)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`text-xs font-normal ${TYPE_STYLES[txn.type] ?? "bg-gray-100"}`}>
                            {TYPE_LABELS[txn.type] ?? txn.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {uploaderIsMe ? "You" : partnerDisplayName}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-700">
                          {txn.reference_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-gray-700 whitespace-nowrap font-mono">
                          {txn.container?.container_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {txn.type === "payment" || txn.type === "credit" ? (
                            <span className="text-green-600">− {fmt(txn.amount, txn.currency)}</span>
                          ) : (
                            fmt(txn.amount, txn.currency)
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`text-xs font-normal ${STATUS_STYLES[txn.status] ?? "bg-gray-100"}`}>
                            {STATUS_LABELS[txn.status] ?? txn.status}
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
                          ) : txn.container_id ? (
                            <a
                              href={`/${role}/containers/${txn.container_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 hover:underline py-1 px-2"
                            >
                              <FileText className="w-3 h-3" />
                              View
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {canReview && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 border-green-200 hover:bg-green-50 h-7 px-2 text-xs gap-1"
                              onClick={() => setReviewTxn(txn)}
                            >
                              <CheckCircle className="w-3 h-3" />
                              Review
                            </Button>
                          )}
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

      {/* ═══════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════ */}

      {/* Upload Invoice */}
      <Dialog open={invOpen} onOpenChange={(o) => { if (!o && !savingInv) { setInvOpen(false); resetInv(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Invoice</DialogTitle>
            <DialogDescription>
              Issue an invoice to <strong>{partnerDisplayName}</strong>.
              All fields marked <span className="text-red-500">*</span> are required.
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
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={invAmt} onChange={(e) => setInvAmt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={invCur} onValueChange={setInvCur}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={invDue} onChange={(e) => setInvDue(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional…" value={invNotes} onChange={(e) => setInvNotes(e.target.value)} />
            </div>
            <FileField file={invFile} onChange={setInvFile} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInvOpen(false); resetInv(); }} disabled={savingInv}>Cancel</Button>
            <Button onClick={handleUploadInvoice} disabled={savingInv || !invFile}>
              {savingInv ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading…</> : <><Receipt className="w-4 h-4 mr-2" />Create Invoice</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue Credit Note */}
      <Dialog open={creditOpen} onOpenChange={(o) => { if (!o && !savingCredit) { setCreditOpen(false); resetCredit(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Credit Note</DialogTitle>
            <DialogDescription>
              Immediately reduces the outstanding balance for <strong>{partnerDisplayName}</strong>.
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
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={creditCur} onValueChange={setCreditCur}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Reason for credit…" value={creditNotes} onChange={(e) => setCreditNotes(e.target.value)} />
            </div>
            <FileField file={creditFile} onChange={setCreditFile} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreditOpen(false); resetCredit(); }} disabled={savingCredit}>Cancel</Button>
            <Button onClick={handleUploadCreditNote} disabled={savingCredit || !creditFile}>
              {savingCredit ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Issuing…</> : <><ReceiptText className="w-4 h-4 mr-2" />Issue Credit Note</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Payment Proof */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (!o && !savingPay) { setPayOpen(false); resetPay(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Payment Proof</DialogTitle>
            <DialogDescription>
              Submit a payment to <strong>{partnerDisplayName}</strong>. It will be{" "}
              <em>Pending Approval</em> until they confirm it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount <span className="text-red-500">*</span></Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={payCur} onValueChange={setPayCur}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>SWIFT / Bank Reference</Label>
                <Input placeholder="Optional" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional…" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
            <FileField file={payFile} onChange={setPayFile} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayOpen(false); resetPay(); }} disabled={savingPay}>Cancel</Button>
            <Button onClick={handleUploadPayment} disabled={savingPay || !payFile}>
              {savingPay ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : <><CreditCard className="w-4 h-4 mr-2" />Submit Payment</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve / Reject Dialog */}
      <Dialog open={!!reviewTxn} onOpenChange={(o) => { if (!o && !processingReview) setReviewTxn(null); }}>
        {reviewTxn && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Review Payment</DialogTitle>
              <DialogDescription>
                {fmt(reviewTxn.amount, reviewTxn.currency)} submitted by{" "}
                <strong>{partnerDisplayName}</strong> on {fmtDate(reviewTxn.transaction_date)}.
                {reviewTxn.reference_number && (
                  <> Ref: <span className="font-mono">{reviewTxn.reference_number}</span>.</>
                )}
              </DialogDescription>
            </DialogHeader>
            {reviewTxn.document_storage_path && (
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => handleViewDoc(reviewTxn)}>
                <FileText className="w-4 h-4" />
                View Payment Proof
              </Button>
            )}
            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => handleReject(reviewTxn)}
                disabled={processingReview}
              >
                {processingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4 mr-1" />Reject</>}
              </Button>
              <Button className="flex-1" onClick={() => handleApprove(reviewTxn)} disabled={processingReview}>
                {processingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-1" />Approve</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </DashboardLayout>
  );
}
