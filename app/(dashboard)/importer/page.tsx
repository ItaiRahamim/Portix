"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Ship, FileWarning, Clock, XCircle, CheckCircle, AlertTriangle, Eye, Filter, Plus,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { ContainerStatusBadge } from "@/components/status-badge";
import { NewShipmentModal } from "@/components/new-shipment-modal";
import { getContainers } from "@/lib/db";
import type { ContainerView, ContainerStatus } from "@/lib/supabase";

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function ImporterDashboardPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ContainerStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);

  const loadContainers = useCallback(async () => {
    setLoading(true);
    const data = await getContainers();
    setContainers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  const uniqueSuppliers = Array.from(
    new Map(containers.map((c) => [c.supplier_id, c.supplier_company])).entries()
  );

  const filtered = containers.filter((c) => {
    if (supplierFilter !== "all" && c.supplier_id !== supplierFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  const activeContainers = containers.filter((c) => c.status !== "released").length;
  const waitingDocs = containers.filter((c) => c.status === "documents_missing").length;
  const waitingReview = containers.filter((c) => c.status === "waiting_customs_review").length;
  const rejectedContainers = containers.filter((c) => c.status === "rejected_documents").length;
  const readyOrReleased = containers.filter(
    (c) => c.status === "ready_for_clearance" || c.status === "released"
  ).length;

  return (
    <DashboardLayout
      role="importer"
      title="Container Control"
      subtitle="Monitor all containers, documents, and customs clearance statuses"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard label="Active Containers" value={activeContainers} icon={Ship} iconColor="text-blue-600" />
        <KPICard label="Waiting for Documents" value={waitingDocs} icon={FileWarning} color="text-gray-600" iconColor="text-gray-500" />
        <KPICard label="Waiting Customs Review" value={waitingReview} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Rejected Containers" value={rejectedContainers} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Ready for Clearance" value={readyOrReleased} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Containers</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1.5">
                <Filter className="w-4 h-4" /> Filters
              </Button>
              <Button size="sm" onClick={() => setNewShipmentOpen(true)} className="gap-1.5">
                <Plus className="w-4 h-4" /> New Shipment
              </Button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-3 pt-3">
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {uniqueSuppliers.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ContainerStatus | "all")}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="documents_missing">Documents Missing</SelectItem>
                  <SelectItem value="waiting_customs_review">Waiting Customs Review</SelectItem>
                  <SelectItem value="rejected_documents">Rejected Documents</SelectItem>
                  <SelectItem value="ready_for_clearance">Ready for Clearance</SelectItem>
                  <SelectItem value="in_clearance">In Clearance</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
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
                    <TableHead>Supplier</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Vessel</TableHead>
                    <TableHead>ETD</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Alerts</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10 text-gray-400">
                        No containers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c) => {
                      const daysToArrival = daysUntil(c.eta);
                      const docsPending = c.docs_uploaded - c.docs_approved - c.docs_rejected;
                      const docsMissing = c.docs_total - c.docs_uploaded;
                      const alerts: string[] = [];
                      if (c.docs_rejected > 0) alerts.push(`${c.docs_rejected} rejected`);
                      if (docsMissing > 0) alerts.push(`${docsMissing} missing`);
                      if (daysToArrival <= 3 && daysToArrival > 0 && c.status !== "released" && c.status !== "ready_for_clearance")
                        alerts.push("Arriving soon!");

                      return (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => router.push(`/importer/containers/${c.id}`)}
                        >
                          <TableCell className="whitespace-nowrap font-medium">{c.container_number}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipment_number}</TableCell>
                          <TableCell className="text-sm">{c.supplier_company}</TableCell>
                          <TableCell className="text-sm max-w-[130px] truncate">{c.product_name}</TableCell>
                          <TableCell className="text-sm">{c.vessel_name}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{formatDate(c.etd)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            <span className={daysToArrival <= 3 && daysToArrival > 0 ? "text-red-600" : ""}>
                              {formatDate(c.eta)}
                            </span>
                          </TableCell>
                          <TableCell><ContainerStatusBadge status={c.status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full"
                                  style={{ width: `${c.docs_total > 0 ? (c.docs_approved / c.docs_total) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{c.docs_approved}/{c.docs_total}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {alerts.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {alerts.map((a, i) => (
                                  <span key={i} className="text-xs flex items-center gap-1 text-orange-600 whitespace-nowrap">
                                    <AlertTriangle className="w-3 h-3" />{a}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-xs text-gray-400">—</span>}
                          </TableCell>
                          <TableCell>
                            <div onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => router.push(`/importer/containers/${c.id}`)}
                              >
                                <Eye className="w-3.5 h-3.5 mr-1" />View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewShipmentModal
        open={newShipmentOpen}
        onClose={() => setNewShipmentOpen(false)}
        onCreated={loadContainers}
      />
    </DashboardLayout>
  );
}
