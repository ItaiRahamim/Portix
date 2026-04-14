import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

/**
 * POST /api/classify-documents
 *
 * Forwards the file binary to the Make.com webhook as multipart/form-data.
 * Make receives: file (binary) + action ("classify_documents") + container_id.
 * Make responds with: { documents_found: [{ document_type, document_number?, issue_date?, notes? }] }
 * Route then copies file to documents bucket per type and updates portix.documents rows.
 */
export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file") as File | null;
    const containerId = incoming.get("containerId") as string | null;

    if (!file || !containerId) {
      return NextResponse.json({ error: "file and containerId are required" }, { status: 400 });
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({ error: "MAKE_WEBHOOK_URL not configured" }, { status: 503 });
    }

    // Read bytes once — reused for Make call + per-type Supabase uploads
    const bytes = await file.arrayBuffer();
    const ext = file.name.split(".").pop() ?? "bin";
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2);

    // Build multipart payload for Make — no manual Content-Type
    const makeForm = new FormData();
    makeForm.append("file", new Blob([bytes], { type: file.type }), file.name);
    makeForm.append("action", "classify_documents");
    makeForm.append("container_id", containerId);

    const makeRes = await fetch(webhookUrl, {
      method: "POST",
      body: makeForm,
    });

    if (!makeRes.ok) {
      const text = await makeRes.text().catch(() => "");
      console.error("[classify-documents] Make returned", makeRes.status, text);
      return NextResponse.json(
        { error: `Make webhook rejected the request (${makeRes.status})` },
        { status: 502 }
      );
    }

    const { documents_found } = await makeRes.json() as {
      documents_found?: {
        document_type: string;
        document_number?: string;
        issue_date?: string;
        notes?: string;
      }[];
    };

    if (!Array.isArray(documents_found) || documents_found.length === 0) {
      return NextResponse.json({ updated: [], message: "No documents identified" });
    }

    const supabase = createAdminSupabaseClient();

    // For each identified doc type: upload file to documents bucket + update DB row
    const results = await Promise.all(
      documents_found.map(async (doc) => {
        const docPath = `${containerId}/${doc.document_type}/${timestamp}-${rand}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(docPath, bytes, { contentType: file.type, upsert: true });

        if (uploadError) {
          console.warn(`[classify-documents] upload failed for ${doc.document_type}:`, uploadError.message);
        }

        const { error: dbError } = await supabase
          .from("documents")
          .update({
            status: "uploaded",
            storage_path: uploadError ? null : docPath,
            file_name: file.name,
            file_size_bytes: file.size,
            mime_type: file.type,
            uploaded_at: new Date().toISOString(),
            document_number: doc.document_number ?? null,
            issue_date: doc.issue_date ?? null,
            notes: doc.notes ?? null,
            rejection_reason: null,
            reviewed_by: null,
            reviewed_at: null,
          })
          .eq("container_id", containerId)
          .eq("document_type", doc.document_type)
          .in("status", ["missing", "uploaded"]); // never overwrite approved/rejected

        return {
          document_type: doc.document_type,
          success: !dbError,
          storage_path: uploadError ? null : docPath,
        };
      })
    );

    return NextResponse.json({ updated: results }, { status: 200 });
  } catch (err) {
    console.error("[classify-documents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
