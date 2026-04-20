"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, AlertCircle, Paperclip, Send, ImageIcon,
  FileVideo, FileText, X, ExternalLink,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ClaimStatusBadge } from "@/components/claims/claim-status-badge";
import { ClaimOverviewBlock } from "@/components/claims/claim-overview-block";
import { DamageReportForm } from "@/components/claims/damage-report-form";
import { ClaimDocumentsPanel } from "@/components/claims/claim-documents-panel";
import { useClaim } from "@/hooks/use-claims";
import { useClaimMessages } from "@/hooks/use-claim-messages";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  getContainerById, sendClaimMessage, uploadClaimAttachment,
  updateClaimStatus,
  type ClaimMessage, type ClaimAttachment,
} from "@/lib/db";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import type { ContainerView, UserRole, ClaimStatus } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Status maps ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  negotiation: "Negotiation",
  resolved: "Resolved",
  closed: "Closed",
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  damaged_goods: "Damaged Goods", missing_goods: "Missing Goods",
  short_shipment: "Short Shipment", quality_issue: "Quality Issue",
  documentation_error: "Documentation Error", delay: "Delay", other: "Other",
};

// ── Attachment helpers ────────────────────────────────────────────────────────

interface PendingFile {
  file: File;
  name: string;
  type: "image" | "video" | "document";
}

function inferType(filename: string): "image" | "video" | "document" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  return "document";
}

function AttachmentTypeIcon({ type, className }: { type: "image" | "video" | "document"; className?: string }) {
  if (type === "image") return <ImageIcon className={cn("text-blue-400", className)} />;
  if (type === "video") return <FileVideo className={cn("text-purple-400", className)} />;
  return <FileText className={cn("text-gray-400", className)} />;
}

