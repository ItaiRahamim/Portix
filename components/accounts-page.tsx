"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Eye } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getInvoices, getAccountProfiles } from "@/lib/db";
import type { Invoice, Profile, UserRole } from "@/lib/supabase";

interface AccountsPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

interface AccountSummary {
  profile: Profile;
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  lastInvoiceDate: string | null;
}

function buildAccountSummaries(
  invoices: Invoice[],
  profiles: Profile[],
  currentRole: UserRole
): AccountSummary[] {
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Group invoices by counterpart ID
  const grouped = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    // counterpart is the "other side" from the current user's role
    const counterpartId =
      currentRole === "importer" ? inv.supplier_id : inv.importer_id;
    const group = grouped.get(counterpartId) ?? [];
    group.push(inv);
    grouped.set(counterpartId, group);
  }

  const summaries: AccountSummary[] = [];
  for (const [id, invs] of grouped.entries()) {
    const profile = profileMap.get(id);
    if (!profile) continue;

    const totalAmount = invs.reduce((s, i) => s + (i.amount ?? 0), 0);
    const paidAmount = invs.reduce((s, i) => s + (i.paid_amount ?? 0), 0);
    const sortedByDate = [...invs].sort(
      (a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime()
    );

    summaries.push({
      profile,
      totalInvoices: invs.length,
      totalAmount,
      paidAmount,
      remainingBalance: totalAmount - paidAmount,
      lastInvoiceDate: sortedByDate[0]?.invoice_date ?? null,
    });
  }

  // Ensure all profiles appear even with no invoices
  for (const profile of profiles) {
    if (!grouped.has(profile.id)) {
      summaries.push({
        profile,
        totalInvoices: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainingBalance: 0,
        lastInvoiceDate: null,
      });
    }
  }

  return summaries.sort((a, b) =>
    a.profile.full_name.localeCompare(b.profile.full_name)
  );
}

export function AccountsPage({ role }: AccountsPageProps) {
  const router = useRouter();
  const [summaries, setSummaries] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Determine which role to look up as counterparts
  const counterpartRole: UserRole =
    role === "importer" ? "supplier"
    : role === "supplier" ? "importer"
    : "importer"; // customs agent sees importers

  const loadData = useCallback(async () => {
    setLoading(true);
    const [invoices, profiles] = await Promise.all([
      getInvoices(),
      getAccountProfiles(counterpartRole),
    ]);

    // Map URL role slug → DB role value (support both old and new customs role names)
    const currentRole: UserRole =
      role === "customs-agent" ? "customs" : role as UserRole;
    setSummaries(buildAccountSummaries(invoices, profiles, currentRole));
    setLoading(false);
  }, [role, counterpartRole]);

  useEffect(() => { loadData(); }, [loadData]);

  const columnLabel =
    role === "importer" ? "Supplier"
    : role === "supplier" ? "Importer"
    : "Client";

  const basePath = `/${role}/accounts`;

  return (
    <DashboardLayout
      role={role}
      title="Accounts"
      subtitle={`Manage financial relationships with your ${columnLabel.toLowerCase()}s`}
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {role === "importer" ? "Suppliers" : role === "supplier" ? "Importers" : "Clients"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-gray-400 text-sm">Loading accounts…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{columnLabel}</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-center">Total Invoices</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Last Invoice</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-gray-400">
                        No accounts found
                      </TableCell>
                    </TableRow>
                  ) : (
                    summaries.map(({ profile, totalInvoices, totalAmount, paidAmount, remainingBalance, lastInvoiceDate }) => (
                      <TableRow
                        key={profile.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`${basePath}/${profile.id}`)}
                      >
                        <TableCell className="text-sm font-medium">{profile.full_name}</TableCell>
                        <TableCell className="text-sm text-gray-600">{profile.company_name}</TableCell>
                        <TableCell className="text-center text-sm">{totalInvoices}</TableCell>
                        <TableCell className="text-right text-sm">
                          {totalAmount > 0 ? `$${totalAmount.toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm text-green-600">
                          {paidAmount > 0 ? `$${paidAmount.toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {remainingBalance > 0 ? (
                            <span className="text-red-600">${remainingBalance.toLocaleString()}</span>
                          ) : (
                            <span className="text-gray-400">$0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {lastInvoiceDate
                            ? new Date(lastInvoiceDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`${basePath}/${profile.id}`)}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
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
