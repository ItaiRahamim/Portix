"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getAccountsForRole } from "@/lib/mock-data";

interface AccountsPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

export function AccountsPage({ role }: AccountsPageProps) {
  const router = useRouter();
  const accounts = getAccountsForRole(role);

  const columnLabel =
    role === "importer"
      ? "Supplier Name"
      : role === "supplier"
      ? "Importer Name"
      : "Client Name";

  const basePath = `/${role}/accounts`;

  return (
    <DashboardLayout
      role={role}
      title="Accounts"
      subtitle={`Manage financial relationships with your ${role === "importer" ? "suppliers" : role === "supplier" ? "importers" : "clients"}`}
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {role === "importer" ? "Suppliers" : role === "supplier" ? "Importers" : "Clients"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel}</TableHead>
                  <TableHead className="text-center">Total Invoices</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Paid Amount</TableHead>
                  <TableHead className="text-right">Remaining Balance</TableHead>
                  <TableHead>Last Payment Date</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acc) => (
                  <TableRow
                    key={acc.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push(`${basePath}/${acc.id}`)}
                  >
                    <TableCell className="text-sm">{acc.name}</TableCell>
                    <TableCell className="text-center">{acc.totalInvoices}</TableCell>
                    <TableCell className="text-right text-sm">
                      ${acc.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm text-green-600">
                      ${acc.paidAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {acc.remainingBalance > 0 ? (
                        <span className="text-red-600">
                          ${acc.remainingBalance.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-green-600">$0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {acc.lastPaymentDate}
                    </TableCell>
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`${basePath}/${acc.id}`)}
                        >
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
    </DashboardLayout>
  );
}
