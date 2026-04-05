import type { ContainerStatus, DocumentStatus } from "@/lib/supabase";

const docStatusStyles: Record<DocumentStatus, string> = {
  missing: "bg-gray-200 text-gray-700 border-gray-300",
  uploaded: "bg-blue-100 text-blue-800 border-blue-200",
  under_review: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const docStatusLabels: Record<DocumentStatus, string> = {
  missing: "Missing",
  uploaded: "Uploaded",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
};

const containerStatusStyles: Record<ContainerStatus, string> = {
  documents_missing: "bg-gray-200 text-gray-700 border-gray-300",
  waiting_customs_review: "bg-yellow-100 text-yellow-800 border-yellow-200",
  rejected_documents: "bg-red-100 text-red-800 border-red-200",
  ready_for_clearance: "bg-emerald-100 text-emerald-800 border-emerald-200",
  in_clearance: "bg-blue-100 text-blue-800 border-blue-200",
  released: "bg-green-100 text-green-800 border-green-200",
  claim_open: "bg-orange-100 text-orange-800 border-orange-200",
};

const containerStatusLabels: Record<ContainerStatus, string> = {
  documents_missing: "Documents Missing",
  waiting_customs_review: "Waiting Customs Review",
  rejected_documents: "Rejected Documents",
  ready_for_clearance: "Ready for Clearance",
  in_clearance: "In Clearance",
  released: "Released",
  claim_open: "Claim Open",
};

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${docStatusStyles[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {docStatusLabels[status] ?? status}
    </span>
  );
}

export function ContainerStatusBadge({ status }: { status: ContainerStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${containerStatusStyles[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {containerStatusLabels[status] ?? status}
    </span>
  );
}

// Alias for backward-compat during transition
export const ClearanceBadge = ContainerStatusBadge;
