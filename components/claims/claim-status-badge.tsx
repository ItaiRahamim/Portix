import { cn } from "@/lib/utils";
import type { ClaimStatus } from "@/lib/supabase";

const statusStyles: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  under_review: "bg-yellow-100 text-yellow-800 border-yellow-200",
  negotiation: "bg-orange-100 text-orange-800 border-orange-200",
  resolved: "bg-green-100 text-green-800 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
};

const statusLabels: Record<ClaimStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  negotiation: "Negotiation",
  resolved: "Resolved",
  closed: "Closed",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        statusStyles[status] ?? "bg-gray-100 text-gray-600 border-gray-200"
      )}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}
