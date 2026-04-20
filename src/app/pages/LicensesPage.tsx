import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Plus, Eye, Upload, Award, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { KPICard } from "../components/KPICard";
import { mockImportLicenses, mockSuppliers, getLicenseStatus, daysBetween } from "../data/mockData";
import { toast } from "sonner";

export function LicensesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const enriched = mockImportLicenses.map((lic) => {
    const status = getLicenseStatus(lic.expirationDate);
    const daysRemaining = daysBetween(lic.expirationDate);
    return { ...lic, status, daysRemaining };
  });

  const validCount = enriched.filter((l) => l.status === "valid").length;
  const expiringSoonCount = enriched.filter((l) => l.status === "expiring-soon").length;
  const expiredCount = enriched.filter((l) => l.status === "expired").length;

  const statusStyles = {
    valid: "bg-green-100 text-green-700",
    "expiring-soon": "bg-yellow-100 text-yellow-700",
    expired: "bg-red-100 text-red-700",
  };

  const statusLabels = {
    valid: "Valid",
    "expiring-soon": "Expiring Soon",
    expired: "Expired",
  };

  return (
    <DashboardLayout
      role="importer"
      title="Import Licenses"
      subtitle="Manage import licenses per supplier and track expiration dates"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <KPICard label="Valid Licenses" value={validCount} icon={CheckCircle} color="text-green-600" iconColor="text-green-600" />
        <KPICard label="Expiring Soon" value={expiringSoonCount} icon={AlertTriangle} color="text-yellow-600" iconColor="text-yellow-600" />
        <KPICard label="Expired" value={expiredCount} icon={XCircle} color="text-red-600" iconColor="text-red-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Licenses</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              Add License
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>License Number</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Expiration Date</TableHead>
                  <TableHead className="text-center">Days Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.map((lic) => (
                  <TableRow key={lic.id}>
                    <TableCell className="text-sm">{lic.supplierName}</TableCell>
                    <TableCell className="text-sm">{lic.licenseNumber}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-blue-600 gap-1 h-auto py-1 px-2">
                        <Eye className="w-3 h-3" />
                        <span className="text-xs">{lic.fileName}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">{lic.issueDate}</TableCell>
                    <TableCell className="text-sm text-gray-500">{lic.expirationDate}</TableCell>
                    <TableCell className="text-center">
                      <span className={`text-sm ${
                        lic.daysRemaining < 0
                          ? "text-red-600"
                          : lic.daysRemaining <= 30
                          ? "text-yellow-600"
                          : "text-green-600"
                      }`}>
                        {lic.daysRemaining < 0 ? "Expired" : `${lic.daysRemaining} days`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusStyles[lic.status]}`}>
                        {statusLabels[lic.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm">
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add License Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Import License</DialogTitle>
            <DialogDescription>Upload a new import license for a supplier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier <span className="text-red-500">*</span></Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {mockSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>License Number <span className="text-red-500">*</span></Label>
              <Input placeholder="e.g. LIC-2026-005" />
            </div>
            <div className="space-y-2">
              <Label>License File <span className="text-red-500">*</span></Label>
              <Input type="file" accept=".pdf,.jpg,.png" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Issue Date <span className="text-red-500">*</span></Label>
                <Input type="date" />
              </div>
              <div className="space-y-2">
                <Label>Expiration Date <span className="text-red-500">*</span></Label>
                <Input type="date" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast.success("License added successfully."); setCreateOpen(false); }}>
              <Upload className="w-4 h-4 mr-2" />Add License
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
