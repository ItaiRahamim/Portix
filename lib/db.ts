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
    .maybeSingle();   // .single() throws when RLS returns 0 rows; maybeSingle() returns null safely

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
    .maybeSingle();   // .single() throws "Cannot coerce the result to a single JSON object" when RLS blocks; maybeSingle() returns null

  if (error) {
    console.error("[db] getShipmentById:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Fetch containers visible to a specific customs agent.
 * Explicitly scopes to shipments where customs_agent_id = agentId, so
 * unassigned containers can never appear in the review queue.
 */
export async function getContainersForCustomsAgent(agentId: string): Promise<ContainerView[]> {
  const supabase = createBrowserSupabaseClient();

  // Step 1 — which shipments are assigned to this agent?
  const { data: assignedShipments, error: shipErr } = await supabase
    .from("shipments")
    .select("id")
    .eq("customs_agent_id", agentId);

  if (shipErr) {
    console.error("[db] getContainersForCustomsAgent (shipments):", shipErr.message);
    return [];
  }

  const shipmentIds = (assignedShipments ?? []).map((s: { id: string }) => s.id);

  if (shipmentIds.length === 0) return [];   // no assigned shipments → empty queue

  // Step 2 — containers in those shipments (RLS is an additional guard)
  const { data, error } = await supabase
    .from("v_containers")
    .select("*")
    .in("shipment_id", shipmentIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[db] getContainersForCustomsAgent (containers):", error.message);
    return [];
  }
  return data ?? [];
}


// ─── Accounts Module (Simplified — company_name based) ───────────────────────
//
// Partners are discovered via containers (supplier_id / importer_id).
// Balances come from portix.account_transactions (simple table, no FK to companies).
// The unique key for a "company" is profiles.company_name (plain TEXT).

// ── Types ─────────────────────────────────────────────────────────────────────

export type TxnType   = 'invoice' | 'payment' | 'credit';
export type TxnStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface AccountTransaction {
  id: string;
  created_at: string;
  uploader_user_id: string;
  uploader_company_name: string;
  target_company_name: string;
  /** UUID of the target's representative profile — set on all new rows, null on legacy rows */
  target_profile_id: string | null;
  type: TxnType;
  amount: number;
  currency: string;
  reference_number: string | null;
  notes: string | null;
  status: TxnStatus;
  document_storage_path: string | null;
  document_file_name: string | null;
  transaction_date: string;
  due_date: string | null;
  container_id: string | null;
  /** Joined from portix.containers — present when container_id is set */
  container?: { container_number: string } | null;
}

/** One row per counterpart company in the Accounts list. */
export interface PartnerAccount {
  /** UUID of a representative profile for this partner company — used for URL routing */
  partner_id: string;
  company_name: string;
  /** role of the counterpart users (supplier, importer, customs_agent) */
  partner_role: string;
  total_invoiced: number;
  total_paid: number;
  total_credits: number;
  /** outstanding balance across the relationship */
  current_balance: number;
}

// ── Helper: get current user's company_name ───────────────────────────────────

export async function getMyCompanyName(): Promise<string | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('company_name')
    .eq('id', user.id)
    .single();

  if (error || !data?.company_name) {
    console.error('[db] getMyCompanyName:', error?.message ?? 'no company_name');
    return null;
  }
  return data.company_name as string;
}

// ── Partner discovery via containers ─────────────────────────────────────────

/**
 * Returns all partner accounts (counterpart companies) discovered through
 * shared containers, enriched with their current balance from account_transactions.
 *
 * Works even when the balance is $0 — partners appear as soon as a container
 * linking the two companies exists.
 */
export async function getPartnerAccounts(): Promise<PartnerAccount[]> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // 1. Get my profile (company_name + role)
  const { data: myProfile, error: profileErr } = await supabase
    .from('profiles')
    .select('company_name, role')
    .eq('id', user.id)
    .single();

  if (profileErr || !myProfile?.company_name) {
    console.error('[db] getPartnerAccounts (myProfile):', profileErr?.message ?? 'no company_name');
    return [];
  }
  const myCompanyName = myProfile.company_name as string;
  const myRole = myProfile.role as string;

  // 2. Get all user IDs in my company (same company_name — handles multi-user companies)
  const { data: myUsers, error: usersErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('company_name', myCompanyName);

  if (usersErr || !myUsers?.length) {
    console.error('[db] getPartnerAccounts (myUsers):', usersErr?.message);
    return [];
  }
  const myUserIds = myUsers.map((u: { id: string }) => u.id);

  // 3a. Find counterpart user IDs via containers (supplier ↔ importer FKs)
  const [asSupplier, asImporter] = await Promise.all([
    supabase.from('containers').select('importer_id').in('supplier_id', myUserIds),
    supabase.from('containers').select('supplier_id').in('importer_id', myUserIds),
  ]);

  const counterpartIdSet = new Set<string>();
  for (const c of asSupplier.data ?? []) {
    if (c.importer_id) counterpartIdSet.add(c.importer_id);
  }
  for (const c of asImporter.data ?? []) {
    if (c.supplier_id) counterpartIdSet.add(c.supplier_id);
  }

  // 3b. Customs-agent discovery via explicit FK: shipments.customs_agent_id
  //     This is the ONLY correct way — never infer from status or UI states.
  // NOTE: migration 00312 stores customs agents as role='customs' in the DB.
  //       Guard both values for safety.
  const isCustomsAgent = myRole === 'customs' || myRole === 'customs_agent';

  if (myRole === 'importer') {
    // Importer → customs agent:
    //   containers.importer_id = me → shipments.customs_agent_id
    const { data: myContainers } = await supabase
      .from('containers')
      .select('shipment_id')
      .in('importer_id', myUserIds);

    const shipmentIds = (myContainers ?? [])
      .map((c: { shipment_id: string }) => c.shipment_id)
      .filter(Boolean);

    if (shipmentIds.length > 0) {
      const { data: shipments } = await supabase
        .from('shipments')
        .select('customs_agent_id')
        .in('id', shipmentIds)
        .not('customs_agent_id', 'is', null);

      for (const s of shipments ?? []) {
        if (s.customs_agent_id) counterpartIdSet.add(s.customs_agent_id);
      }
    }
  } else if (isCustomsAgent) {
    // Customs agent → importer:
    //   shipments.customs_agent_id = me → containers.importer_id
    const { data: myShipments } = await supabase
      .from('shipments')
      .select('id')
      .in('customs_agent_id', myUserIds);

    const shipmentIds = (myShipments ?? [])
      .map((s: { id: string }) => s.id)
      .filter(Boolean);

    if (shipmentIds.length > 0) {
      const { data: linkedContainers } = await supabase
        .from('containers')
        .select('importer_id')
        .in('shipment_id', shipmentIds);

      for (const c of linkedContainers ?? []) {
        if (c.importer_id) counterpartIdSet.add(c.importer_id);
      }
    }
  }

  // Remove self (edge case)
  for (const id of myUserIds) counterpartIdSet.delete(id);

  if (counterpartIdSet.size === 0) return [];

  // 4. Resolve counterpart user IDs → company_name + role
  const { data: counterpartProfiles, error: cpErr } = await supabase
    .from('profiles')
    .select('id, company_name, role')
    .in('id', [...counterpartIdSet]);

  if (cpErr || !counterpartProfiles?.length) {
    console.error('[db] getPartnerAccounts (counterpartProfiles):', cpErr?.message);
    return [];
  }

  // 5. Deduplicate by company_name — track a representative UUID + role per company
  const partnerMap = new Map<string, { role: string; id: string }>();
  for (const p of counterpartProfiles) {
    if (p.company_name && !partnerMap.has(p.company_name)) {
      partnerMap.set(p.company_name, { role: p.role as string, id: p.id });
    }
  }
  // Remove own company from partners (extra guard)
  partnerMap.delete(myCompanyName);

  const partnerNames = [...partnerMap.keys()];
  if (partnerNames.length === 0) return [];

  // 6. Fetch all account_transactions involving my company (both as uploader and target)
  //    Use two queries to avoid complex OR filter issues with text values
  const [asUploaderRes, asTargetRes] = await Promise.all([
    supabase
      .from('account_transactions')
      .select('*')
      .eq('uploader_company_name', myCompanyName),
    supabase
      .from('account_transactions')
      .select('*')
      .eq('target_company_name', myCompanyName),
  ]);

  // Merge + deduplicate by id
  const allTxnMap = new Map<string, AccountTransaction>();
  for (const t of [...(asUploaderRes.data ?? []), ...(asTargetRes.data ?? [])]) {
    allTxnMap.set(t.id, t as AccountTransaction);
  }
  const allTxns = [...allTxnMap.values()];

  // 7. Compute balance per partner
  return partnerNames.map((partnerName) => {
    const info = partnerMap.get(partnerName) ?? { role: 'importer', id: '' };

    // Transactions where I'm the uploader to this partner
    const myTxns = allTxns.filter(
      (t) => t.uploader_company_name === myCompanyName && t.target_company_name === partnerName
    );
    // Transactions where the partner uploaded to me
    const theirTxns = allTxns.filter(
      (t) => t.uploader_company_name === partnerName && t.target_company_name === myCompanyName
    );

    // Invoices I issued (money partner owes me)
    const invoicesIssued = myTxns
      .filter((t) => t.type === 'invoice')
      .reduce((s, t) => s + t.amount, 0);

    // Invoices partner issued to me (money I owe them)
    const invoicesOwed = theirTxns
      .filter((t) => t.type === 'invoice')
      .reduce((s, t) => s + t.amount, 0);

    // Approved payments partner made to me (reduces what they owe)
    const paymentsReceived = theirTxns
      .filter((t) => t.type === 'payment' && t.status === 'approved')
      .reduce((s, t) => s + t.amount, 0);

    // Approved payments I made to them (reduces what I owe)
    const paymentsMade = myTxns
      .filter((t) => t.type === 'payment' && t.status === 'approved')
      .reduce((s, t) => s + t.amount, 0);

    // Credits I issued (reduces what partner owes me)
    const creditsIssued = myTxns
      .filter((t) => t.type === 'credit')
      .reduce((s, t) => s + t.amount, 0);

    // Credits partner issued to me (reduces what I owe)
    const creditsReceived = theirTxns
      .filter((t) => t.type === 'credit')
      .reduce((s, t) => s + t.amount, 0);

    // Net balance from MY perspective:
    // positive = they owe me; negative = I owe them
    const current_balance =
      invoicesIssued - paymentsReceived - creditsIssued
      - invoicesOwed + paymentsMade + creditsReceived;

    // For the UI display, total_invoiced = all invoices across the relationship
    const total_invoiced = invoicesIssued + invoicesOwed;
    const total_paid = paymentsReceived + paymentsMade;
    const total_credits = creditsIssued + creditsReceived;

    return {
      partner_id: info.id,
      company_name: partnerName,
      partner_role: info.role,
      total_invoiced,
      total_paid,
      total_credits,
      current_balance,
    } as PartnerAccount;
  });
}

// ── Fetch transaction ledger for one partner ──────────────────────────────────

/**
 * Returns all transactions between my company and the partner company.
 * Queries by uploader_user_id (UUID) and falls back to company name strings
 * so both new (UUID-linked) and legacy rows are returned.
 */
export async function getPartnerTransactions(
  myUserIds: string[],
  myCompanyName: string,
  partnerUserIds: string[],
  partnerCompanyName: string,
): Promise<AccountTransaction[]> {
  const supabase = createBrowserSupabaseClient();

  const SELECT = '*, container:container_id(container_number)';

  if (!myUserIds.length || !partnerUserIds.length) return [];

  const [asUploaderRes, asTargetRes] = await Promise.all([
    // Rows I uploaded (my user IDs are uploaders)
    supabase.from('account_transactions').select(SELECT).in('uploader_user_id', myUserIds),
    // Rows partner uploaded (partner user IDs are uploaders)
    supabase.from('account_transactions').select(SELECT).in('uploader_user_id', partnerUserIds),
  ]);

  const partnerUserIdSet = new Set(partnerUserIds);
  const myUserIdSet = new Set(myUserIds);

  // Keep only transactions that involve the other party (UUID match or legacy name match)
  const myUploads = (asUploaderRes.data ?? []).filter(
    (t: AccountTransaction) =>
      (t.target_profile_id != null && partnerUserIdSet.has(t.target_profile_id)) ||
      t.target_company_name === partnerCompanyName
  );
  const theirUploads = (asTargetRes.data ?? []).filter(
    (t: AccountTransaction) =>
      (t.target_profile_id != null && myUserIdSet.has(t.target_profile_id)) ||
      t.target_company_name === myCompanyName
  );

  const txnMap = new Map<string, AccountTransaction>();
  for (const t of [...myUploads, ...theirUploads]) {
    txnMap.set(t.id, t as AccountTransaction);
  }

  return [...txnMap.values()].sort(
    (a, b) =>
      new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime() ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// ── Create a transaction ──────────────────────────────────────────────────────

/**
 * Upload-first flow:
 *   1. Upload file to swift-documents bucket (call uploadToSwiftBucket in the UI)
 *   2. Call createAccountTransaction with the returned storagePath
 *
 * This keeps the DB row and the file in sync — no orphaned transactions.
 */
export async function createAccountTransaction(opts: {
  myCompanyName: string;
  partnerCompanyName: string;
  /** UUID of the partner's representative profile — stored as target_profile_id */
  targetProfileId?: string;
  type: TxnType;
  amount: number;
  currency?: string;
  referenceNumber?: string;
  notes?: string;
  transactionDate?: string;
  dueDate?: string;
  documentStoragePath: string;   // required — upload first, then call this
  documentFileName: string;
  /** For payments only: links to the invoice being offset */
  parentTransactionId?: string;
}): Promise<AccountTransaction | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Payments are pending until the counterpart approves; everything else is active
  const initialStatus: TxnStatus = opts.type === 'payment' ? 'pending' : 'approved';

  // Direction:
  //   invoice → uploader is the creditor (issuing to partner)
  //   payment → uploader is the debtor (paying to partner)
  //   credit  → uploader is the creditor (giving credit to partner)
  const uploaderCompanyName = opts.myCompanyName;
  const targetCompanyName   = opts.partnerCompanyName;

  const { data, error } = await supabase
    .from('account_transactions')
    .insert({
      uploader_user_id:      user.id,
      uploader_company_name: uploaderCompanyName,
      target_company_name:   targetCompanyName,
      target_profile_id:     opts.targetProfileId ?? null,
      type:                  opts.type,
      status:                initialStatus,
      amount:                opts.amount,
      currency:              opts.currency ?? 'USD',
      reference_number:      opts.referenceNumber ?? null,
      notes:                 opts.notes ?? null,
      transaction_date:      opts.transactionDate ?? new Date().toISOString().slice(0, 10),
      due_date:              opts.dueDate ?? null,
      document_storage_path: opts.documentStoragePath,
      document_file_name:    opts.documentFileName,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[db] createAccountTransaction:', error.message);
    return null;
  }
  return data as AccountTransaction;
}

// ── Approve a payment ─────────────────────────────────────────────────────────

/**
 * Only the target company (creditor receiving the payment) should call this.
 * RLS enforces this at the DB level.
 */
export async function approveAccountTransaction(id: string): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from('account_transactions')
    .update({ status: 'approved' })
    .eq('id', id)
    .in('status', ['draft', 'pending']); // safety guard — cannot approve already-approved/rejected rows

  if (error) {
    console.error('[db] approveAccountTransaction:', error.message);
    return false;
  }
  return true;
}

// ── Reject a payment ──────────────────────────────────────────────────────────

export async function rejectAccountTransaction(id: string): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase
    .from('account_transactions')
    .update({ status: 'rejected' as TxnStatus })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) {
    console.error('[db] rejectAccountTransaction:', error.message);
    return false;
  }
  return true;
}

