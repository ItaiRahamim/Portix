/**
 * Portix — Supabase Query Layer
 *
 * All database interactions go through here.
 * Pages/components import from this file, NOT from mock-data.ts.
 *
 * All queries use the browser Supabase client (client-side).
 * For server-side queries (RSC / Route Handlers), call createServerSupabaseClient
 * directly from the page file.
 *
 * Schema: portix (configured on the client via db.schema option)
 */

import { createBrowserSupabaseClient } from "@/lib/supabase";
import type {
  ContainerView,
  ContainerStatus,
  Document,
  DocumentType,
  DocumentStatus,
  Invoice,
  Claim,
  ClaimDocument,
  ImportLicenseView,
  Profile,
  UserRole,
} from "@/lib/supabase";

// ─── Current user ─────────────────────────────────────────────────────────────

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data ?? null;
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ─── Containers ───────────────────────────────────────────────────────────────

/**
 * Returns enriched containers for the current user's role.
 * RLS automatically filters by role — importer sees their containers,
 * supplier sees theirs, customs agent sees all.
 * Uses v_containers view which joins shipment + party names.
 */
export async function getContainers(): Promise<ContainerView[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("v_containers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[db] getContainers:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getContainerById(id: string): Promise<ContainerView | null> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("v_containers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[db] getContainerById:", error.message);
    return null;
  }
  return data ?? null;
}

export async function updateContainerStatus(
  containerId: string,
  status: ContainerStatus
): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from("containers")
    .update({ status })
    .eq("id", containerId);

  if (error) {
    console.error("[db] updateContainerStatus:", error.message);
    return false;
  }
  return true;
}

// ─── Documents ────────────────────────────────────────────────────────────────

/**
 * Returns all 7 documents for a container.
 * - customs_agent: queries 'documents' table directly (has internal_note via RLS)
 * - importer/supplier: queries 'v_documents_public' (internal_note excluded)
 */
export async function getDocumentsForContainer(
  containerId: string,
  includeInternalNote = false
): Promise<Document[]> {
  const supabase = createBrowserSupabaseClient();
  const view = includeInternalNote ? "documents" : "v_documents_public";

  const { data, error } = await supabase
    .from(view)
    .select("*")
    .eq("container_id", containerId)
    .order("document_type");

  if (error) {
    console.error("[db] getDocumentsForContainer:", error.message);
    return [];
  }
  return data ?? [];
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  opts?: {
    rejectionReason?: string | null;
    internalNote?: string | null;
    reviewedBy?: string | null;
  }
): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();

  // ── Role assertion ────────────────────────────────────────────────────────
  // Only customs_agent may approve or reject. Any other role calling this with
  // a review status is a client-side bug or a tampered request — reject early.
  if (status === "approved" || status === "rejected") {
    const profile = await getCurrentProfile();
    if (profile?.role !== "customs_agent" && profile?.role !== "customs") {
      console.error("[db] updateDocumentStatus: permission denied — only customs agent may approve/reject");
      return false;
    }
    // Always stamp the real reviewer from the session — never trust the client
    opts = { ...opts, reviewedBy: profile.id };
  }

  const { error } = await supabase
    .from("documents")
    .update({
      status,
      rejection_reason: opts?.rejectionReason ?? null,
      internal_note: opts?.internalNote ?? null,
      reviewed_by: opts?.reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    console.error("[db] updateDocumentStatus:", error.message);
    return false;
  }
  return true;
}

