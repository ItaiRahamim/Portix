"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Ship, FileWarning, Clock, XCircle, CheckCircle, AlertTriangle, Eye, Filter, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { ClearanceBadge } from "@/components/status-badge";
import { NewShipmentModal } from "@/components/new-shipment-modal";
import {
  mockContainers, mockSuppliers, getShipment, getSupplier, getProduct,
  getDocumentsForContainer, daysBetween,
} from "@/lib/mock-data";

export default function ImporterDashboardPage() {
  const router = useRouter();
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const enrichedContainers = useMemo(() => {
    return mockContainers.map((c) => {
      const shipment = getShipment(c.shipmentId)!;
      const supplier = getSupplier(shipment.supplierId);
      const product = getProduct(shipment.productId);
      const docs = getDocumentsForContainer(c.id);
      const totalDocs = docs.length;
      const uploadedDocs = docs.filter((d) => d.status !== "missing").length;
      const approvedDocs = docs.filter((d) => d.status === "approved").length;
      const rejectedDocs = docs.filter((d) => d.status === "rejected").length;
      const missingDocs = docs.filter((d) => d.status === "missing").length;
      const pendingDocs = docs.filter((d) => d.status === "under-review" || d.status === "uploaded").length;

      let docsStatus = "Incomplete";
      if (missingDocs > 0) docsStatus = `${missingDocs} Missing`;
      else if (totalDocs === uploadedDocs) docsStatus = "All Uploaded";

      let customsReviewStatus = "Pending";
      if (rejectedDocs > 0) customsReviewStatus = "Has Rejections";
      else if (approvedDocs === totalDocs && totalDocs > 0) customsReviewStatus = "All Approved";
      else if (pendingDocs > 0) customsReviewStatus = "Under Review";

      let containerStatus = "Waiting Customs Review";
      if (c.clearanceStatus === "released") containerStatus = "Released";
      else if (c.clearanceStatus === "in-clearance") containerStatus = "In Clearance";
      else if (c.clearanceStatus === "ready-for-clearance") containerStatus = "Ready for Clearance";
      else if (c.clearanceStatus === "rejected-action-required") containerStatus = "Rejected Documents";
      else if (c.clearanceStatus === "missing-documents") containerStatus = "Documents Missing";

      const alerts: string[] = [];
      const daysToArrival = daysBetween(c.eta);
      if (rejectedDocs > 0) alerts.push(`${rejectedDocs} rejected`);
      if (missingDocs > 0) alerts.push(`${missingDocs} missing`);
      if (daysToArrival <= 3 && daysToArrival > 0 && c.clearanceStatus !== "released" && c.clearanceStatus !== "ready-for-clearance")
        alerts.push("Arriving soon!");

      return {
        ...c, shipment, supplierName: supplier?.name || "", supplierId: shipment.supplierId,
        productName: product?.name || "", vesselName: shipment.vesselName, etd: shipment.etd,
        totalDocs, uploadedDocs, approvedDocs, rejectedDocs, missingDocs,
        docsStatus, customsReviewStatus, containerStatus, alerts, daysToArrival,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const activeContainers = enrichedContainers.filter((c) => c.clearanceStatus !== "released").length;
  const waitingDocs = enrichedContainers.filter((c) => c.clearanceStatus === "missing-documents").length;
  const waitingReview = enrichedContainers.filter((c) => c.clearanceStatus === "waiting-for-review").length;
  const rejectedContainers = enrichedContainers.filter((c) => c.clearanceStatus === "rejected-action-required").length;
  const readyForClearance = enrichedContainers.filter((c) => c.clearanceStatus === "ready-for-clearance" || c.clearanceStatus === "released").length;

  const filtered = enrichedContainers.filter((c) => {
    if (supplierFilter !== "all" && c.supplierId !== supplierFilter) return false;
    if (statusFilter !== "all" && c.clearanceStatus !== statusFilter) return false;
    return true;
  });

  return (
    <DashboardLayout role="importer" title="Container Control" subtitle="Monitor all containers, documents, and customs clearance statuses">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard label="Active Containers" value={activeContainers} icon={Ship} iconColor="text-blue-600" />
        <KPICard label="Waiting for Documents" value={waitingDocs} icon={FileWarning} color="text-gray-600" iconColor="text-gray-500" />
        <KPICard label="Waiting Customs Review" value={waitingReview} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Rejected Containers" value={rejectedContainers} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Ready for Clearance" value={readyForClearance} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
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
                  {mockSuppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="missing-documents">Documents Missing</SelectItem>
                  <SelectItem value="waiting-for-review">Waiting Customs Review</SelectItem>
                  <SelectItem value="rejected-action-required">Rejected Documents</SelectItem>
                  <SelectItem value="ready-for-clearance">Ready for Clearance</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container Number</TableHead>
                  <TableHead>Shipment ID</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Vessel</TableHead>
                  <TableHead>ETD</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Container Status</TableHead>
                  <TableHead>Documents Status</TableHead>
                  <TableHead>Customs Review</TableHead>
                  <TableHead>Clearance</TableHead>
                  <TableHead>Alerts</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/importer/containers/${c.id}`)}>
                    <TableCell className="whitespace-nowrap">{c.containerNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipmentId}</TableCell>
                    <TableCell className="text-sm">{c.supplierName}</TableCell>
                    <TableCell className="text-sm max-w-[130px] truncate">{c.productName}</TableCell>
                    <TableCell className="text-sm">{c.vesselName}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.etd}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      <span className={c.daysToArrival <= 3 && c.daysToArrival > 0 ? "text-red-600" : ""}>{c.eta}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                        c.containerStatus === "Released" ? "bg-green-100 text-green-700"
                        : c.containerStatus === "Ready for Clearance" ? "bg-emerald-100 text-emerald-700"
                        : c.containerStatus === "Rejected Documents" ? "bg-red-100 text-red-700"
                        : c.containerStatus === "Documents Missing" ? "bg-gray-200 text-gray-700"
                        : c.containerStatus === "In Clearance" ? "bg-blue-100 text-blue-700"
                        : "bg-yellow-100 text-yellow-700"
                      }`}>{c.containerStatus}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${c.totalDocs > 0 ? (c.uploadedDocs / c.totalDocs) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{c.uploadedDocs}/{c.totalDocs}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                        c.customsReviewStatus === "All Approved" ? "bg-green-100 text-green-700"
                        : c.customsReviewStatus === "Has Rejections" ? "bg-red-100 text-red-700"
                        : c.customsReviewStatus === "Under Review" ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-700"
                      }`}>{c.customsReviewStatus}</span>
                    </TableCell>
                    <TableCell><ClearanceBadge status={c.clearanceStatus} /></TableCell>
                    <TableCell>
                      {c.alerts.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {c.alerts.map((a, i) => (
                            <span key={i} className="text-xs flex items-center gap-1 text-orange-600 whitespace-nowrap">
                              <AlertTriangle className="w-3 h-3" />{a}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-xs text-gray-400">-</span>}
                    </TableCell>
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => router.push(`/importer/containers/${c.id}`)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <NewShipmentModal
        open={newShipmentOpen}
        onClose={() => setNewShipmentOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </DashboardLayout>
  );
}
