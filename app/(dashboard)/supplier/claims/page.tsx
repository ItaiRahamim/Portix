"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Eye, AlertTriangle, CheckCircle, Clock, MessageSquare } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import { getClaims, getContainers } from "@/lib/db";
import type { Claim, ContainerView } from "@/lib/supabase";

type ClaimStatus = "open" | "under_review" | "negotiation" | "resolved" | "closed";

const STATUS_STYLES: Record<ClaimStatus, string> = {
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  resolved: "bg-green-100 text-green-700",
  closed: "bg-gray-200 text-gray-600",
};

const STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Open", under_review: "Under Review",
  negotiation: "Negotiation", resolved: "Resolved", closed: "Closed",
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  damaged_goods: "Damaged Goods", missing_goods: "Missing Goods",
  short_shipment: "Short Shipment", quality_issue: "Quality Issue",
  documentation_error: "Documentation Error", delay: "Delay", other: "Other",
};

export default function SupplierClaimsPage() {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [containers, setContainers] = useState<ContainerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, ctrs] = await Promise.all([getClaims(), getContainers()]);
      setClaims(c);
      setContainers(ctrs);
    } catch (err) {
      setError("Failed to load claims. Please try again.");
      console.error("[claims] loadData:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const containerMap = new Map(containers.map((c) => [c.id, c]));

  const openCount = claims.filter((c) => c.status === "open").length;
  const underReviewCount = claims.filter((c) => c.status === "under_review").length;
  const negotiationCount = claims.filter((c) => c.status === "negotiation").length;
  const resolvedCount = claims.filter((c) => c.status === "resolved" || c.status === "closed").length;

  return (
    <DashboardLayout
      role="supplier"
      title="Claims"
      subtitle="Review and respond to claims from importers"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open Claims" value={openCount} icon={AlertTriangle} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Under Review" value={underReviewCount} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="In Negotiation" value={negotiationCount} icon={MessageSquare} color="text-orange-600" iconColor="text-orange-600" />
        <KPICard label="Resolved / Closed" value={resolvedCount} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Claims</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading claims…</div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-red-600 text-sm mb-3">{error}</p>
              <button className="text-sm text-blue-600 underline" onClick={loadData}>Try again</button>
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
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No claims found
                      </TableCell>
                    </TableRow>
                  ) : claims.map((claim) => {
                    const container = containerMap.get(claim.container_id);
                    return (
                      <TableRow
                        key={claim.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`/supplier/claims/${claim.id}`)}
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          {container?.container_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{container?.importer_company ?? "—"}</TableCell>
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
                            <Button variant="outline" size="sm" onClick={() => router.push(`/supplier/claims/${claim.id}`)}>
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
    </DashboardLayout>
  );
}
