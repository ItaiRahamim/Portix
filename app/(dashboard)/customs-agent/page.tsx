"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Ship, XCircle, CheckCircle, Clock, Eye, Filter } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { ContainerStatusBadge } from "@/components/status-badge";
import { getContainersForCustomsAgent } from "@/lib/db";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import type { ContainerView, ContainerStatus } from "@/lib/supabase";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function CustomsAgentDashboardPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to "all" — customs agents see every container in their assigned shipments
  const [statusFilter, setStatusFilter] = useState<ContainerStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);

  const loadContainers = useCallback(async () => {
    setLoading(true);
    // Resolve current user first so we can scope to assigned shipments only.
    // getContainersForCustomsAgent filters by shipments.customs_agent_id = agentId,
    // ensuring unassigned containers are never shown (and can't crash the detail page).
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const data = await getContainersForCustomsAgent(user.id);
    setContainers(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadContainers(); }, [loadContainers]);

  const filtered = statusFilter === "all"
    ? containers
    : containers.filter((c) => c.status === statusFilter);

  const containersAwaitingReview = containers.filter(
    (c) => c.docs_uploaded - c.docs_approved - c.docs_rejected > 0
  ).length;
  const totalPendingDocs = containers.reduce(
    (sum, c) => sum + Math.max(0, c.docs_uploaded - c.docs_approved - c.docs_rejected),
    0
  );
  const totalRejectedDocs = containers.reduce((sum, c) => sum + c.docs_rejected, 0);
  const containersReady = containers.filter(
    (c) => c.status === "ready_for_clearance" || c.status === "released"
  ).length;

  return (
    <DashboardLayout
      role="customs-agent"
      title="Container Review Queue"
      subtitle="Review and approve documents per container for import clearance"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Containers Awaiting Review" value={containersAwaitingReview} icon={Ship} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Documents Pending Review" value={totalPendingDocs} icon={Clock} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Rejected Documents" value={totalRejectedDocs} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Containers Ready for Clearance" value={containersReady} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Container Review List</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1.5">
              <Filter className="w-4 h-4" /> Filters
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ContainerStatus | "all")}>
                <SelectTrigger className="w-[240px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="waiting_customs_review">Waiting Customs Review</SelectItem>
                  <SelectItem value="documents_missing">Documents Missing</SelectItem>
                  <SelectItem value="rejected_documents">Rejected Documents</SelectItem>
                  <SelectItem value="ready_for_clearance">Ready for Clearance</SelectItem>
                  <SelectItem value="in_clearance">In Clearance</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
              {statusFilter !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 h-9"
                  onClick={() => setStatusFilter("all")}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">Loading containers…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Shipment</TableHead>
                    <TableHead>Importer</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-center">Pending Review</TableHead>
                    <TableHead className="text-center">Rejected</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10 text-gray-400">
                        {containers.length === 0
                          ? "No containers assigned to you yet"
                          : "No containers match the current filter"}
                      </TableCell>
                    </TableRow>
                  ) : filtered.map((c) => {
                    const docsPending = Math.max(0, c.docs_uploaded - c.docs_approved - c.docs_rejected);
                    // Containers with no uploaded docs can be viewed but not reviewed yet
                    const canReview = c.docs_uploaded > 0;
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`/customs-agent/containers/${c.id}`)}
                      >
                        <TableCell className="whitespace-nowrap font-medium">{c.container_number}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipment_number}</TableCell>
                        <TableCell className="text-sm">{c.importer_company}</TableCell>
                        <TableCell className="text-sm">{c.supplier_company}</TableCell>
                        <TableCell className="text-sm max-w-[130px] truncate">{c.product_name}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(c.eta)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${c.docs_total > 0 ? (c.docs_uploaded / c.docs_total) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{c.docs_uploaded}/{c.docs_total}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {docsPending > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs">
                              {docsPending}
                            </span>
                          ) : <span className="text-gray-400 text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {c.docs_rejected > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">
                              {c.docs_rejected}
                            </span>
                          ) : <span className="text-gray-400 text-sm">—</span>}
                        </TableCell>
                        <TableCell><ContainerStatusBadge status={c.status} /></TableCell>
                        <TableCell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant={canReview ? "outline" : "ghost"}
                              size="sm"
                              onClick={() => router.push(`/customs-agent/containers/${c.id}`)}
                              className={canReview ? "" : "text-gray-400"}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              {canReview ? "Review" : "View"}
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
    </DashboardLayout>
  );
}