function AttachmentChip({ attachment, isMe }: { attachment: ClaimAttachment; isMe: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.storage
      .from("documents")
      .createSignedUrl(attachment.storage_path, 3600)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((res: any) => { if (res?.data?.signedUrl) setUrl(res.data.signedUrl); });
  }, [attachment.storage_path]);

  const sizeLabel = attachment.file_size_bytes
    ? `${(attachment.file_size_bytes / 1024).toFixed(0)} KB`
    : "";

  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { if (!url) e.preventDefault(); }}
      className={cn(
        "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border max-w-[220px] truncate transition-opacity",
        isMe
          ? "bg-blue-500 border-blue-400 text-white hover:opacity-80"
          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50",
        !url && "opacity-60 cursor-wait"
      )}
    >
      <AttachmentTypeIcon type={attachment.media_type} className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{attachment.file_name}</span>
      {sizeLabel && <span className="shrink-0 opacity-60">{sizeLabel}</span>}
    </a>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton({ role }: { role: UserRole }) {
  return (
    <DashboardLayout role={role === "supplier" ? "supplier" : "importer"} title="Loading…" subtitle="">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </DashboardLayout>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ClaimDetailPageProps {
  role: "importer" | "supplier";
}

export function ClaimDetailPage({ role }: ClaimDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const claimId = params.claimId as string;

  // Single source of truth for auth — userId comes from useCurrentUser(),
  // never from a separate getCurrentUserId() call (avoids a race condition).
  const { userId, isLoading: userLoading } = useCurrentUser();

  const { data: claim, isLoading: claimLoading } = useClaim(claimId);
  const { data: messages = [] } = useClaimMessages(claimId);

  // Derive the attachments panel list directly from chat messages so it stays
  // in sync with the realtime subscription without a separate query.
  const chatAttachments = useMemo(
    () => messages.flatMap((m) => (m.attachments ?? []).map((a) => ({ ...a, created_at: m.created_at }))),
    [messages]
  );

  const [container, setContainer] = useState<ContainerView | null>(null);

  // Chat compose state
  const [messageText, setMessageText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [statusDraft, setStatusDraft] = useState<ClaimStatus | "">("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialScrollDone = useRef(false);

  const loadContainer = useCallback(async (containerId: string) => {
    const c = await getContainerById(containerId);
    setContainer(c);
  }, []);

  useEffect(() => {
    if (claim?.container_id) loadContainer(claim.container_id);
  }, [claim?.container_id, loadContainer]);

  // Scroll to bottom whenever the messages list grows
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: initialScrollDone.current ? "smooth" : "instant",
    });
    initialScrollDone.current = true;
  }, [messages.length]);

  const backPath = role === "importer" ? "/importer/claims" : "/supplier/claims";
  const containerBasePath = role === "importer" ? "/importer" : "/supplier";

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ file: f, name: f.name, type: inferType(f.name) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSend = messageText.trim().length > 0 || pendingFiles.length > 0;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);

    let attachments: ClaimAttachment[] = [];
    if (pendingFiles.length > 0) {
      const results = await Promise.all(
        pendingFiles.map((pf) => uploadClaimAttachment(claimId, pf.file))
      );
      attachments = results.filter((r): r is ClaimAttachment => r !== null);
      const failed = results.filter((r) => r === null).length;
      if (failed > 0) toast.error(`${failed} attachment${failed > 1 ? "s" : ""} failed to upload.`);
    }

    const ok = await sendClaimMessage(
      claimId,
      messageText.trim(),
      attachments.length > 0 ? attachments : undefined,
      role
    );

    if (ok) {
      setMessageText("");
      setPendingFiles([]);
    } else {
      toast.error("Failed to send message.");
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleStatusUpdate() {
    if (!statusDraft || !claim || statusDraft === claim.status) return;
    const ok = await updateClaimStatus(claimId, statusDraft);
    if (ok) {
      toast.success(`Status updated to "${STATUS_LABELS[statusDraft]}".`);
      setStatusDraft("");
    } else {
      toast.error("Failed to update status.");
    }
  }

  // ── Loading / Error states ────────────────────────────────────────────────

  if (claimLoading || userLoading) return <LoadingSkeleton role={role} />;

  if (!claim) {
    return (
      <DashboardLayout role={role === "supplier" ? "supplier" : "importer"} title="Claim Not Found" subtitle="">
        <div className="flex flex-col items-center py-20 gap-4">
          <AlertCircle className="w-10 h-10 text-gray-300" />
          <p className="text-gray-500">This claim does not exist or you don&apos;t have access.</p>
          <Button variant="outline" size="sm" onClick={() => router.push(backPath)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Claims
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout
      role={role === "supplier" ? "supplier" : "importer"}
      title={`Claim — ${container?.container_number ?? claim.container_id.slice(0, 8)}`}
      subtitle={`${container?.supplier_company ?? ""} · ${container?.product_name ?? ""}`}
    >
      <Button
        variant="ghost" size="sm"
        className="mb-4 gap-1.5 -ml-1 text-gray-600"
        onClick={() => router.push(backPath)}
      >
        <ArrowLeft className="w-4 h-4" /> Back to Claims
      </Button>

      {/* ── 1. Claim metadata card ─────────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim ID</p>
              <p className="font-mono text-sm font-semibold text-gray-800">{claim.id.slice(0, 8)}…</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ClaimStatusBadge status={claim.status} />
              {role === "importer" && (
                <div className="flex items-center gap-1.5">
                  <Select value={statusDraft} onValueChange={(v) => setStatusDraft(v as ClaimStatus)}>
                    <SelectTrigger className="h-7 text-xs w-[148px]">
                      <SelectValue placeholder="Change status…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABELS) as ClaimStatus[]).map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm" className="h-7 text-xs px-2.5"
                    disabled={!statusDraft || statusDraft === claim.status}
                    onClick={handleStatusUpdate}
                  >
                    Update
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Container</p>
              {container ? (
                <button
                  className="text-blue-600 hover:underline text-sm font-medium flex items-center gap-1"
                  onClick={() => router.push(`${containerBasePath}/containers/${container.id}`)}
                >
                  {container.container_number}
                  <ExternalLink className="w-3 h-3" />
                </button>
              ) : <span className="text-gray-500">—</span>}
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Supplier</p>
              <p className="font-medium text-gray-800">{container?.supplier_company ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Product</p>
              <p className="text-gray-700">{container?.product_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim Type</p>
              <p className="text-gray-700">{CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim Amount</p>
              <p className="font-semibold text-gray-800">
                {claim.amount != null ? `$${claim.amount.toLocaleString()}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Opened</p>
              <p className="text-gray-700">
                {new Date(claim.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            {claim.description && (
              <div className="col-span-2 md:col-span-3 pt-1 border-t mt-1">
                <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Description</p>
                <p className="text-gray-700 leading-relaxed">{claim.description}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 2. AI Overview ────────────────────────────────────────────────── */}
      <div className="mb-4">
        <ClaimOverviewBlock
          claimId={claimId}
          summary={claim.claim_summary}
          updatedAt={claim.last_summary_at}
        />
      </div>

      {/* ── 3. Damage Report ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <DamageReportForm claim={claim} role={role} />
      </div>

      {/* ── 4. Document Zones ────────────────────────────────────────────── */}
      <div className="mb-4">
        <ClaimDocumentsPanel
          claimId={claimId}
          documents={chatAttachments}
        />
      </div>

      {/* ── 5. Chat / Communication ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
            Communication
            <span className="text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-0">
          <div className="space-y-5 min-h-[120px] max-h-[500px] overflow-y-auto py-4 pr-1">
            {messages.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">
                No messages yet. Start the conversation below.
              </p>
            )}
            {messages.map((msg) => {
              const isMe = msg.sender_id === userId;
              const isSupplier = msg.sender_role === "supplier";

              // Derive first name from the joined profile; fall back to role label
              const fullName = msg.sender?.full_name ?? "";
              const firstName = fullName.split(" ")[0] || (isSupplier ? "Supplier" : "Importer");
              // Avatar initials: up to 2 chars from first name
              const initials = firstName.slice(0, 2).toUpperCase();

              return (
                <div key={msg.id} className={cn("flex gap-2.5", isMe ? "flex-row-reverse" : "flex-row")}>
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5",
                    isSupplier ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-600"
                  )}>
                    {initials}
                  </div>
                  <div className={cn("flex flex-col gap-1 max-w-[72%]", isMe ? "items-end" : "items-start")}>
                    <div className={cn("flex items-center gap-1.5 text-[11px] text-gray-400", isMe && "flex-row-reverse")}>
                      <span className={cn(
                        "px-1.5 py-px rounded text-[10px] font-medium shrink-0",
                        isSupplier ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600"
                      )}>
                        {firstName}
                      </span>
                      <span className="shrink-0">
                        {new Date(msg.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {msg.message && (
                      <div className={cn(
                        "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        isMe
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-900 rounded-tl-sm"
                      )}>
                        {msg.message}
                      </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-col gap-1 mt-0.5">
                        {msg.attachments.map((att, i) => (
                          <AttachmentChip key={i} attachment={att} isMe={isMe} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t py-3">
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                    <AttachmentTypeIcon type={f.type} className="w-3 h-3" />
                    <span className="max-w-[100px] truncate">{f.name}</span>
                    <button className="ml-0.5 hover:text-red-500" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <Textarea
                placeholder="Type your message… (⌘+Enter to send)"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                className="flex-1 resize-none text-sm"
              />
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button size="sm" disabled={!canSend || sending} onClick={handleSend} className="gap-1.5">
                  <Send className="w-3.5 h-3.5" />{sending ? "…" : "Send"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                >
                  <Paperclip className="w-3.5 h-3.5" /> Attach
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.doc,.docx,.xlsx"
                  multiple
                  onChange={handleFileSelect}
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Supports PDF, JPG, PNG, MP4, DOC · ⌘+Enter to send</p>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
