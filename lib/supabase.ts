/**
 * Portix — Supabase Client
 *
 * Two client factories following the @supabase/ssr pattern for Next.js App Router:
 *
 *   createBrowserSupabaseClient()  → use in Client Components ("use client")
 *   createServerSupabaseClient()   → use in Server Components, Route Handlers, Server Actions
 *
 * Why two clients?
 *   - Browser client reads/writes cookies via document.cookie
 *   - Server client reads/writes cookies via Next.js cookies() / headers()
 *   - Using the wrong one causes auth session loss between SSR and client
 *
 * Usage — Client Component:
 *   const supabase = createBrowserSupabaseClient()
 *   const { data, error } = await supabase.from('portix.v_containers').select('*')
 *
 * Usage — Server Component / Route Handler:
 *   import { cookies } from 'next/headers'
 *   const supabase = createServerSupabaseClient(cookies())
 *   const { data, error } = await supabase.from('portix.v_containers').select('*')
 */

import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr'
import { type ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

// ─── Environment variable validation ─────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env.local file.\n' +
    'See .env.local.example for the required format.'
  )
}

// ─── Database type definitions ────────────────────────────────────────────────
// Generated from Supabase → Settings → API → Generate TypeScript Types
// Replace with: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts
// Until then, using a minimal type for type safety without full type generation.

export type UserRole = 'importer' | 'supplier' | 'customs_agent'

export type ContainerStatus =
  | 'documents_missing'
  | 'waiting_customs_review'
  | 'rejected_documents'
  | 'ready_for_clearance'
  | 'in_clearance'
  | 'released'
  | 'claim_open'

export type DocumentType =
  | 'commercial_invoice'
  | 'packing_list'
  | 'phytosanitary_certificate'
  | 'bill_of_lading'
  | 'certificate_of_origin'
  | 'cooling_report'
  | 'insurance_certificate'
  | 'customs_declaration'
  | 'inspection_certificate'
  | 'dangerous_goods_declaration'
  | 'import_license_doc'
  | 'other'

export type DocumentStatus = 'missing' | 'uploaded' | 'under_review' | 'approved' | 'rejected'
export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'paid'
export type ClaimStatus = 'open' | 'under_review' | 'negotiation' | 'resolved' | 'closed'
export type ClaimType = 'damaged_goods' | 'missing_goods' | 'short_shipment' | 'quality_issue' | 'documentation_error' | 'delay' | 'other'
export type MediaType = 'image' | 'video' | 'document'
export type ContainerType = '20ft' | '40ft' | '40ft_hc' | 'reefer_40ft'
export type LicenseStatus = 'valid' | 'expiring_soon' | 'expired'

// Row types (mirrors portix schema tables)
export interface Profile {
  id: string
  email: string
  full_name: string
  company_name: string
  role: UserRole
  phone: string | null
  avatar_url: string | null
  supplier_org_id: string | null
  created_at: string
  updated_at: string
}

export interface Container {
  id: string
  container_number: string
  shipment_id: string
  importer_id: string
  supplier_id: string
  product_name: string
  hs_code: string | null
  container_type: ContainerType
  temperature_setting: string | null
  port_of_loading: string
  port_of_destination: string
  etd: string
  eta: string
  status: ContainerStatus
  docs_total: number
  docs_uploaded: number
  docs_approved: number
  docs_rejected: number
  notes: string | null
  created_at: string
  updated_at: string
}

// Enriched view type (portix.v_containers)
export interface ContainerView extends Container {
  shipment_number: string
  vessel_name: string
  origin_country: string | null
  importer_company: string
  supplier_company: string
}

