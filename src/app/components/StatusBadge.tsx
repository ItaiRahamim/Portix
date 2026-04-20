import type { DocumentStatus, ClearanceStatus, ShipmentStatus } from "../data/mockData";

const docStatusStyles: Record<DocumentStatus, string> = {
  missing: "bg-gray-200 text-gray-700 border-gray-300",
  uploaded: "bg-blue-100 text-blue-800 border-blue-200",
  "under-review": "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const docStatusLabels: Record<DocumentStatus, string> = {
  missing: "Missing",
  uploaded: "Uploaded",
  "under-review": "Under Review",
  approved: "Approved",
  rejected: "Rejected",
};

const clearanceStyles: Record<ClearanceStatus, string> = {
  "missing-documents": "bg-gray-200 text-gray-700 border-gray-300",
  "waiting-for-review": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "rejected-action-required": "bg-red-100 text-red-800 border-red-200",
  "ready-for-clearance": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "in-clearance": "bg-blue-100 text-blue-800 border-blue-200",
  released: "bg-green-100 text-green-800 border-green-200",
};

const clearanceLabels: Record<ClearanceStatus, string> = {
  "missing-documents": "Missing Documents",
  "waiting-for-review": "Waiting for Review",
  "rejected-action-required": "Rejected - Action Req.",
  "ready-for-clearance": "Ready for Clearance",
  "in-clearance": "In Clearance",
  released: "Released",
};

const shipmentStyles: Record<ShipmentStatus, string> = {
  "in-transit": "bg-blue-100 text-blue-800 border-blue-200",
  "at-port": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "customs-hold": "bg-orange-100 text-orange-800 border-orange-200",
  cleared: "bg-green-100 text-green-800 border-green-200",
  delivered: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const shipmentLabels: Record<ShipmentStatus, string> = {
  "in-transit": "In Transit",
  "at-port": "At Port",
  "customs-hold": "Customs Hold",
  cleared: "Cleared",
  delivered: "Delivered",
};

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${docStatusStyles[status]}`}>
      {docStatusLabels[status]}
    </span>
  );
}

export function ClearanceBadge({ status }: { status: ClearanceStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${clearanceStyles[status]}`}>
      {clearanceLabels[status]}
    </span>
  );
}

export function ShipmentBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${shipmentStyles[status]}`}>
      {shipmentLabels[status]}
    </span>
  );
}
