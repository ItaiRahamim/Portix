"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Eye, AlertTriangle, CheckCircle, Clock, MessageSquare } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { KPICard } from "@/components/kpi-card";
import {
  mockClaims, mockContainers, getShipment, getSupplier, getProduct,
  type ClaimStatus,
} from "@/lib/mock-data";
import { toast } from "sonner";

const CURRENT_IMPORTER_NAME = "EuroFresh Imports GmbH";

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

function nowTimestamp() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export default function ImporterClaimsPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [claimType, setClaimType] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kpis = useMemo(() => ({
    open: mockClaims.filter((c) => c.status === "open").length,
    underReview: mockClaims.filter((c) => c.status === "under-review").length,
    negotiation: mockClaims.filter((c) => c.status === "negotiation").length,
    resolved: mockClaims.filter((c) => c.status === "resolved" || c.status === "closed").length,
  }), [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedContainer = useMemo(
    () => mockContainers.find((c) => c.id === selectedContainerId),
    [selectedContainerId]
  );
  const selectedShipment = selectedContainer ? getShipment(selectedContainer.shipmentId) : null;
  const selectedSupplier = selectedShipment ? getSupplier(selectedShipment.supplierId) : null;
  const selectedProduct = selectedShipment ? getProduct(selectedShipment.productId) : null;

  const canCreate = !!(selectedContainerId && claimType && description.trim());

  const resetForm = () => { setSelectedContainerId(""); setClaimType(""); setDescription(""); setAmount(""); };

  const handleCreateClaim = () => {
    if (!canCreate || !selectedContainer || !selectedShipment || !selectedSupplier || !selectedProduct) return;
    const newId = "CLM" + String(mockClaims.length + 1).padStart(3, "0");
    const ts = nowTimestamp();
    mockClaims.push({
      id: newId,
      containerId: selectedContainerId,
      containerNumber: selectedContainer.containerNumber,
      supplierId: selectedShipment.supplierId,
      supplierName: selectedSupplier.name,
      productId: selectedShipment.productId,
      productName: selectedProduct.name,
      claimType,
      description: description.trim(),
      amount: amount ? parseFloat(amount) : 0,
      status: "open",
      createdAt: ts,
      messages: [{
        id: "MSG-" + Date.now(),
        sender: CURRENT_IMPORTER_NAME,
        senderRole: "importer",
        text: description.trim(),
        timestamp: ts,
      }],
    });
    toast.success("Claim " + newId + " opened for " + selectedContainer.containerNumber + ".");
    setCreateOpen(false);
    resetForm();
    setRefreshKey((k) => k + 1);
  };

  return (
    <DashboardLayout role="importer" title="Claims Management" subtitle="Open and track claims related to containers">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open Claims" value={kpis.open} icon={AlertTriangle} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Under Review" value={kpis.underReview} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="In Negotiation" value={kpis.negotiation} icon={MessageSquare} color="text-orange-600" iconColor="text-orange-600" />
        <KPICard label="Resolved / Closed" value={kpis.resolved} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Claims</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New Claim
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
                {mockClaims.map((claim) => (
                  <TableRow key={claim.id} className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push("/importer/claims/" + claim.id)}>
                    <TableCell className="whitespace-nowrap font-medium">{claim.containerNumber}</TableCell>
                    <TableCell className="text-sm">{claim.supplierName}</TableCell>
                    <TableCell className="text-sm max-w-[130px] truncate">{claim.productName}</TableCell>
                    <TableCell className="text-sm capitalize">{claim.claimType}</TableCell>
                    <TableCell className="text-right text-sm">${claim.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <span className={"text-xs px-2 py-0.5 rounded " + STATUS_STYLES[claim.status]}>
                        {STATUS_LABELS[claim.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                      {claim.createdAt.split(" ")[0]}
                    </TableCell>
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm"
                          onClick={() => router.push("/importer/claims/" + claim.id)}>
                          <Eye className="w-3.5 h-3.5 mr-1" /> View
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
                  {mockContainers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.containerNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSupplier && (
                <p className="text-xs text-gray-500">{selectedSupplier.name} · {selectedProduct?.name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Claim Type <span className="text-red-500">*</span></Label>
              <Select value={claimType} onValueChange={setClaimType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="damage">Damage</SelectItem>
                  <SelectItem value="quality">Quality Issue</SelectItem>
                  <SelectItem value="shortage">Shortage</SelectItem>
                  <SelectItem value="delay">Delay</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-red-500">*</span></Label>
              <Textarea placeholder="Describe the issue in detail…" rows={3}
                value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Claim Amount ($) <span className="text-gray-400 text-xs font-normal">optional</span></Label>
              <Input type="number" placeholder="0.00" min={0}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setCreateOpen(false); }}>Cancel</Button>
            <Button disabled={!canCreate} onClick={handleCreateClaim}>
              <Plus className="w-4 h-4 mr-1.5" /> Open Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