export interface Document {
  id: string
  container_id: string
  document_type: DocumentType
  status: DocumentStatus
  storage_path: string | null
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  uploaded_by: string | null
  reviewed_by: string | null
  rejection_reason: string | null
  document_number: string | null
  issue_date: string | null
  notes: string | null
  uploaded_at: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface DocumentWithInternalNote extends Document {
  internal_note: string | null // Only available to customs_agent role
}

export interface Invoice {
  id: string
  invoice_number: string
  importer_id: string
  supplier_id: string
  container_id: string | null
  amount: number
  paid_amount: number
  currency: string
  status: InvoiceStatus
  invoice_date: string
  due_date: string | null
  swift_storage_path: string | null
  swift_file_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Claim {
  id: string
  container_id: string
  importer_id: string
  supplier_id: string
  claim_type: ClaimType
  description: string
  amount: number | null
  currency: string
  status: ClaimStatus
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface ImportLicenseView {
  id: string
  importer_id: string
  supplier_id: string
  license_number: string
  issue_date: string
  expiration_date: string
  storage_path: string | null
  file_name: string | null
  file_size_bytes: number | null
  notes: string | null
  created_at: string
  updated_at: string
  // Computed by portix.v_import_licenses view
  license_status: LicenseStatus
  days_remaining: number
  supplier_company: string | null
  importer_company: string | null
}

// ─── The 7 required document types (canonical list — matches seed trigger) ────

export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  'commercial_invoice',
  'packing_list',
  'phytosanitary_certificate',
  'bill_of_lading',
  'certificate_of_origin',
  'cooling_report',
  'insurance_certificate',
]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  commercial_invoice: 'Commercial Invoice',
  packing_list: 'Packing List',
  phytosanitary_certificate: 'Phytosanitary Certificate',
  bill_of_lading: 'Bill of Lading',
  certificate_of_origin: 'Certificate of Origin',
  cooling_report: 'Cooling Report',
  insurance_certificate: 'Insurance',
  customs_declaration: 'Customs Declaration',
  inspection_certificate: 'Inspection Certificate',
  dangerous_goods_declaration: 'Dangerous Goods Declaration',
  import_license_doc: 'Import License',
  other: 'Other',
}

export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  documents_missing: 'Documents Missing',
  waiting_customs_review: 'Waiting Customs Review',
  rejected_documents: 'Rejected Documents',
  ready_for_clearance: 'Ready for Clearance',
  in_clearance: 'In Clearance',
  released: 'Released',
  claim_open: 'Claim Open',
}

// ─── Storage bucket names ─────────────────────────────────────────────────────

export const STORAGE_BUCKETS = {
  documents: 'documents',
  cargoMedia: 'cargo-media',
  swiftDocuments: 'swift-documents',
  licenseFiles: 'license-files',
  avatars: 'avatars',
} as const

// ─── Storage path helpers ─────────────────────────────────────────────────────

export function getDocumentStoragePath(
  containerId: string,
  documentType: DocumentType,
  fileName: string
): string {
  return `${containerId}/${documentType}/${fileName}`
}

export function getCargoMediaStoragePath(containerId: string, fileName: string): string {
  return `${containerId}/${fileName}`
}

export function getSwiftStoragePath(invoiceId: string, fileName: string): string {
  return `${invoiceId}/${fileName}`
}

export function getLicenseStoragePath(
  importerId: string,
  licenseId: string,
  fileName: string
): string {
  return `${importerId}/${licenseId}/${fileName}`
}

// ─── Signed URL helper ────────────────────────────────────────────────────────

/**
 * Generate a signed URL for private Supabase Storage files.
 * Default expiry: 1 hour (3600 seconds).
 */
export async function getSignedUrl(
  supabase: ReturnType<typeof createBrowserClient>,
  bucket: string,
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds)

  if (error || !data?.signedUrl) {
    console.error('[Portix] Failed to generate signed URL:', error?.message)
    return null
  }

  return data.signedUrl
}

// ─── Browser client (Client Components) ──────────────────────────────────────

let browserClient: ReturnType<typeof createBrowserClient> | null = null

/**
 * Returns a singleton Supabase browser client.
 * Safe to call multiple times — returns the same instance.
 * Use ONLY in Client Components ("use client").
 */
export function createBrowserSupabaseClient() {
  if (browserClient) return browserClient

  browserClient = createBrowserClient(supabaseUrl!, supabaseAnonKey!)
  return browserClient
}

// ─── Server client (Server Components, Route Handlers, Server Actions) ────────

/**
 * Creates a Supabase server client that reads/writes auth cookies
 * via the Next.js cookies() API.
 *
 * Usage in Server Component:
 *   import { cookies } from 'next/headers'
 *   const supabase = createServerSupabaseClient(await cookies())
 *
 * Usage in Route Handler:
 *   import { cookies } from 'next/headers'
 *   const supabase = createServerSupabaseClient(await cookies())
 */
export function createServerSupabaseClient(cookieStore: ReadonlyRequestCookies) {
  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          // @ts-expect-error — ReadonlyRequestCookies.set is available at runtime
          cookieStore.set({ name, value, ...options })
        } catch {
          // Server Components cannot set cookies — this is expected in RSC context.
          // The middleware handles cookie refresh instead.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          // @ts-expect-error — ReadonlyRequestCookies.set is available at runtime
          cookieStore.set({ name, value: '', ...options })
        } catch {
          // Server Components cannot remove cookies — expected in RSC context.
        }
      },
    },
  })
}
