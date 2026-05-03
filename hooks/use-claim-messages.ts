"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { getClaimMessages, type ClaimMessage } from "@/lib/db";

export function useClaimMessages(claimId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["claim-messages", claimId],
    queryFn: () => getClaimMessages(claimId),
    enabled: !!claimId,
  });

  useEffect(() => {
    if (!claimId) return;

    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel(`claim-messages-${claimId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "portix",          // must match the schema the table lives in
          table: "claim_messages",
          filter: `claim_id=eq.${claimId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          // postgres_changes payload.new is a raw DB row — it has no joined
          // sender:profiles data, so direct setQueryData would show generic
          // "Supplier"/"Importer" labels instead of real names.
          //
          // Strategy: if the sender is the current user, the message was already
          // added optimistically by the send handler (setQueryData with full data).
          // Deduplicate by id; for incoming messages from the other party,
          // invalidate so getClaimMessages (which joins profiles) re-fetches.
          const incomingId: string = payload.new?.id;
          const cached = queryClient.getQueryData<ClaimMessage[]>(["claim-messages", claimId]);
          const alreadyInCache = cached?.some((m) => m.id === incomingId);

          if (!alreadyInCache) {
            // Refetch to get the row with sender.full_name joined
            queryClient.invalidateQueries({ queryKey: ["claim-messages", claimId] });
          }
          // If already in cache (own optimistic message), do nothing — avoid duplicate
        }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: any) => {
        if (status === "CHANNEL_ERROR") {
          console.error(`[useClaimMessages] Realtime channel error for claim ${claimId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [claimId, queryClient]);

  return query;
}