export async function uploadDocumentRecord(opts: {
  containerId: string;
  documentType: DocumentType;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedBy: string;
  documentNumber?: string;
  issueDate?: string;
  notes?: string;
}): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from("documents")
    .update({
      status: "uploaded",
      storage_path: opts.storagePath,
      file_name: opts.fileName,
      file_size_bytes: opts.fileSizeBytes,
      mime_type: opts.mimeType,
      uploaded_by: opts.uploadedBy,
      uploaded_at: new Date().toISOString(),
      document_number: opts.documentNumber ?? null,
      issue_date: opts.issueDate ?? null,
      notes: opts.notes ?? null,
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("container_id", opts.containerId)
    .eq("document_type", opts.documentType);

  if (error) {
    console.error("[db] uploadDocumentRecord:", error.message);
    return false;
  }
  return true;
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function getInvoices(): Promise<Invoice[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("invoice_date", { ascending: false });

  if (error) {
    console.error("[db] getInvoices:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getInvoicesByAccount(accountId: string): Promise<Invoice[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .or(`importer_id.eq.${accountId},supplier_id.eq.${accountId}`)
    .order("invoice_date", { ascending: false });

  if (error) {
    console.error("[db] getInvoicesByAccount:", error.message);
    return [];
  }
  return data ?? [];
}

// ─── Claims ───────────────────────────────────────────────────────────────────

export async function getClaims(): Promise<Claim[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[db] getClaims:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getClaimById(claimId: string): Promise<Claim | null> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .eq("id", claimId)
    .single();

  if (error) {
    console.error("[db] getClaimById:", error.message);
    return null;
  }
  return data ?? null;
}

export interface ClaimAttachment {
  storage_path: string;
  file_name: string;
  media_type: "image" | "video" | "document";
  file_size_bytes: number;
}

/** ClaimAttachment enriched with the parent message's timestamp. */
export interface ChatAttachment extends ClaimAttachment {
  created_at: string;
}

export interface ClaimMessage {
  id: string;
  claim_id: string;
  sender_id: string;
  sender_role: "importer" | "supplier" | "customs" | "customs_agent" | null;
  message: string;
  attachments: ClaimAttachment[] | null;
  created_at: string;
  // Joined from portix.profiles via sender_id FK
  sender?: { full_name: string } | null;
}

export async function getClaimMessages(claimId: string): Promise<ClaimMessage[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("claim_messages")
    // Join portix.profiles through the sender_id FK to get the sender's name.
    // PostgREST resolves the FK automatically; "sender" is the alias.
    .select("*, sender:profiles!sender_id(full_name)")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[db] getClaimMessages:", error.message);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    ...row,
    attachments: row.attachments ?? null,
    sender: row.sender ?? null,
  }));
}

export async function sendClaimMessage(
  claimId: string,
  message: string,
  attachments?: ClaimAttachment[],
  /** Pass the caller's role so it is stored on the message row.
   *  The chat UI uses sender_role to colour-code bubbles without a join. */
  senderRole?: string
): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();

  // Always derive sender_id from the live session — never trust a parameter.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("[db] sendClaimMessage: no authenticated user");
    return false;
  }

  // If senderRole wasn't supplied by the caller, resolve it from the profile
  // so the chat bubble can colour-code correctly even on first load.
  let resolvedRole = senderRole ?? null;
  if (!resolvedRole) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    resolvedRole = profile?.role ?? null;
  }

  const body = message.trim() || (attachments && attachments.length > 0 ? "📎 Attachment" : "");

  const { error } = await supabase
    .from("claim_messages")
    .insert({
      claim_id:    claimId,
      sender_id:   user.id,
      sender_role: resolvedRole,
      message:     body,
      attachments: attachments && attachments.length > 0 ? attachments : null,
    });

  if (error) {
    console.error("[db] sendClaimMessage:", error.message);
    return false;
  }
  return true;
}

/**
 * Uploads a single file to the claim-attachments path in the documents bucket.
 * Returns the ClaimAttachment metadata on success, null on failure.
 *
 * Storage path: claims/{claimId}/{timestamp}-{random}.{ext}
 */
