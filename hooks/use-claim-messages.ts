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
          // Push the new row directly into the query cache — no network round-trip.
          // This makes the message appear immediately for both sender and receiver.
          const newMessage = payload.new as ClaimMessage;
          queryClient.setQueryData<ClaimMessage[]>(
            ["claim-messages", claimId],
            (prev) => {
              if (!prev) return [newMessage];
              // Deduplicate in case an optimistic update already added this row
              const alreadyExists = prev.some((m) => m.id === newMessage.id);
              return alreadyExists ? prev : [...prev, newMessage];
            }
          );
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
