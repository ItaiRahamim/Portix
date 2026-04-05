"use client";

import { useState, useRef, useEffect } from "react";
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
  mockClaims, getClaim, getContainer,
  type ClaimStatus,
} from "@/lib/mock-data";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Mock identities ──────────────────────────────────────────
const IMPORTER_NAME = "EuroFresh Imports GmbH";
const SUPPLIER_NAME = "FreshFruit Exports SA";

// ── Status maps ──────────────────────────────────────────────
const STATUS_STYLES: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  "under-review": "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-600",
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Open",
  "under-review": "Under Review",
  negotiation: "Negotiation",
  resolved: "Resolved",
  closed: "Closed",
};

// ── Attachment helpers ────────────────────────────────────────
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

function nowTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── Props ─────────────────────────────────────────────────────
interface ClaimDetailPageProps {
  role: "importer" | "supplier";
}

// ─────────────────────────────────────────────────────────────
export function ClaimDetailPage({ role }: ClaimDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const claimId = params.claimId as string;

  const [refreshKey, setRefreshKey] = useState(0);
  const [messageText, setMessageText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [statusDraft, setStatusDraft] = useState<ClaimStatus | "">("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialScrollDone = useRef(false);

  const claim = getClaim(claimId);

  // Scroll to latest message
  useEffect(() => {
    if (!claim) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: initialScrollDone.current ? "smooth" : "instant",
    });
    initialScrollDone.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, claim?.messages.length]);

  const backPath = role === "importer" ? "/importer/claims" : "/supplier/claims";
  const senderName = role === "importer" ? IMPORTER_NAME : SUPPLIER_NAME;
  const containerBasePath = role === "importer" ? "/importer" : "/supplier";

  // ── Not found ──────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, type: inferType(f.name) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingFile = (idx: number) =>
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  const canSend = messageText.trim().length > 0 || pendingFiles.length > 0;

  const handleSend = () => {
    if (!canSend) return;

    const allMsgCount = mockClaims.reduce((acc, c) => acc + c.messages.length, 0);
    const newId = `MSG${String(allMsgCount + 1).padStart(3, "0")}`;

    claim.messages.push({
      id: newId,
      sender: senderName,
      senderRole: role,
      text: messageText.trim(),
      timestamp: nowTimestamp(),
      attachments: pendingFiles.length > 0 ? [...pendingFiles] : undefined,
    });

    setMessageText("");
    setPendingFiles([]);
    setRefreshKey((k) => k + 1);
    toast.success("Message sent.");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStatusUpdate = () => {
    if (!statusDraft || statusDraft === claim.status) return;
    const claimRef = mockClaims.find((c) => c.id === claimId);
    if (!claimRef) return;
    claimRef.status = statusDraft;
    setStatusDraft("");
    setRefreshKey((k) => k + 1);
    toast.success(`Status updated to "${STATUS_LABELS[statusDraft]}".`);
  };

  const container = getContainer(claim.containerId);

  // ── Render ─────────────────────────────────────────────────
  return (
    <DashboardLayout
      role={role}
      title={`Claim — ${claim.containerNumber}`}
      subtitle={`${claim.supplierName} · ${claim.productName}`}
    >
      {/* Back */}
      <Button
        variant="ghost" size="sm"
        className="mb-4 gap-1.5 -ml-1 text-gray-600"
        onClick={() => router.push(backPath)}
      >
        <ArrowLeft className="w-4 h-4" /> Back to Claims
      </Button>

      {/* ── Claim Info Card ────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="pt-5 pb-5">

          {/* Top row: ID + status + (importer) status changer */}
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim ID</p>
              <p className="font-mono text-sm font-semibold text-gray-800">{claim.id}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Current status badge */}
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full font-medium",
                STATUS_STYLES[claim.status]
              )}>
                {STATUS_LABELS[claim.status]}
              </span>

              {/* Status update — importer only */}
              {role === "importer" && (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={statusDraft}
                    onValueChange={(v) => setStatusDraft(v as ClaimStatus)}
                  >
                    <SelectTrigger className="h-7 text-xs w-[148px]">
                      <SelectValue placeholder="Change status…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABELS) as ClaimStatus[]).map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    disabled={!statusDraft || statusDraft === claim.status}
                    onClick={handleStatusUpdate}
                  >
                    Update
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Container</p>
              <button
                className="text-blue-600 hover:underline text-sm font-medium flex items-center gap-1"
                onClick={() => router.push(`${containerBasePath}/containers/${claim.containerId}`)}
              >
                {claim.containerNumber}
                <ExternalLink className="w-3 h-3" />
              </button>
              {container && (
                <p className="text-xs text-gray-400 mt-0.5">{container.portOfLoading} → {container.portOfDestination}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Supplier</p>
              <p className="font-medium text-gray-800">{claim.supplierName}</p>
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Product</p>
              <p className="text-gray-700">{claim.productName}</p>
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim Type</p>
              <p className="capitalize text-gray-700">{claim.claimType}</p>
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Claim Amount</p>
              <p className="font-semibold text-gray-800">${claim.amount.toLocaleString()}</p>
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5 uppercase tracking-wide">Opened</p>
              <p className="text-gray-700">{claim.createdAt.split(" ")[0]}</p>
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

      {/* ── Conversation ───────────────────────────────────── */}
      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
            Conversation
            <span className="text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {claim.messages.length} message{claim.messages.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="px-5 pb-0">
          {/* Message list */}
          <div className="space-y-5 min-h-[120px] max-h-[500px] overflow-y-auto py-4 pr-1">
            {claim.messages.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-10">
                No messages yet. Start the conversation below.
              </p>
            )}

            {claim.messages.map((msg) => {
              const isMe = msg.senderRole === role;
              return (
                <div
                  key={msg.id}
                  className={cn("flex gap-2.5", isMe ? "flex-row-reverse" : "flex-row")}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5",
                    msg.senderRole === "importer"
                      ? "bg-blue-100 text-blue-600"
                      : "bg-green-100 text-green-700"
                  )}>
                    {msg.sender.charAt(0).toUpperCase()}
                  </div>

                  <div className={cn("flex flex-col gap-1 max-w-[72%]", isMe ? "items-end" : "items-start")}>
                    {/* Meta row */}
                    <div className={cn(
                      "flex items-center gap-1.5 text-[11px] text-gray-400",
                      isMe && "flex-row-reverse"
                    )}>
                      <span className="font-medium text-gray-600 truncate max-w-[140px]">{msg.sender}</span>
                      <span className={cn(
                        "px-1.5 py-px rounded text-[10px] font-medium shrink-0",
                        msg.senderRole === "importer"
                          ? "bg-blue-50 text-blue-600"
                          : "bg-green-50 text-green-700"
                      )}>
                        {msg.senderRole === "importer" ? "Importer" : "Supplier"}
                      </span>
                      <span className="shrink-0">{msg.timestamp}</span>
                    </div>

                    {/* Text bubble */}
                    {msg.text && (
                      <div className={cn(
                        "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        isMe
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-900 rounded-tl-sm"
                      )}>
                        {msg.text}
                      </div>
                    )}

                    {/* Attachments */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className={cn("flex flex-wrap gap-1.5", isMe && "justify-end")}>
                        {msg.attachments.map((att, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-white text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
                          >
                            <AttachmentIcon type={att.type} className="w-3.5 h-3.5" />
                            <span className="max-w-[120px] truncate">{att.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input ──────────────────────────────────────── */}
          <div className="border-t py-3">
            {/* Pending file chips */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100"
                  >
                    <AttachmentIcon type={f.type} className="w-3 h-3" />
                    <span className="max-w-[100px] truncate">{f.name}</span>
                    <button
                      className="ml-0.5 hover:text-red-500 transition-colors"
                      onClick={() => removePendingFile(i)}
                    >
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
                <Button
                  size="sm"
                  disabled={!canSend}
                  onClick={handleSend}
                  className="gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </Button>

                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" className="gap-1.5 w-full pointer-events-none">
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
                </label>
              </div>
            </div>

            <p className="text-[11px] text-gray-400 mt-1.5">
              Supports PDF, JPG, PNG, MP4, DOC &nbsp;·&nbsp; ⌘+Enter to send
            </p>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
