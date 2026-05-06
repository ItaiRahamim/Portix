"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Ship, FileWarning, Clock, XCircle, CheckCircle, AlertTriangle, Eye,
  Filter, Plus, ExternalLink, LayoutList, LayoutGrid,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { ContainerStatusBadge } from "@/components/status-badge";
import { NewShipmentModal } from "@/components/new-shipment-modal";
import { getContainers } from "@/lib/db";
import type { ContainerView, ContainerStatus } from "@/lib/supabase";
import { getTrackingLink, CARRIER_LABELS, type CarrierKey } from "@/lib/tracking";
import { EtaCalendarWidget } from "@/components/eta-calendar-widget";

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/** Inline Track badge — shared between table and board views */
function TrackBadge({ carrier, containerNumber }: { carrier: string | null | undefined; containerNumber: string }) {
  const link = getTrackingLink(carrier, containerNumber);
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Track on ${carrier} carrier site`}
      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
    >
      <ExternalLink className="h-3 w-3" />
      Track
    </a>
  );
}

/** Bucket containers into 3 Kanban columns. */
function useBoardBuckets(containers: ContainerView[]) {
  return useMemo(() => {
    const missing: ContainerView[] = [];
    const pending: ContainerView[] = [];
    const cleared: ContainerView[] = [];

    for (const c of containers) {
      if (
        c.status === "documents_missing" ||
        c.status === "rejected_documents" ||
        c.status === "claim_open"
      ) {
        missing.push(c);
      } else if (c.status === "waiting_customs_review") {
        pending.push(c);
      } else {
        // ready_for_clearance | in_clearance | released
        cleared.push(c);
      }
    }

    return { missing, pending, cleared };
  }, [containers]);
}

interface BoardColumnProps {
  title: string;
  count: number;
  containers: ContainerView[];
  headerClass: string;
  onNavigate: (id: string) => void;
}

function BoardColumn({ title, count, containers, headerClass, onNavigate }: BoardColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${headerClass}`}>
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs font-medium opacity-70">{count}</span>
      </div>

      {/* Cards */}
      {containers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
          No containers
        </div>
      ) : (
        containers.map((c) => {
          const daysToArrival = daysUntil(c.eta);
          const etaUrgent = daysToArrival <= 3 && daysToArrival > 0 && c.status !== "released";
          const carrierLabel = c.carrier
            ? (CARRIER_LABELS[c.carrier as CarrierKey] ?? c.carrier.toUpperCase())
            : null;

          return (
            <Card
              key={c.id}
              className="cursor-pointer shadow-sm hover:shadow-md transition-shadow border border-gray-200"
              onClick={() => onNavigate(c.id)}
            >
              <CardContent className="p-3 space-y-2">
                {/* Row 1: container number + Track */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-sm">{c.container_number}</span>
                  <TrackBadge carrier={c.carrier} containerNumber={c.container_number} />
                </div>

                {/* Row 2: carrier + status badge */}
                <div className="flex items-center justify-between gap-2">
                  {carrierLabel ? (
                    <span className="text-xs text-gray-500">{carrierLabel}</span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                  <ContainerStatusBadge status={c.status} />
                </div>

                {/* Row 3: doc progress */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${c.docs_total > 0 ? (c.docs_approved / c.docs_total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {c.docs_uploaded}/{c.docs_total} uploaded
                  </span>
                </div>

                {/* Row 4: ETA */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">ETA</span>
                  <span className={etaUrgent ? "text-red-600 font-medium" : "text-gray-600"}>
                    {formatDate(c.eta)}
                    {etaUrgent && " ⚡"}
                  </span>
                </div>

                {/* Rejected docs alert */}
                {c.docs_rejected > 0 && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3 w-3" />
                    {c.docs_rejected} doc{c.docs_rejected > 1 ? "s" : ""} rejected
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

export default function ImporterDashboardPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ContainerStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);
  const [view, setView] = useState<"table" | "board">("table");

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

  const { missing, pending, cleared } = useBoardBuckets(filtered);

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

      <EtaCalendarWidget containers={containers} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">Containers</CardTitle>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <Tabs value={view} onValueChange={(v) => setView(v as "table" | "board")}>
                <TabsList className="h-8">
                  <TabsTrigger value="table" className="h-7 px-2.5 gap-1.5 text-xs">
                    <LayoutList className="h-3.5 w-3.5" /> Table
                  </TabsTrigger>
                  <TabsTrigger value="board" className="h-7 px-2.5 gap-1.5 text-xs">
                    <LayoutGrid className="h-3.5 w-3.5" /> Board
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1.5">
                <Filter className="w-4 h-4" /> Filters
              </Button>
              <Button size="sm" onClick={() => setNewShipmentOpen(true)} className="gap-1.5">
                <Plus className="w-4 h-4" /> New Shipment
              </Button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-wrap items-center gap-3 pt-3">
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
              {(supplierFilter !== "all" || statusFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 h-9"
                  onClick={() => { setSupplierFilter("all"); setStatusFilter("all"); }}
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
          ) : view === "table" ? (
            /* ── Table view ───────────────────────────────────────── */
            <div className="overflow-x-auto w-full">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill of Lading</TableHead>
                    <TableHead>Container</TableHead>
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
                          <TableCell className="whitespace-nowrap font-mono text-sm">{c.bill_of_lading_number ?? <span className="text-gray-400">—</span>}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{c.container_number}</span>
                              <TrackBadge carrier={c.carrier} containerNumber={c.container_number} />
                            </div>
                          </TableCell>
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
          ) : (
            /* ── Board view ───────────────────────────────────────── */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[300px]">
              <BoardColumn
                title="Missing Documents"
                count={missing.length}
                containers={missing}
                headerClass="bg-red-50 text-red-800 border border-red-200"
                onNavigate={(id) => router.push(`/importer/containers/${id}`)}
              />
              <BoardColumn
                title="Pending Customs"
                count={pending.length}
                containers={pending}
                headerClass="bg-yellow-50 text-yellow-800 border border-yellow-200"
                onNavigate={(id) => router.push(`/importer/containers/${id}`)}
              />
              <BoardColumn
                title="Cleared / Released"
                count={cleared.length}
                containers={cleared}
                headerClass="bg-green-50 text-green-800 border border-green-200"
                onNavigate={(id) => router.push(`/importer/containers/${id}`)}
              />
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
