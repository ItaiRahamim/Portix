"use client";

import { useQuery } from "@tanstack/react-query";
import { getClaims, getClaimById } from "@/lib/db";

export function useClaims() {
  return useQuery({
    queryKey: ["claims"],
    queryFn: getClaims,
  });
}

export function useClaim(claimId: string) {
  return useQuery({
    queryKey: ["claim", claimId],
    queryFn: () => getClaimById(claimId),
    enabled: !!claimId,
  });
}
