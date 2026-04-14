import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

/**
 * POST /api/parse-shipment
 *
 * Receives a file (multipart/form-data, field: "file").
 * 1. Uploads to temp_scans bucket.
 * 2. POSTs signed URL to MAKE_WEBHOOK_URL with type: "parse_shipment".
 * 3. Make responds with { shipment, containers } — forwarded to client.
 *
 * Expected Make response:
 * {
 *   shipment: {
 *     vesselName: string, voyageNumber?: string, originCountry?: string,
 *     destinationPort?: string, etd?: string (YYYY-MM-DD), eta?: string
 *   },
 *   containers: [{
 *     containerNumber: string, containerType: string,
 *     portOfLoading?: string, portOfDestination?: string, temperature?: string
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "MAKE_WEBHOOK_URL not configured" },
        { status: 503 }
      );
    }

    const supabase = createAdminSupabaseClient();

    // 1. Upload to temp_scans bucket
    const ext = file.name.split(".").pop() ?? "bin";
    const storageName = `parse-shipment/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("temp_scans")
      .upload(storageName, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[parse-shipment] storage upload:", uploadError.message);
      return NextResponse.json(
        { error: "Failed to upload file to temp storage" },
        { status: 500 }
      );
    }

    // 2. Generate signed URL for Make
    const { data: signed } = await supabase.storage
      .from("temp_scans")
      .createSignedUrl(storageName, 3600);

    // 3. Call Make webhook (Make must have "Return a Response" module enabled)
    const makeRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "parse_shipment",
        file_url: signed?.signedUrl ?? null,
        file_name: file.name,
        file_mime: file.type,
      }),
    });

    if (!makeRes.ok) {
      console.error("[parse-shipment] Make returned", makeRes.status);
      return NextResponse.json(
        { error: "AI processing failed. Check Make.com scenario." },
        { status: 502 }
      );
    }

    const payload = await makeRes.json();

    // Validate minimal shape
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
