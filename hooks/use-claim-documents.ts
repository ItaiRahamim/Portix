"use client";

import { useQuery } from "@tanstack/react-query";
import { getClaimDocuments } from "@/lib/db";

export function useClaimDocuments(claimId: string) {
  return useQuery({
    queryKey: ["claim-documents", claimId],
    queryFn: () => getClaimDocuments(claimId),
    enabled: !!claimId,
  });
}
