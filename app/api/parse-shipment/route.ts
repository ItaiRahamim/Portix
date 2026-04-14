import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/parse-shipment
 *
 * Forwards the file binary to the Make.com webhook as multipart/form-data.
 * Make receives: file (binary) + action ("parse_shipment").
 * Make responds with: { shipment, containers }
 */
export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({ error: "MAKE_WEBHOOK_URL not configured" }, { status: 503 });
    }

    // Build multipart payload for Make — let fetch set Content-Type + boundary
    const makeForm = new FormData();
    makeForm.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
    makeForm.append("action", "parse_shipment");

    const makeRes = await fetch(webhookUrl, {
      method: "POST",
      body: makeForm,
      // No Content-Type header — fetch sets it with the correct multipart boundary
    });

    if (!makeRes.ok) {
      const text = await makeRes.text().catch(() => "");
      console.error("[parse-shipment] Make returned", makeRes.status, text);
      return NextResponse.json(
        { error: `Make webhook rejected the request (${makeRes.status})` },
        { status: 502 }
      );
    }

    const payload = await makeRes.json();

    if (!payload?.shipment) {
      return NextResponse.json(
        { error: "Make response missing 'shipment' key" },
        { status: 502 }
      );
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error("[parse-shipment]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