// ─── Draft transaction for new order (Make.com OCR amount) ───────────────────

/**
 * Inserts a draft invoice transaction after a new shipment is created.
 * Called once per container when Make.com returns a totalAmount during AI auto-fill.
 *
 * The supplier is the uploader (creditor); the importer is the target (debtor).
 */
export async function createOrderDraftTransaction(opts: {
  supplierProfileId: string;
  importerProfileId: string;
  amount: number;
  containerId: string;
  containerNumber: string;
}): Promise<boolean> {
  const supabase = createBrowserSupabaseClient();

  const [{ data: supplierProfile }, { data: importerProfile }] = await Promise.all([
    supabase.from('profiles').select('company_name').eq('id', opts.supplierProfileId).single(),
    supabase.from('profiles').select('company_name').eq('id', opts.importerProfileId).single(),
  ]);

  if (!supplierProfile?.company_name || !importerProfile?.company_name) return false;

  const { error } = await supabase
    .from('account_transactions')
    .insert({
      uploader_user_id:      opts.supplierProfileId,
      uploader_company_name: supplierProfile.company_name,
      target_company_name:   importerProfile.company_name,
      target_profile_id:     opts.importerProfileId,
      type:                  'invoice',
      status:                'draft',
      amount:                opts.amount,
      currency:              'USD',
      notes:                 `Auto-drafted via Make.com OCR`,
      container_id:          opts.containerId,
      document_storage_path: null,
      document_file_name:    null,
    });

  if (error) {
    console.error('[db] createOrderDraftTransaction:', error.message);
    return false;
  }
  return true;
}

