"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Sparkles, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

interface ClaimOverviewBlockProps {
  claimId: string;
  summary: string | null;
  /** Pass claim.last_summary_at so the timestamp reflects the AI run, not a generic DB update. */
  updatedAt: string | null;
}

export function ClaimOverviewBlock({ claimId, summary, updatedAt }: ClaimOverviewBlockProps) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const supabase = createBrowserSupabaseClient();

      const { error } = await supabase.functions.invoke("generate-claim-summary", {
        body: { claim_id: claimId },
      });

      if (error) {
        console.error("[ClaimOverviewBlock] invoke error:", error);
        toast.error("Failed to generate summary. Check the Edge Function logs.");
        return;
      }

      // Pull the freshly-saved summary into the UI immediately
      await queryClient.invalidateQueries({ queryKey: ["claim", claimId] });
      toast.success("AI summary updated.");
    } catch (err) {
      console.error("[ClaimOverviewBlock] unexpected error:", err);
      toast.error("Unexpected error — see console for details.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            AI Claim Overview
          </CardTitle>

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
            disabled={generating}
            onClick={handleGenerate}
          >
            <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating…" : "Generate Now"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {summary ? (
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">
            No AI summary yet. Click &ldquo;Generate Now&rdquo; to create one, or wait for the
            nightly automated run.
          </p>
        )}

        {updatedAt && (
          <p className="text-xs text-gray-400">
            Last generated: {format(new Date(updatedAt), "MMM d, yyyy 'at' HH:mm")}
          </p>
        )}

        <p className="text-[10px] text-gray-300 border-t pt-2">
          Powered by Google Gemini · Analyses the full claim message history
        </p>
      </CardContent>
    </Card>
  );
}
