import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

/**
 * POST /api/classify-documents
 *
 * Receives a file + containerId (multipart/form-data).
 * 1. Uploads file to temp_scans bucket.
 * 2. POSTs signed URL to MAKE_WEBHOOK_URL with type: "classify_documents".
 * 3. Make responds with { documents_found: [...] }.
 * 4. Updates portix.documents rows (by document_type) with status "uploaded"
 *    and extracted metadata. Also copies file to documents bucket per type.
 *
 * Expected Make response:
 * {
 *   documents_found: [{
 *     document_type: string,   // must match portix.document_type enum
 *     document_number?: string,
 *     issue_date?: string,     // YYYY-MM-DD
 *     notes?: string,
 *     confidence?: number      // 0–1, informational only
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const containerId = formData.get("containerId") as string | null;

    if (!file || !containerId) {
      return NextResponse.json(
        { error: "file and containerId are required" },
        { status: 400 }
      );
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "MAKE_WEBHOOK_URL not configured" },
        { status: 503 }
      );
    }

    const supabase = createAdminSupabaseClient();
    const bytes = await file.arrayBuffer();
    const ext = file.name.split(".").pop() ?? "bin";
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2);

    // 1. Upload to temp_scans for Make to process
    const tempPath = `classify-docs/${timestamp}-${rand}.${ext}`;
    const { error: tempError } = await supabase.storage
      .from("temp_scans")
      .upload(tempPath, bytes, { contentType: file.type, upsert: false });

    if (tempError) {
      console.error("[classify-documents] temp upload:", tempError.message);
      return NextResponse.json(
        { error: "Failed to upload to temp storage" },
        { status: 500 }
      );
    }

    const { data: signed } = await supabase.storage
      .from("temp_scans")
      .createSignedUrl(tempPath, 3600);

    // 2. Call Make webhook
    const makeRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "classify_documents",
        file_url: signed?.signedUrl ?? null,
        file_name: file.name,
        file_mime: file.type,
        container_id: containerId,
      }),
    });

    if (!makeRes.ok) {
      console.error("[classify-documents] Make returned", makeRes.status);
      return NextResponse.json(
        { error: "AI processing failed. Check Make.com scenario." },
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

    // 3. For each detected document type:
    //    a) Copy file to documents bucket at the correct path
    //    b) Update the portix.documents row
    const results = await Promise.all(
      documents_found.map(async (doc) => {
        const docPath = `${containerId}/${doc.document_type}/${timestamp}-${rand}.${ext}`;

        // Upload to documents bucket
        const { error: docUploadError } = await supabase.storage
          .from("documents")
          .upload(docPath, bytes, { contentType: file.type, upsert: true });

        if (docUploadError) {
          console.warn(
            `[classify-documents] doc upload failed for ${doc.document_type}:`,
            docUploadError.message
          );
        }

        // Update the portix.documents row (only if currently missing or uploaded)
        const { error: dbError } = await supabase
          .from("documents")
          .update({
            status: "uploaded",
            storage_path: docUploadError ? null : docPath,
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
          .in("status", ["missing", "uploaded"]); // don't overwrite approved/rejected

        return {
          document_type: doc.document_type,
          success: !dbError,
          storage_path: docUploadError ? null : docPath,
        };
      })
    );

    return NextResponse.json({ updated: results }, { status: 200 });
  } catch (err) {
    console.error("[classify-documents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
