"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle, Loader2 } from "lucide-react";
import { getCustomsAgents, assignCustomsAgent } from "@/lib/db";
import type { Profile } from "@/lib/supabase";
import { toast } from "sonner";

// Radix Select forbids empty-string values — sentinel represents "unassigned"
const NONE = "__none__";

interface CustomsAgentSelectorProps {
  shipmentId: string;
  currentAgentId: string | null;
  onAssigned?: () => void;
}

export function CustomsAgentSelector({
  shipmentId,
  currentAgentId,
  onAssigned,
}: CustomsAgentSelectorProps) {
  const router = useRouter();
  const [agents, setAgents]       = useState<Profile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  // Local selection state — only persisted to DB on explicit button click
  const [selectedId, setSelectedId] = useState<string>(currentAgentId ?? NONE);

  // Keep local state in sync if the parent re-fetches and passes a new currentAgentId
  useEffect(() => {
    setSelectedId(currentAgentId ?? NONE);
  }, [currentAgentId]);

  useEffect(() => {
    getCustomsAgents().then((data) => {
      setAgents(data);
      setLoading(false);
    });
  }, []);

  async function handleAssign() {
    setIsUpdating(true);
    const realId = selectedId === NONE ? null : selectedId;
    const success = await assignCustomsAgent(shipmentId, realId);
    setIsUpdating(false);

    if (success) {
      toast.success(realId ? "Customs agent assigned successfully" : "Customs agent unassigned");
      router.refresh();   // sync server state without a full reload
      onAssigned?.();
    } else {
      toast.error("Failed to assign customs agent. Please try again.");
    }
  }

  const isDirty = selectedId !== (currentAgentId ?? NONE);
  const currentAgent = agents.find((a) => a.id === currentAgentId);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" />
          Assign Customs Agent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Currently assigned agent badge */}
        {currentAgent && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-gray-900">{currentAgent.full_name}</p>
              <p className="text-gray-500 text-xs">{currentAgent.email}</p>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">Assigned</Badge>
          </div>
        )}

        {/* Dropdown + Assign button row */}
        <div className="flex gap-2 items-center">
          <Select
            value={selectedId}
            onValueChange={setSelectedId}   // local state only — no DB call here
            disabled={loading || isUpdating}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={loading ? "Loading agents…" : "Select a customs agent"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                <span className="text-gray-400">— Unassigned —</span>
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            disabled={!isDirty || isUpdating || loading}
            onClick={handleAssign}
            className="shrink-0"
          >
            {isUpdating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Assigning…
              </>
            ) : (
              "Assign"
            )}
          </Button>
        </div>

        <p className="text-[11px] text-gray-400">
          Only the assigned agent will see this shipment&apos;s containers in their queue.
        </p>
      </CardContent>
    </Card>
  );
}