// ─── Invoice OCR mock + draft creation ───────────────────────────────────────

/**
 * Mock OCR: returns a deterministic amount derived from the file name/size
 * so each document produces a unique (but reproducible) number for demo purposes.
 * Replace with a real OCR/AI call when ready.
 */
export function mockInvoiceOCR(_fileUrl: string, fileSizeBytes: number): number {
  // Produce a plausible invoice amount between $1,000 and $50,000
  return Math.round((1000 + (fileSizeBytes % 49000)) * 100) / 100;
}

/**
 * Creates a draft account_transaction linked to a document upload.
 * Called automatically when a commercial_invoice is uploaded to a container.
 * The supplier reviews and promotes it to 'pending' (then importer approves).
 */
export async function createDraftInvoiceTransaction(opts: {
  /** Storage path of the uploaded commercial invoice */
  documentStoragePath: string;
  documentFileName: string;
  fileSizeBytes: number;
  /** Container's importer_id — used to look up their company_name */
  importerProfileId: string;
}): Promise<AccountTransaction | null> {
  const supabase = createBrowserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Resolve my company name (the supplier uploading the invoice)
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('company_name')
    .eq('id', user.id)
    .single();

  // Resolve the importer's company name
  const { data: importerProfile } = await supabase
    .from('profiles')
    .select('company_name')
    .eq('id', opts.importerProfileId)
    .single();

  if (!myProfile?.company_name || !importerProfile?.company_name) return null;

  const amount = mockInvoiceOCR(opts.documentStoragePath, opts.fileSizeBytes);

  const { data, error } = await supabase
    .from('account_transactions')
    .insert({
      uploader_user_id:      user.id,
      uploader_company_name: myProfile.company_name,
      target_company_name:   importerProfile.company_name,
      target_profile_id:     opts.importerProfileId,
      type:                  'invoice',
      status:                'draft',
      amount,
      currency:              'USD',
      notes:                 'Auto-created from commercial invoice upload — review before sending',
      document_storage_path: opts.documentStoragePath,
      document_file_name:    opts.documentFileName,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[db] createDraftInvoiceTransaction:', error.message);
    return null;
  }
  return data as AccountTransaction;
}
