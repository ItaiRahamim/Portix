"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Package,
  FileText,
  ShieldCheck,
  FileWarning,
  Ship,
  Users,
  AlertTriangle,
  Award,
  Calculator,
} from "lucide-react";

interface DashboardLayoutProps {
  role: "importer" | "supplier" | "customs-agent";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

const roleConfig = {
  importer: {
    color: "bg-blue-600",
    label: "Importer",
    icon: Package,
    nav: [
      { label: "Containers", path: "/importer", icon: Ship },
      { label: "Accounts", path: "/importer/accounts", icon: Users },
      { label: "Claims", path: "/importer/claims", icon: AlertTriangle },
      { label: "Licenses", path: "/importer/licenses", icon: Award },
      { label: "Calculator", path: "/importer/calculator", icon: Calculator },
    ],
  },
  supplier: {
    color: "bg-green-600",
    label: "Supplier",
    icon: FileText,
    nav: [
      { label: "Containers", path: "/supplier", icon: Ship },
      { label: "Accounts", path: "/supplier/accounts", icon: Users },
      { label: "Claims", path: "/supplier/claims", icon: AlertTriangle },
    ],
  },
  "customs-agent": {
    color: "bg-purple-600",
    label: "Customs Agent",
    icon: ShieldCheck,
    nav: [
      { label: "Containers", path: "/customs-agent", icon: Ship },
      { label: "Accounts", path: "/customs-agent/accounts", icon: Users },
    ],
  },
};

export function DashboardLayout({ role, title, subtitle, children }: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const config = roleConfig[role];
  const RoleIcon = config.icon;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-4 py-3">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="shrink-0">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Home
            </Button>
            <div className="h-6 w-px bg-gray-200" />
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${config.color} text-white`}>
              <RoleIcon className="w-4 h-4" />
              <span className="text-sm">{config.label}</span>
            </div>
            <div className="flex-1" />
            <nav className="flex gap-1 overflow-x-auto">
              {config.nav.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.path ||
                  (item.path !== `/${role}` && pathname.startsWith(item.path));
                return (
                  <Link key={item.path} href={item.path}>
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      className="gap-1.5 whitespace-nowrap"
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-4">
        <div className="mb-6">
          <h1 className="text-2xl text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm mt-1">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