export async function uploadClaimAttachment(
  claimId: string,
  file: File
): Promise<ClaimAttachment | null> {
  const supabase = createBrowserSupabaseClient();

  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `claims/${claimId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, { upsert: false });

  if (error) {
    console.error("[db] uploadClaimAttachment:", error.message);
    return null;
  }

  const mediaType: ClaimAttachment["media_type"] = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("image/")
    ? "image"
    : "document";

  return {
    storage_path: storagePath,
    file_name: file.name,
    media_type: mediaType,
    file_size_bytes: file.size,
  };
}

export async function createClaim(opts: {
  containerId: string;
  supplierId: string;
  claimType: string;
  description: string;
  amount?: number;
  currency?: string;
  // importerId is intentionally NOT accepted from the caller —
  // it is always derived from the authenticated session below.
}): Promise<Claim | null> {
  const supabase = createBrowserSupabaseClient();

  // ── Role + identity assertion ─────────────────────────────────────────────
  // Claims can only be opened by importers. We source importerId from the
  // session so callers cannot impersonate another importer.
  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[db] createClaim: not authenticated");
    return null;
  }
  if (profile.role !== "importer") {
    console.error("[db] createClaim: permission denied — only importers may open claims");
    return null;
  }

  const { data, error } = await supabase
    .from("claims")
    .insert({
      container_id: opts.containerId,
      importer_id: profile.id,           // always from session
      supplier_id: opts.supplierId,
      claim_type: opts.claimType,
      description: opts.description,
      amount: opts.amount ?? null,
      currency: opts.currency ?? "USD",
      status: "open",
    })
    .select()
    .single();

  if (error) {
    console.error("[db] createClaim:", error.message);
    return null;
  }
  return data ?? null;
}

// ─── Claim Damage Report ───────────────────────────────────────────────────────

export interface DamageReportPayload {
  damage_type?: string;
  affected_units?: number;
  total_units?: number;
  estimated_loss_usd?: number;
  damage_description?: string;
  damage_location?: string;
  temperature_log_present?: boolean;
  inspector_name?: string;
  inspection_date?: string;
  invoice_number?: string;
  stuffing_date?: string;
  release_date?: string;
  waste_percentage?: number;
}

export async function updateDamageReport(
  claimId: string,
  payload: DamageReportPayload
): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from("claims")
    .update(payload)
    .eq("id", claimId);
  if (error) {
    console.error("[db] updateDamageReport:", error.message);
    return false;
  }
  return true;
}

export async function updateClaimStatus(
  claimId: string,
  status: string
): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from("claims")
    .update({ status })
    .eq("id", claimId);
  if (error) {
    console.error("[db] updateClaimStatus:", error.message);
    return false;
  }
  return true;
}

// ─── Claim Attachments (portix.claim_attachments) ────────────────────────────
// Returns all files attached to any message in this claim thread.
// claim_attachments rows are linked via: claim_messages.claim_id ← claim_attachments.message_id
// so we traverse through claim_messages with an embedded PostgREST select.

export async function getClaimDocuments(claimId: string): Promise<ClaimDocument[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("claim_messages")
    .select("claim_attachments(*)")
    .eq("claim_id", claimId);

  if (error) {
    console.error("[db] getClaimDocuments:", error.message);
    return [];
  }

  // Flatten: one entry per attachment row across all messages in this claim
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).flatMap((m: any) => m.claim_attachments ?? []) as ClaimDocument[];
}

export type { ClaimDocument };

// ─── Import Licenses ──────────────────────────────────────────────────────────

export async function getImportLicenses(): Promise<ImportLicenseView[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("v_import_licenses")
    .select("*")
    .order("expiration_date", { ascending: true });

  if (error) {
    console.error("[db] getImportLicenses:", error.message);
    return [];
  }
  return data ?? [];
}

// ─── Profiles / Accounts ──────────────────────────────────────────────────────

export async function getAccountProfiles(
  counterpartRole: UserRole
): Promise<Profile[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", counterpartRole)
    .order("full_name");

  if (error) {
    console.error("[db] getAccountProfiles:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[db] getProfileById:", error.message);
    return null;
  }
  return data ?? null;
}

// ─── Cargo Media ──────────────────────────────────────────────────────────────

export interface CargoMedia {
  id: string;
  container_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number | null;
  media_type: "image" | "video" | "document";
  caption: string | null;
  created_at: string;
}

export async function getCargoMediaForContainer(
  containerId: string
): Promise<CargoMedia[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("pre_loading_media")
    .select("*")
    .eq("container_id", containerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[db] getCargoMediaForContainer:", error.message);
    return [];
  }
  return data ?? [];
}

export async function uploadCargoMedia(opts: {
  containerId: string;
  file: File;
  storagePath: string;
  caption?: string;
}): Promise<CargoMedia | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 1. Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from("cargo-media")
    .upload(opts.storagePath, opts.file, { upsert: false });

  if (uploadError) {
    console.error("[db] uploadCargoMedia (storage):", uploadError.message);
    return null;
  }

  // 2. Determine media type
  const mediaType: CargoMedia["media_type"] = opts.file.type.startsWith("video/")
    ? "video"
    : opts.file.type.startsWith("image/")
    ? "image"
    : "document";

  // 3. Insert DB record
  const { data, error: insertError } = await supabase
    .from("pre_loading_media")
    .insert({
      container_id: opts.containerId,
      uploaded_by: user.id,
      storage_path: opts.storagePath,
      file_name: opts.file.name,
      file_size_bytes: opts.file.size,
      media_type: mediaType,
      caption: opts.caption ?? null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("[db] uploadCargoMedia (insert):", insertError.message);
    return null;
  }

  return data ?? null;
}

// ─── Shipments ────────────────────────────────────────────────────────────────

export interface CreateShipmentResult {
  shipment_id: string;
  container_ids: string[];
}

/**
 * Atomically creates a shipment + containers + 7 document rows per container
 * via a Supabase RPC (single DB transaction — no partial failures).
 *
 * Run migration 00305_rpc_create_shipment.sql in Supabase SQL editor first.
 */
export async function createShipmentWithContainers(opts: {
  shipmentNumber: string;
  vesselName?: string;          // optional — AI may not extract it
  voyageNumber?: string;
  originCountry?: string;
  importerId: string;
  supplierId: string;
  productName: string;
  etd: string;
  eta: string;
  containers: {
    containerNumber: string;
    containerType: string;
    portOfLoading?: string;     // optional — fallback handled in RPC
    portOfDestination?: string; // optional — fallback handled in RPC
    temperatureSetting?: string;
  }[];
}): Promise<CreateShipmentResult | null> {
  const supabase = createBrowserSupabaseClient();

  // Client-side fallbacks (second safety net — the RPC also applies these)
  const firstContainer = opts.containers[0];

  const { data, error } = await supabase.rpc("create_shipment_with_containers", {
    p_shipment_number: opts.shipmentNumber,
    p_vessel_name:     opts.vesselName     ?? "",
    p_voyage_number:   opts.voyageNumber   ?? "",
    p_origin_country:  opts.originCountry  ?? "",
    p_importer_id:     opts.importerId,
    p_supplier_id:     opts.supplierId,
    p_product_name:    opts.productName,
    p_etd:             opts.etd,
    p_eta:             opts.eta,
    p_containers: opts.containers.map((c) => ({
      container_number:    c.containerNumber,
      container_type:      c.containerType,
      // Fallback: if individual container port is blank, use first container's value
      port_of_loading:     c.portOfLoading     ?? firstContainer?.portOfLoading     ?? "",
      port_of_destination: c.portOfDestination ?? firstContainer?.portOfDestination ?? "",
      temperature_setting: c.temperatureSetting ?? "",
    })),
  });

  if (error) {
    console.error("[db] createShipmentWithContainers:", error.message);
    return null;
  }

  return data as CreateShipmentResult;
}

export interface Shipment {
  id: string;
  shipment_number: string;
  vessel_name: string | null       // nullable — AI may not extract it
  voyage_number: string | null;
  origin_port: string | null;      // nullable — falls back to first container port
  destination_port: string | null; // nullable — falls back to first container port
  origin_country: string | null;
  customs_agent_id: string | null; // UUID of assigned customs agent (role=customs)
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function createShipment(opts: {
  shipmentNumber: string;
  vesselName: string;
  voyageNumber?: string;
  originCountry?: string;
}): Promise<Shipment | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("shipments")
    .insert({
      shipment_number: opts.shipmentNumber,
      vessel_name: opts.vesselName,
      voyage_number: opts.voyageNumber ?? null,
      origin_country: opts.originCountry ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("[db] createShipment:", error.message);
    return null;
  }
  return data ?? null;
}

export async function createContainer(opts: {
  shipmentId: string;
  importerId: string;
  supplierId: string;
  containerNumber: string;
  containerType: string;
  productName: string;
  portOfLoading: string;
  portOfDestination: string;
  etd: string;
  eta: string;
  hsCode?: string;
  temperatureSetting?: string;
}): Promise<{ id: string } | null> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("containers")
    .insert({
      shipment_id: opts.shipmentId,
      importer_id: opts.importerId,
      supplier_id: opts.supplierId,
      container_number: opts.containerNumber,
      container_type: opts.containerType,
      product_name: opts.productName,
      port_of_loading: opts.portOfLoading,
      port_of_destination: opts.portOfDestination,
      etd: opts.etd,
      eta: opts.eta,
      hs_code: opts.hsCode ?? null,
      temperature_setting: opts.temperatureSetting ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[db] createContainer:", error.message);
    return null;
  }
  return data ?? null;
}

// ─── Customs Agent Assignment ──────────────────────────────────────────────

export async function getCustomsAgents(): Promise<Profile[]> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, company_name, role, phone, avatar_url, created_at, updated_at")
    .in("role", ["customs", "customs_agent"])   // support both during transition
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[db] getCustomsAgents:", error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}

export async function assignCustomsAgent(shipmentId: string, customsAgentId: string | null): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({ customs_agent_id: customsAgentId })
    .eq("id", shipmentId);

  if (error) {
    console.error("[db] assignCustomsAgent:", error.message);
    return false;
  }
  return true;
}

export async function getShipmentById(shipmentId: string): Promise<Shipment | null> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .single();

  if (error) {
    console.error("[db] getShipmentById:", error.message);
    return null;
  }
  return data ?? null;
}
