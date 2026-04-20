import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Plus, Eye, AlertTriangle, CheckCircle, Clock, MessageSquare, XCircle } from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { mockClaims, mockContainers, getShipment, getSupplier, getProduct, type ClaimStatus } from "../data/mockData";
import { toast } from "sonner";

export function ClaimsPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const claimStatusStyles: Record<ClaimStatus, string> = {
    open: "bg-blue-100 text-blue-700",
    "under-review": "bg-yellow-100 text-yellow-700",
    negotiation: "bg-orange-100 text-orange-700",
    resolved: "bg-green-100 text-green-700",
    closed: "bg-gray-200 text-gray-700",
  };

  const claimStatusLabels: Record<ClaimStatus, string> = {
    open: "Open",
    "under-review": "Under Review",
    negotiation: "Negotiation",
    resolved: "Resolved",
    closed: "Closed",
  };

  const openClaims = mockClaims.filter((c) => c.status === "open").length;
  const underReviewClaims = mockClaims.filter((c) => c.status === "under-review").length;
  const negotiationClaims = mockClaims.filter((c) => c.status === "negotiation").length;
  const resolvedClaims = mockClaims.filter((c) => c.status === "resolved" || c.status === "closed").length;

  return (
    <DashboardLayout
      role="importer"
      title="Claims Management"
      subtitle="Open and track claims related to containers"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard label="Open Claims" value={openClaims} icon={AlertTriangle} color="text-blue-600" iconColor="text-blue-600" />
        <KPICard label="Under Review" value={underReviewClaims} icon={Clock} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="In Negotiation" value={negotiationClaims} icon={MessageSquare} color="text-orange-600" iconColor="text-orange-600" />
        <KPICard label="Resolved / Closed" value={resolvedClaims} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Claims</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              New Claim
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Claim Type</TableHead>
                  <TableHead className="text-right">Claim Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockClaims.map((claim) => (
                  <TableRow
                    key={claim.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/importer/claims/${claim.id}`)}
                  >
                    <TableCell className="whitespace-nowrap">{claim.containerNumber}</TableCell>
                    <TableCell className="text-sm">{claim.supplierName}</TableCell>
                    <TableCell className="text-sm max-w-[130px] truncate">{claim.productName}</TableCell>
                    <TableCell className="text-sm capitalize">{claim.claimType}</TableCell>
                    <TableCell className="text-right text-sm">${claim.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded ${claimStatusStyles[claim.status]}`}>
                        {claimStatusLabels[claim.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">{claim.createdAt.split(" ")[0]}</TableCell>
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/importer/claims/${claim.id}`)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
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

      {/* Create Claim Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Claim</DialogTitle>
            <DialogDescription>Open a new claim related to a container.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Container <span className="text-red-500">*</span></Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
                <SelectContent>
                  {mockContainers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.containerNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Claim Type <span className="text-red-500">*</span></Label>
              <Select>
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
            <div className="space-y-2">
              <Label>Description <span className="text-red-500">*</span></Label>
              <Textarea placeholder="Describe the claim..." rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Claim Amount ($)</Label>
              <Input type="number" placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Attachments</Label>
              <Input type="file" accept=".pdf,.jpg,.png,.mp4,.doc" multiple />
              <p className="text-xs text-gray-500">Upload images, videos, or documents</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast.success("Claim created successfully."); setCreateOpen(false); }}>
              <Plus className="w-4 h-4 mr-2" />Create Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
