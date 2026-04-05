"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Upload, Eye, Download, FileText } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getAccount, getInvoicesForAccount } from "@/lib/mock-data";
import { toast } from "sonner";

export default function ImporterAccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.accountId as string;
  const [uploadInvoiceOpen, setUploadInvoiceOpen] = useState(false);
  const [uploadSwiftOpen, setUploadSwiftOpen] = useState(false);

  const account = getAccount(accountId);
  const invoices = getInvoicesForAccount(accountId);

  if (!account) {
    return (
      <DashboardLayout role="importer" title="Account Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Account not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.back()}>Go Back</Button>
        </div>
      </DashboardLayout>
    );
  }

  const statusStyles = { unpaid: "bg-red-100 text-red-700", "partially-paid": "bg-yellow-100 text-yellow-700", paid: "bg-green-100 text-green-700" };
  const statusLabels = { unpaid: "Unpaid", "partially-paid": "Partially Paid", paid: "Paid" };

  return (
    <DashboardLayout role="importer" title={account.name} subtitle="Invoice management and payment tracking">
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5" onClick={() => router.push("/importer/accounts")}>
        <ArrowLeft className="w-4 h-4" />Back to Accounts
      </Button>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div><p className="text-gray-500 text-xs">Account Name</p><p className="mt-0.5">{account.name}</p></div>
            <div><p className="text-gray-500 text-xs">Total Invoices</p><p className="mt-0.5">{account.totalInvoices}</p></div>
            <div><p className="text-gray-500 text-xs">Total Amount</p><p className="mt-0.5">${account.totalAmount.toLocaleString()}</p></div>
            <div><p className="text-gray-500 text-xs">Paid Amount</p><p className="mt-0.5 text-green-600">${account.paidAmount.toLocaleString()}</p></div>
            <div>
              <p className="text-gray-500 text-xs">Remaining Balance</p>
              <p className={`mt-0.5 ${account.remainingBalance > 0 ? "text-red-600" : "text-green-600"}`}>${account.remainingBalance.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Invoices</CardTitle>
            <Button size="sm" className="gap-1.5" onClick={() => setUploadInvoiceOpen(true)}>
              <Upload className="w-4 h-4" />Upload Invoice
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Related Shipment / Container</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid Amount</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SWIFT Document</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm">{inv.invoiceNumber}</TableCell>
                    <TableCell className="text-sm text-gray-500">{inv.date}</TableCell>
                    <TableCell className="text-sm text-gray-500">{inv.relatedShipment || "-"} / {inv.relatedContainer || "-"}</TableCell>
                    <TableCell className="text-right text-sm">${inv.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm text-green-600">${inv.paidAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm">
                      {inv.remainingAmount > 0 ? <span className="text-red-600">${inv.remainingAmount.toLocaleString()}</span> : <span className="text-green-600">$0</span>}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusStyles[inv.status]}`}>{statusLabels[inv.status]}</span>
                    </TableCell>
                    <TableCell>
                      {inv.swiftDocument ? (
                        <Button variant="ghost" size="sm" className="text-blue-600 gap-1 h-auto py-1 px-2">
                          <FileText className="w-3 h-3" /><span className="text-xs">View</span>
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-gray-500 gap-1 h-auto py-1 px-2" onClick={() => setUploadSwiftOpen(true)}>
                          <Upload className="w-3 h-3" /><span className="text-xs">Upload</span>
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm"><Eye className="w-3.5 h-3.5 mr-1" />View</Button>
                        <Button variant="outline" size="sm"><Download className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={uploadInvoiceOpen} onOpenChange={setUploadInvoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Upload Invoice</DialogTitle><DialogDescription>Upload a new invoice document.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Invoice File <span className="text-red-500">*</span></Label><Input type="file" accept=".pdf,.doc,.docx,.xlsx" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadInvoiceOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast.success("Invoice uploaded successfully."); setUploadInvoiceOpen(false); }}><Upload className="w-4 h-4 mr-2" />Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uploadSwiftOpen} onOpenChange={setUploadSwiftOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Upload SWIFT Confirmation</DialogTitle><DialogDescription>Upload the SWIFT payment confirmation document.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>SWIFT Document <span className="text-red-500">*</span></Label><Input type="file" accept=".pdf,.jpg,.png" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadSwiftOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast.success("SWIFT document uploaded successfully."); setUploadSwiftOpen(false); }}><Upload className="w-4 h-4 mr-2" />Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
