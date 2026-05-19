/**
 * Portix — RAG Embeddings Client Helpers
 *
 * The actual Gemini embedding work + DB inserts happen in the
 *   supabase/functions/embed-document
 * Edge Function (the API key cannot ship to the browser). This module is a
 * thin wrapper that:
 *
 *   - exports a pure chunkText() helper for any client-side splitting needs
 *     (kept in sync with the edge function's copy)
 *   - exports generateAndSaveEmbeddings() which invokes the edge function
 *     and is safe to fire-and-forget from any flow
 *
 * Why duplicate chunkText in two places (here + edge function)?
 * Supabase Edge Functions are Deno and cannot import from this Next.js
 * project. The duplication is intentional and tagged with a sync comment.
 */

import { createBrowserSupabaseClient } from "@/lib/supabase";

// ─── chunkText — pure helper ─────────────────────────────────────────────────
// keep in sync with supabase/functions/embed-document/index.ts → chunkText

/**
 * Split arbitrary text into RAG-friendly chunks.
 *
 * Strategy:
 *   1. Split on paragraph boundaries (double newline).
 *   2. Greedy-pack paragraphs up to maxLength chars per chunk.
 *   3. If a single paragraph exceeds maxLength → fall back to sentence split.
 *   4. If a single sentence exceeds maxLength → hard char-slice as last resort.
 *
 * Defaults to 800 chars (~200 tokens) which balances retrieval precision vs.
 * embedding cost.
 */
export function chunkText(text: string, maxLength = 800): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let buf = "";

  for (const p of paragraphs) {
    // Hard-split paragraphs too big to fit in one chunk
    if (p.length > maxLength) {
      if (buf) { chunks.push(buf); buf = ""; }
      const sentences = p.split(/(?<=[.!?])\s+/g);
      let sbuf = "";
      for (const s of sentences) {
        if (s.length > maxLength) {
          if (sbuf) { chunks.push(sbuf); sbuf = ""; }
          for (let i = 0; i < s.length; i += maxLength) {
            chunks.push(s.slice(i, i + maxLength));
          }
          continue;
        }
        if (sbuf.length + s.length + 1 > maxLength) {
          chunks.push(sbuf);
          sbuf = s;
        } else {
          sbuf = sbuf ? `${sbuf} ${s}` : s;
        }
      }
      if (sbuf) chunks.push(sbuf);
      continue;
    }

    if (buf.length + p.length + 2 > maxLength) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);

  return chunks;
}

// ─── generateAndSaveEmbeddings — invoke edge function ────────────────────────

export interface EmbedResult {
  ok: boolean;
  chunks_inserted: number;
  error?: string;
}

/**
 * Trigger the embed-document Edge Function for a single document.
 *
 * NON-BLOCKING by default — callers should typically NOT `await` this.
 * Errors are caught and logged so the host flow (e.g. document upload)
 * never fails because embedding failed.
 *
 * Example (fire-and-forget):
 *   void generateAndSaveEmbeddings(containerId, documentId, extractedText);
 */
export async function generateAndSaveEmbeddings(
  containerId: string,
  documentId: string | null,
  rawText: string,
): Promise<EmbedResult> {
  try {
    if (!containerId || !rawText?.trim()) {
      return { ok: false, chunks_inserted: 0, error: "containerId and rawText are required" };
    }

    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase.functions.invoke("embed-document", {
      body: {
        container_id: containerId,
        document_id:  documentId,
        text:         rawText,
      },
    });

    if (error) {
      console.error("[embeddings] edge function error:", error.message);
      return { ok: false, chunks_inserted: 0, error: error.message };
    }

    if (!data?.ok) {
      console.error("[embeddings] embed-document returned not-ok:", data?.error);
      return { ok: false, chunks_inserted: 0, error: data?.error ?? "Unknown error" };
    }

    return {
      ok: true,
      chunks_inserted: data.chunks_inserted ?? 0,
    };
  } catch (err) {
    // Catch-all: never bubble up to the caller's main flow
    const message = err instanceof Error ? err.message : String(err);
    console.error("[embeddings] unexpected failure:", message);
    return { ok: false, chunks_inserted: 0, error: message };
  }
}
