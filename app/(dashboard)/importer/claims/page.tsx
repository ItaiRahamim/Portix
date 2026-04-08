"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Eye, AlertTriangle, CheckCircle, Clock, MessageSquare } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { getClaims, getContainers, createClaim, getCurrentProfile } from "@/lib/db";
import type { Claim, ContainerView } from "@/lib/supabase";
import { toast } from "sonner";

type ClaimStatus = "open" | "under_review" | "negotiation" | "resolved" | "closed";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-600",
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  negotiation: "Negotiation",
  resolved: "Resolved",
  closed: "Closed",
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  damaged_goods: "Damaged Goods",
  missing_goods: "Missing Goods",
  short_shipment: "Short Shipment",
  quality_issue: "Quality Issue",
  documentation_error: "Documentation Error",
  delay: "Delay",
  other: "Other",
};

export default function ImporterClaimsPage() {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [claimType, setClaimType] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [c, containers] = await Promise.all([getClaims(), getContainers()]);
    setClaims(c);
    setContainers(containers);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const containerMap = new Map(containers.map((c) => [c.id, c]));
  const selectedContainer = containerMap.get(selectedContainerId);

  function resetForm() {
    setSelectedContainerId("");
    setClaimType("");
    setDescription("");
    setAmount("");
  }

  async function handleCreateClaim() {
    if (!selectedContainerId || !claimType || !description.trim()) return;
    setSaving(true);
    try {
      const profile = await getCurrentProfile();
      if (!profile) throw new Error("Not authenticated");
      const container = containerMap.get(selectedContainerId);
      if (!container) throw new Error("Container not found");

      const claim = await createClaim({
        containerId: selectedContainerId,
        supplierId: container.supplier_id,
        claimType,
        description: description.trim(),
        amount: amount ? parseFloat(amount) : undefined,
        currency: "USD",
      });

      if (!claim) throw new Error("Failed to create claim");
      toast.success(`Claim opened for ${container.container_number}.`);
      setCreateOpen(false);
      resetForm();
      loadData();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to create claim.");
    } finally {
      setSaving(false);
    }
  }

  const openCount = claims.filter((c) => c.status === "open").length;
  const underReviewCount = claims.filter((c) => c.status === "under_review").length;
  const negotiationCount = claims.filter((c) => c.status === "negotiation").length;
  const resolvedCount = claims.filter((c) => c.status === "resolved" || c.status === "closed").length;

  return (
    <DashboardLayout
      role="importer"
      title="Claims Management"
      subtitle="Open and track claims related to containers"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open Claims" value={openCount} icon={AlertTriangle} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Under Review" value={underReviewCount} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="In Negotiation" value={negotiationCount} icon={MessageSquare} color="text-orange-600" iconColor="text-orange-600" />
        <KPICard label="Resolved / Closed" value={resolvedCount} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Claims</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />New Claim
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading claims…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Claim Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No claims filed
                      </TableCell>
                    </TableRow>
                  ) : claims.map((claim) => {
                    const container = containerMap.get(claim.container_id);
                    return (
                      <TableRow
                        key={claim.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`/importer/claims/${claim.id}`)}
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          {container?.container_number ?? claim.container_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-sm">{container?.supplier_company ?? "—"}</TableCell>
                        <TableCell className="text-sm max-w-[130px] truncate">
                          {container?.product_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {claim.amount != null ? `$${claim.amount.toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[claim.status as ClaimStatus] ?? "bg-gray-100 text-gray-600"}`}>
                            {STATUS_LABELS[claim.status as ClaimStatus] ?? claim.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                          {new Date(claim.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button variant="outline" size="sm" onClick={() => router.push(`/importer/claims/${claim.id}`)}>
                              <Eye className="w-3.5 h-3.5 mr-1" />View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Claim Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetForm(); setCreateOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Claim</DialogTitle>
            <DialogDescription>Open a claim against a supplier for a specific container.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Container <span className="text-red-500">*</span></Label>
              <Select value={selectedContainerId} onValueChange={setSelectedContainerId}>
                <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                <SelectContent>
                  {containers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.container_number} — {c.product_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedContainer && (
                <p className="text-xs text-gray-500">
                  {selectedContainer.supplier_company} · {selectedContainer.product_name}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Claim Type <span className="text-red-500">*</span></Label>
              <Select value={claimType} onValueChange={setClaimType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="damaged_goods">Damaged Goods</SelectItem>
                  <SelectItem value="missing_goods">Missing Goods</SelectItem>
                  <SelectItem value="short_shipment">Short Shipment</SelectItem>
                  <SelectItem value="quality_issue">Quality Issue</SelectItem>
                  <SelectItem value="documentation_error">Documentation Error</SelectItem>
                  <SelectItem value="delay">Delay</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-red-500">*</span></Label>
              <Textarea
                placeholder="Describe the issue in detail…"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Claim Amount ($) <span className="text-gray-400 text-xs font-normal">optional</span></Label>
              <Input
                type="number"
                placeholder="0.00"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setCreateOpen(false); }} disabled={saving}>
              Cancel
            </Button>
            <Button disabled={!selectedContainerId || !claimType || !description.trim() || saving} onClick={handleCreateClaim}>
              <Plus className="w-4 h-4 mr-1.5" />{saving ? "Opening…" : "Open Claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
