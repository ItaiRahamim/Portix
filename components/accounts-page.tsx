"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Eye, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getMyCompany, getCompanyAccounts } from "@/lib/db";
import type { CompanyWithBalance } from "@/lib/db";

interface AccountsPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function BalanceCell({ balance }: { balance: number }) {
  if (balance > 0) {
    return (
      <span className="flex items-center justify-end gap-1 text-red-600 font-medium">
        <TrendingUp className="w-3.5 h-3.5" />
        {formatCurrency(balance)}
      </span>
    );
  }
  if (balance < 0) {
    return (
      <span className="flex items-center justify-end gap-1 text-green-600 font-medium">
        <TrendingDown className="w-3.5 h-3.5" />
        {formatCurrency(Math.abs(balance))} credit
      </span>
    );
  }
  return (
    <span className="flex items-center justify-end gap-1 text-gray-400">
      <Minus className="w-3.5 h-3.5" />
      {formatCurrency(0)}
    </span>
  );
}

const COMPANY_TYPE_LABELS: Record<string, string> = {
  importer: "Importer",
  supplier: "Supplier",
  broker: "Broker",
};

const COMPANY_TYPE_COLORS: Record<string, string> = {
  importer: "bg-blue-100 text-blue-700",
  supplier: "bg-green-100 text-green-700",
  broker: "bg-purple-100 text-purple-700",
};

export function AccountsPage({ role }: AccountsPageProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<CompanyWithBalance[]>([]);
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const columnLabel =
    role === "importer" ? "Supplier / Broker"
    : role === "supplier" ? "Importer"
    : "Company";

  const basePath = `/${role}/accounts`;

  const loadData = useCallback(async () => {
    setLoading(true);
    const myCompany = await getMyCompany();
    if (!myCompany) {
      setLoading(false);
      return;
    }
    setMyCompanyId(myCompany.id);
    const companyAccounts = await getCompanyAccounts(myCompany.id);
    // Sort: highest outstanding balance first
    companyAccounts.sort(
      (a, b) => (b.balance?.current_balance ?? 0) - (a.balance?.current_balance ?? 0)
    );
    setAccounts(companyAccounts);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // KPI aggregates
  const totalOutstanding = accounts.reduce(
    (sum, a) => sum + Math.max(0, a.balance?.current_balance ?? 0), 0
  );
  const totalInvoiced = accounts.reduce(
    (sum, a) => sum + (a.balance?.total_invoiced ?? 0), 0
  );
  const totalPaid = accounts.reduce(
    (sum, a) => sum + (a.balance?.total_paid ?? 0), 0
  );

  return (
    <DashboardLayout
      role={role}
      title="Accounts"
      subtitle={`Company-level financial relationships and transaction ledger`}
    >
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
            <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Total Paid</p>
            <p className="text-xl font-semibold text-green-600">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 mb-1">Outstanding Balance</p>
            <p className={`text-xl font-semibold ${totalOutstanding > 0 ? "text-red-600" : "text-gray-400"}`}>
              {formatCurrency(totalOutstanding)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Accounts table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{columnLabel}s</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading accounts…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Total Invoiced</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No company accounts found. Transactions will appear here once invoices are issued.
                      </TableCell>
                    </TableRow>
                  ) : (
                    accounts.map((company) => {
                      const bal = company.balance;
                      const detailPath = myCompanyId
                        ? `${basePath}/${company.id}`
                        : "#";
                      return (
                        <TableRow
                          key={company.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => router.push(detailPath)}
                        >
                          <TableCell className="font-medium text-sm">{company.name}</TableCell>
                          <TableCell>
                            <Badge
                              className={`text-xs font-normal ${COMPANY_TYPE_COLORS[company.type] ?? "bg-gray-100 text-gray-600"}`}
                              variant="secondary"
                            >
                              {COMPANY_TYPE_LABELS[company.type] ?? company.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">{company.country ?? "—"}</TableCell>
                          <TableCell className="text-right text-sm">
                            {bal ? formatCurrency(bal.total_invoiced) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm text-green-600">
                            {bal ? formatCurrency(bal.total_paid) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm text-blue-600">
                            {bal && bal.total_credits > 0 ? formatCurrency(bal.total_credits) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <BalanceCell balance={bal?.current_balance ?? 0} />
                          </TableCell>
                          <TableCell>
                            <div onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => router.push(detailPath)}
                              >
                                <Eye className="w-3.5 h-3.5 mr-1" />
                                Ledger
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
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
