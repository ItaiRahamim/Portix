"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Download, ZoomIn, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import type { ChatAttachment } from "@/lib/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isImage(mime: string | null, name: string) {
  if (mime?.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(name);
}

function FileTypeBadge({ doc }: { doc: ChatAttachment }) {
  if (isImage(null, doc.file_name))
    return (
      <div className="h-4 w-4 rounded bg-blue-100 flex items-center justify-center text-[8px] font-bold text-blue-600">
        IMG
      </div>
    );
  if (/\.pdf$/i.test(doc.file_name))
    return (
      <div className="h-4 w-4 rounded bg-red-100 flex items-center justify-center text-[8px] font-bold text-red-600">
        PDF
      </div>
    );
  if (/\.(xlsx?|csv)$/i.test(doc.file_name))
    return <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />;
  return <FileText className="h-4 w-4 text-gray-400 shrink-0" />;
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps { src: string; name: string; onClose: () => void }
function Lightbox({ src, name, onClose }: LightboxProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] bg-white rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <p className="text-sm font-medium text-gray-700 truncate max-w-xs">{name}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-4">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          className="max-h-[80vh] w-auto object-contain block"
        />
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DocumentUploadZoneProps {
  label: string;
  description: string;
  documents: ChatAttachment[];
}

export function DocumentUploadZone({ label, description, documents }: DocumentUploadZoneProps) {
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  async function resolveUrl(doc: ChatAttachment): Promise<string> {
    if (signedUrls[doc.storage_path]) return signedUrls[doc.storage_path];
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 3600);
    if (error || !data?.signedUrl) {
      console.error("[DocumentUploadZone] signed URL error:", error?.message);
      return "";
    }
    const url = data.signedUrl;
    setSignedUrls((prev) => ({ ...prev, [doc.storage_path]: url }));
    return url;
  }

  async function handlePreview(doc: ChatAttachment) {
    const url = await resolveUrl(doc);
    if (!url) { toast.error("Preview not available."); return; }
    if (isImage(null, doc.file_name)) {
      setLightbox({ src: url, name: doc.file_name });
    } else {
      window.open(url, "_blank");
    }
  }

  async function handleDownload(doc: ChatAttachment) {
    const url = await resolveUrl(doc);
    if (!url) { toast.error("Could not generate download link."); return; }
    window.open(url, "_blank");
  }

  return (
    <>
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>

        {documents.length > 0 ? (
          <ul className="space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.storage_path} className="bg-white border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileTypeBadge doc={doc} />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{doc.file_name}</p>
                      <p className="text-xs text-gray-400">
                        {format(new Date(doc.created_at), "MMM d, yyyy")}
                        {doc.file_size_bytes
                          ? ` · ${(doc.file_size_bytes / 1024).toFixed(0)} KB`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button
                      onClick={() => handlePreview(doc)}
                      className={cn(
                        "p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                      )}
                      title="Preview / Open"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDownload(doc)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400 italic">
            No attachments yet — share files via the Communication section below.
          </p>
        )}
      </div>
    </>
  );
}
