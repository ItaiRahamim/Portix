"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle } from "lucide-react";
import { getCustomsAgents, assignCustomsAgent } from "@/lib/db";
import type { Profile } from "@/lib/supabase";
import { toast } from "sonner";

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
  const [agents, setAgents] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  // Radix Select forbids empty-string values — use a sentinel for "unassigned"
  const NONE = "__none__";
  const [selectedId, setSelectedId] = useState(currentAgentId ?? NONE);

  useEffect(() => {
    async function loadAgents() {
      const data = await getCustomsAgents();
      setAgents(data);
      setLoading(false);
    }
    loadAgents();
  }, []);

  async function handleAssign(agentId: string) {
    setUpdating(true);
    const realId = agentId === NONE ? null : agentId;
    const success = await assignCustomsAgent(shipmentId, realId);
    setUpdating(false);

    if (success) {
      setSelectedId(agentId);
      toast.success(realId ? "Customs agent assigned" : "Customs agent unassigned");
      onAssigned?.();
    } else {
      toast.error("Failed to assign customs agent");
    }
  }

  const currentAgent = agents.find((a) => a.id === currentAgentId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" />
          Assign Customs Agent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentAgent && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-gray-900">{currentAgent.full_name}</p>
              <p className="text-gray-500 text-xs">{currentAgent.email}</p>
            </div>
          </div>
        )}

        <Select
          value={selectedId}
          onValueChange={handleAssign}
          disabled={loading || updating}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loading ? "Loading agents…" : "Select or change agent"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              <span className="text-gray-500">— Unassigned —</span>
            </SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <div className="flex items-center gap-2">
                  <span>{agent.full_name}</span>
                  {agent.id === currentAgentId && (
                    <Badge variant="secondary" className="text-[10px]">Assigned</Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-[11px] text-gray-400 mt-2">
          Only the assigned agent will see this shipment's containers in their queue.
        </p>
      </CardContent>
    </Card>
  );
}
