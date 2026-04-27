"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Package,
  FileText,
  ShieldCheck,
  Ship,
  Users,
  AlertTriangle,
  Award,
  Calculator,
  LogOut,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { toast } from "sonner";
import { Logo } from "@/components/ui/logo";

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
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.auth.getUser().then((res: any) => {
      const user = res?.data?.user;
      if (user) {
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((pd: any) => {
            setUserName(pd?.data?.full_name ?? user.email ?? null);
          });
      }
    });
  }, []);

  async function handleLogout() {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out");
    } else {
      toast.success("Signed out");
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 py-2">
            {/* Brand — links back to role home */}
            <Link href={`/${role}`} className="shrink-0 flex items-center">
              <Logo className="h-8 md:h-10 w-auto min-w-[120px]" />
            </Link>

            <div className="h-5 w-px bg-gray-200 shrink-0" />

            {/* Role pill */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.color} text-white shrink-0`}>
              <RoleIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{config.label}</span>
            </div>

            <div className="h-5 w-px bg-gray-200 shrink-0" />

            {/* Nav */}
            <nav className="flex gap-1 overflow-x-auto flex-1">
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

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 shrink-0">
                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">
                    {userName ? userName[0].toUpperCase() : "?"}
                  </div>
                  <span className="hidden sm:block text-sm text-gray-700 max-w-[140px] truncate">
                    {userName ?? "Loading…"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs text-gray-500 font-normal truncate">
                  {userName}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-600 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
