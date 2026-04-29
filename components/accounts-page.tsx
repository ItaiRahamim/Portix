"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getPartnerAccounts, getCurrentProfile, updateProfile } from "@/lib/db";
import type { PartnerAccount } from "@/lib/db";
import type { Profile } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountsPageProps {
  role: "importer" | "supplier" | "customs-agent";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

function BalanceCell({ account }: { account: PartnerAccount }) {
  const { current_balance: balance, total_invoiced, total_paid, total_credits } = account;
  // True credit = payments + credits exceed all invoices (overpayment scenario)
  const isCredit = total_paid + total_credits > total_invoiced + 0.005;

  if (Math.abs(balance) <= 0.005) return <span className="text-gray-400">{fmt(0)}</span>;
  if (isCredit) return <span className="font-medium text-emerald-600">{fmt(Math.abs(balance))} credit</span>;
  if (balance > 0) return <span className="font-medium text-red-600">{fmt(balance)} owed to you</span>;
  return <span className="font-medium text-red-600">{fmt(Math.abs(balance))} you owe</span>;
}

// ─── Single company table section ────────────────────────────────────────────

function CompanySection({
  title,
  accounts,
  basePath,
  router,
}: {
  title: string;
  accounts: PartnerAccount[];
  basePath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: any;
}) {
  const totalInvoiced  = accounts.reduce((s, a) => s + a.total_invoiced,  0);
  const totalPaid      = accounts.reduce((s, a) => s + a.total_paid,      0);
  const totalOutstanding = accounts.reduce(
    (s, a) => s + Math.max(0, a.current_balance), 0
  );

  return (
    <Card className="mb-6">
      <CardHeader className="pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Invoiced: <span className="font-medium text-gray-700">{fmt(totalInvoiced)}</span></span>
            <span>Paid: <span className="font-medium text-green-600">{fmt(totalPaid)}</span></span>
            <span>
              Outstanding:{" "}
              <span className={`font-medium ${totalOutstanding > 0 ? "text-red-600" : "text-gray-400"}`}>
                {fmt(totalOutstanding)}
              </span>
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Total Invoiced</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-400 text-sm">
                    No {title.toLowerCase()} found
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((account) => {
                  const href = `${basePath}/${account.partner_id}`;
                  return (
                    <TableRow
                      key={account.partner_id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(href)}
                    >
                      <TableCell className="font-medium text-sm">{account.company_name}</TableCell>
                      <TableCell className="text-right text-sm">
                        {account.total_invoiced > 0 ? fmt(account.total_invoiced) : <span className="text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm text-green-600">
                        {account.total_paid > 0 ? fmt(account.total_paid) : <span className="text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm text-blue-600">
                        {account.total_credits > 0 ? fmt(account.total_credits) : <span className="text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <BalanceCell account={account} />
                      </TableCell>
                      <TableCell>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Button variant="outline" size="sm" onClick={() => router.push(href)}>
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
      </CardContent>
    </Card>
  );
}

// ─── My Profile card ─────────────────────────────────────────────────────────

function MyProfileCard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentProfile().then((p) => {
      if (p) {
        setProfile(p);
        setFullName(p.full_name ?? "");
        setPhone(p.phone ?? "");
        setCompanyName(p.company_name ?? "");
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const ok = await updateProfile({
      full_name: fullName.trim() || undefined,
      phone: phone.trim() || undefined,
      company_name: companyName.trim() || undefined,
    });
    setSaving(false);
    if (ok) {
      setProfile((prev) => prev
        ? { ...prev, full_name: fullName.trim(), phone: phone.trim() || null, company_name: companyName.trim() }
        : prev
      );
      toast.success("Profile updated.");
      setEditOpen(false);
    } else {
      toast.error("Failed to save profile. Please try again.");
    }
  };

  if (!profile) return null;

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">My Profile</CardTitle>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Full Name</p>
              <p className="font-medium text-gray-800">{profile.full_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Company</p>
              <p className="font-medium text-gray-800">{profile.company_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Email</p>
              <p className="font-medium text-gray-800">{profile.email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Phone</p>
              <p className="font-medium text-gray-800">{profile.phone || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
            </div>
            <p className="text-xs text-gray-400">Email cannot be changed here — contact support.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AccountsPage({ role }: AccountsPageProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<PartnerAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const basePath = `/${role}/accounts`;

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getPartnerAccounts();
    // Sort: highest outstanding first, then alphabetically
    result.sort((a, b) => {
      const diff = Math.abs(b.current_balance) - Math.abs(a.current_balance);
      return diff !== 0 ? diff : a.company_name.localeCompare(b.company_name);
    });
    setAccounts(result);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Categorise by the counterpart's role for importer's two-table view
  const suppliers = accounts.filter((a) => a.partner_role === "supplier");
  // migration 00312 stores the role as 'customs' in the DB; guard both values
  const brokers   = accounts.filter((a) => a.partner_role === "customs_agent" || a.partner_role === "customs");
  const importers = accounts.filter((a) => a.partner_role === "importer");

  const subtitle =
    role === "importer"
      ? "Your suppliers and customs brokers — click a row to view the full ledger"
      : "Your importer accounts — click a row to view the full ledger";

  return (
    <DashboardLayout role={role} title="Accounts" subtitle={subtitle}>
      <MyProfileCard />

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading accounts…</div>
      ) : (
        <>
          {/* Importer sees two sections: Suppliers + Brokers */}
          {role === "importer" && (
            <>
              <CompanySection
                title="Suppliers"
                accounts={suppliers}
                basePath={basePath}
                router={router}
              />
              <CompanySection
                title="Customs Brokers"
                accounts={brokers}
                basePath={basePath}
                router={router}
              />
              {suppliers.length === 0 && brokers.length === 0 && (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400 text-sm">
                    No partners found. Partners appear here automatically once a
                    container links your account with a supplier or broker.
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Supplier / Customs-Agent sees one section: Importers */}
          {role !== "importer" && (
            <CompanySection
              title="Importers"
              accounts={importers.length > 0 ? importers : accounts}
              basePath={basePath}
              router={router}
            />
          )}
        </>
      )}
    </DashboardLayout>
  );
}
