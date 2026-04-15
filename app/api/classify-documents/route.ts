import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/classify-documents
 *
 * Forwards the file binary to the Make.com webhook as multipart/form-data.
 * Make receives: file (binary) + action ("classify_documents") + container_id.
 *
 * Make responds with:
 * {
 *   documents_found: [
 *     {
 *       document_type:    string,   // matches portix.document_type enum
 *       document_number?: string,
 *       container_number: string,   // specific container number OR "ALL"
 *       extracted_data?:  object,   // any additional AI-extracted fields
 *     }
 *   ]
 * }
 *
 * This route returns that payload directly to the frontend.
 * All Supabase updates are performed client-side in SmartUploadZone
 * so the browser Supabase client (with the user's session) handles auth.
 */
export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file") as File | null;
    const containerId = incoming.get("containerId") as string | null;

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

    // Forward file binary + metadata to Make — let fetch set multipart boundary
    const makeForm = new FormData();
    makeForm.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
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

    // Return Make's response directly — the frontend handles all DB updates
    const makeJson = await makeRes.json();

    const documents_found = makeJson?.documents_found;

    if (!Array.isArray(documents_found) || documents_found.length === 0) {
      return NextResponse.json({ documents_found: [], message: "No documents identified" });
    }

    return NextResponse.json({ documents_found });
  } catch (err) {
    console.error("[classify-documents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
