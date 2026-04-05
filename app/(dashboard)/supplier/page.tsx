"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FileWarning, XCircle, Upload, AlertTriangle, Eye, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { NewShipmentModal } from "@/components/new-shipment-modal";
import { getContainers } from "@/lib/db";
import type { ContainerView } from "@/lib/supabase";

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function SupplierDashboardPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);

  const loadContainers = useCallback(async () => {
    setLoading(true);
    const data = await getContainers();
    setContainers(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadContainers(); }, [loadContainers]);

  // Computed KPI values
  const totalMissing = containers.reduce((sum, c) => sum + (c.docs_total - c.docs_uploaded), 0);
  const totalRejected = containers.reduce((sum, c) => sum + c.docs_rejected, 0);
  const urgentContainers = containers.filter(
    (c) => daysUntil(c.eta) <= 7 && (c.docs_total - c.docs_uploaded > 0 || c.docs_rejected > 0)
  ).length;

  return (
    <DashboardLayout
      role="supplier"
      title="Container Overview"
      subtitle="Upload and manage required documents per container"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Missing Documents" value={totalMissing} icon={FileWarning} color="text-gray-600" iconColor="text-gray-500" />
        <KPICard label="Rejected Documents" value={totalRejected} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
        <KPICard label="Awaiting Re-upload" value={totalRejected} icon={Upload} color="text-orange-600" iconColor="text-orange-500" />
        <KPICard label="Urgent Containers" value={urgentContainers} icon={AlertTriangle} color="text-amber-600" iconColor="text-amber-500" />
      </div>

      <div className="flex justify-end gap-2 mb-4">
        <Button onClick={() => setNewShipmentOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Shipment
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Containers</CardTitle>
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
                    <TableHead>Product</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead className="text-center">Required</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Review Status</TableHead>
                    <TableHead className="text-center">Rejected</TableHead>
                    <TableHead>Next Action</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {containers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10 text-gray-400">
                        No containers assigned
                      </TableCell>
                    </TableRow>
                  ) : containers.map((c) => {
                    const docsMissing = c.docs_total - c.docs_uploaded;
                    const docsPending = c.docs_uploaded - c.docs_approved - c.docs_rejected;
                    const daysToArrival = daysUntil(c.eta);

                    let reviewStatus = "Not Started";
                    if (c.docs_rejected > 0) reviewStatus = "Has Rejections";
                    else if (c.docs_approved === c.docs_total && c.docs_total > 0) reviewStatus = "All Approved";
                    else if (docsPending > 0) reviewStatus = "Under Review";
                    else if (c.docs_uploaded > 0) reviewStatus = "Pending";

                    let nextAction = "Upload missing docs";
                    if (c.docs_rejected > 0) nextAction = "Replace rejected docs";
                    else if (docsMissing === 0 && c.docs_approved < c.docs_total) nextAction = "Awaiting review";
                    else if (c.docs_approved === c.docs_total && c.docs_total > 0) nextAction = "Complete";

                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`/supplier/containers/${c.id}`)}
                      >
                        <TableCell className="whitespace-nowrap font-medium">{c.container_number}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-500">{c.shipment_number}</TableCell>
                        <TableCell className="text-sm">{c.importer_company}</TableCell>
                        <TableCell className="text-sm max-w-[130px] truncate">{c.product_name}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          <span className={daysToArrival <= 3 && daysToArrival > 0 ? "text-red-600" : ""}>
                            {formatDate(c.eta)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center text-sm">{c.docs_total}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${c.docs_total > 0 ? (c.docs_uploaded / c.docs_total) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{c.docs_uploaded}/{c.docs_total}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            reviewStatus === "All Approved" ? "bg-green-100 text-green-700"
                            : reviewStatus === "Has Rejections" ? "bg-red-100 text-red-700"
                            : reviewStatus === "Under Review" ? "bg-yellow-100 text-yellow-700"
                            : reviewStatus === "Not Started" ? "bg-gray-100 text-gray-500"
                            : "bg-gray-100 text-gray-700"
                          }`}>
                            {reviewStatus}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {c.docs_rejected > 0 ? (
                            <span className="text-red-600 text-sm">{c.docs_rejected}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs ${
                            nextAction === "Replace rejected docs" ? "text-red-600"
                            : nextAction === "Complete" ? "text-green-600"
                            : "text-gray-600"
                          }`}>
                            {nextAction}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button variant="outline" size="sm" onClick={() => router.push(`/supplier/containers/${c.id}`)}>
                              <Eye className="w-3.5 h-3.5 mr-1" />View
                            </Button>
                            {c.docs_rejected > 0 && (
                              <Button variant="outline" size="sm" className="text-red-600 border-red-200" onClick={() => router.push(`/supplier/containers/${c.id}`)}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
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

      <NewShipmentModal
        open={newShipmentOpen}
        onClose={() => setNewShipmentOpen(false)}
        onCreated={loadContainers}
        role="supplier"
      />
    </DashboardLayout>
  );
}
