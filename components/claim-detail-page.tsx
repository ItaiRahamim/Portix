"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Paperclip, Send, ImageIcon, FileVideo, FileText,
  X, ExternalLink, AlertCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  getClaimById, getClaimMessages, sendClaimMessage, getContainerById,
  getCurrentUserId, getProfileById,
  type ClaimMessage,
} from "@/lib/db";
import type { Claim, ContainerView, Profile } from "@/lib/supabase";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Claim status maps ────────────────────────────────────────────────────────

type ClaimStatus = "open" | "under_review" | "negotiation" | "resolved" | "closed";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-600",
};

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
  name: string;
  type: "image" | "video" | "document";
}

function inferType(filename: string): "image" | "video" | "document" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  return "document";
}

function AttachmentIcon({ type, className }: { type: "image" | "video" | "document"; className?: string }) {
  if (type === "image") return <ImageIcon className={cn("text-blue-500", className)} />;
  if (type === "video") return <FileVideo className={cn("text-purple-500", className)} />;
  return <FileText className={cn("text-gray-500", className)} />;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ClaimDetailPageProps {
  role: "importer" | "supplier";
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClaimDetailPage({ role }: ClaimDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const claimId = params.claimId as string;

  const [claim, setClaim] = useState<Claim | null>(null);
  const [container, setContainer] = useState<ContainerView | null>(null);
  const [messages, setMessages] = useState<ClaimMessage[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<Map<string, Profile>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [messageText, setMessageText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [statusDraft, setStatusDraft] = useState<ClaimStatus | "">("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialScrollDone = useRef(false);

  const loadData = useCallback(async () => {
    const [c, msgs, uid] = await Promise.all([
      getClaimById(claimId),
      getClaimMessages(claimId),
      getCurrentUserId(),
    ]);

    setClaim(c);
    setMessages(msgs);
    setCurrentUserId(uid);

    if (c) {
      const cont = await getContainerById(c.container_id);
      setContainer(cont);
    }

    // Load profiles for message senders
    const uniqueSenderIds = [...new Set(msgs.map((m) => m.sender_id))];
    const profiles = await Promise.all(uniqueSenderIds.map((id) => getProfileById(id)));
    const profileMap = new Map<string, Profile>();
    profiles.forEach((p) => { if (p) profileMap.set(p.id, p); });
    setSenderProfiles(profileMap);

    setLoading(false);
  }, [claimId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Scroll to latest message
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
      ...files.map((f) => ({ name: f.name, type: inferType(f.name) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canSend = messageText.trim().length > 0 || pendingFiles.length > 0;

  async function handleSend() {
    if (!canSend || !messageText.trim()) return;
    setSending(true);
    const ok = await sendClaimMessage(claimId, messageText.trim());
    if (ok) {
      setMessageText("");
      setPendingFiles([]);
      loadData();
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
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase
      .from("claims")
      .update({ status: statusDraft })
      .eq("id", claimId);
    if (error) {
      toast.error("Failed to update status.");
    } else {
      toast.success(`Status updated to "${STATUS_LABELS[statusDraft]}".`);
      setStatusDraft("");
      loadData();
    }
  }

  // ── Loading / Not found ───────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout role={role} title="Loading…" subtitle="">
        <div className="py-12 text-center text-gray-400 text-sm">Loading claim…</div>
      </DashboardLayout>
    );
  }

  if (!claim) {
    return (
      <DashboardLayout role={role} title="Claim Not Found" subtitle="">
        <div className="flex flex-col items-center py-20 gap-4">
          <AlertCircle className="w-10 h-10 text-gray-300" />
          <p className="text-gray-500">This claim does not exist or has been removed.</p>
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
      role={role}
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

      {/* Claim Info Card */}
      <Card className="mb-4">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim ID</p>
              <p className="font-mono text-sm font-semibold text-gray-800">{claim.id.slice(0, 8)}…</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full font-medium",
                STATUS_STYLES[claim.status as ClaimStatus] ?? "bg-gray-100 text-gray-700"
              )}>
                {STATUS_LABELS[claim.status as ClaimStatus] ?? claim.status}
              </span>

              {/* Status change — importer only */}
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
              ) : <span className="text-gray-500 text-sm">—</span>}
              {container && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {container.port_of_loading} → {container.port_of_destination}
                </p>
              )}
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

      {/* Conversation */}
      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
            Conversation
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
              const isMe = msg.sender_id === currentUserId;
              const senderProfile = senderProfiles.get(msg.sender_id);
              const senderName = senderProfile?.full_name ?? senderProfile?.email ?? "Unknown";
              const senderRole = senderProfile?.role ?? "importer";
              const initial = senderName.charAt(0).toUpperCase();

              return (
                <div key={msg.id} className={cn("flex gap-2.5", isMe ? "flex-row-reverse" : "flex-row")}>
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5",
                    senderRole === "supplier" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-600"
                  )}>
                    {initial}
                  </div>

                  <div className={cn("flex flex-col gap-1 max-w-[72%]", isMe ? "items-end" : "items-start")}>
                    <div className={cn("flex items-center gap-1.5 text-[11px] text-gray-400", isMe && "flex-row-reverse")}>
                      <span className="font-medium text-gray-600 truncate max-w-[140px]">{senderName}</span>
                      <span className={cn(
                        "px-1.5 py-px rounded text-[10px] font-medium shrink-0",
                        senderRole === "supplier" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-600"
                      )}>
                        {senderRole === "supplier" ? "Supplier" : "Importer"}
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
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t py-3">
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                    <AttachmentIcon type={f.type} className="w-3 h-3" />
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
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" className="gap-1.5 w-full pointer-events-none">
                    <Paperclip className="w-3.5 h-3.5" /> Attach
                  </Button>
                  <input
                    ref={fileInputRef} type="file" className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.mp4,.mov,.doc,.docx,.xlsx"
                    multiple onChange={handleFileSelect}
                  />
                </label>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Supports PDF, JPG, PNG, MP4, DOC · ⌘+Enter to send</p>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
