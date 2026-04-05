"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, AlertTriangle, CheckCircle, Clock, MessageSquare } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { mockClaims, type ClaimStatus } from "@/lib/mock-data";

// ── Mock identity ────────────────────────────────────────────
const CURRENT_SUPPLIER_ID = "SUP001";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  "under-review": "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-600",
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Open", "under-review": "Under Review",
  negotiation: "Negotiation", resolved: "Resolved", closed: "Closed",
};

export default function SupplierClaimsPage() {
  const router = useRouter();

  // Only show claims that involve this supplier
  const myClaims = useMemo(
    () => mockClaims.filter((c) => c.supplierId === CURRENT_SUPPLIER_ID),
    []
  );

  const kpis = {
    open: myClaims.filter((c) => c.status === "open").length,
    underReview: myClaims.filter((c) => c.status === "under-review").length,
    negotiation: myClaims.filter((c) => c.status === "negotiation").length,
    resolved: myClaims.filter((c) => c.status === "resolved" || c.status === "closed").length,
  };

  return (
    <DashboardLayout
      role="supplier"
      title="Claims"
      subtitle="View and respond to claims opened against your shipments"
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open Claims" value={kpis.open} icon={AlertTriangle} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Under Review" value={kpis.underReview} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="In Negotiation" value={kpis.negotiation} icon={MessageSquare} color="text-orange-600" iconColor="text-orange-600" />
        <KPICard label="Resolved / Closed" value={kpis.resolved} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Claims Against Your Shipments</CardTitle>
        </CardHeader>
        <CardContent>
          {myClaims.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No claims have been opened against your shipments.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Importer</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Claim Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead>Messages</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myClaims.map((claim) => (
                    <TableRow
                      key={claim.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(`/supplier/claims/${claim.id}`)}
                    >
                      <TableCell className="whitespace-nowrap font-medium">{claim.containerNumber}</TableCell>
                      {/* Importer name — derive from importerId via shipment (show generic for now) */}
                      <TableCell className="text-sm text-gray-600">EuroFresh Imports GmbH</TableCell>
                      <TableCell className="text-sm max-w-[130px] truncate">{claim.productName}</TableCell>
                      <TableCell className="text-sm capitalize">{claim.claimType}</TableCell>
                      <TableCell className="text-right text-sm">${claim.amount.toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[claim.status]}`}>
                          {STATUS_LABELS[claim.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                        {claim.createdAt.split(" ")[0]}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" />
                          {claim.messages.length}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline" size="sm"
                            onClick={() => router.push(`/supplier/claims/${claim.id}`)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
