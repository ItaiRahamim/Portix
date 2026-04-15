"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Ship } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase";

/**
 * Root page — redirects authenticated users to their role dashboard.
 * Unauthenticated users go to /login.
 * This prevents the old "role selector" from appearing in production.
 */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    supabase.auth.getUser().then(async (res: { data: { user: { id: string } | null } }) => {
      const user = res.data.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const roleRoutes: Record<string, string> = {
        importer: "/importer",
        supplier: "/supplier",
        customs_agent: "/customs-agent",
        customs: "/customs-agent",
      };

      router.replace(profile?.role ? (roleRoutes[profile.role] ?? "/login") : "/login");
    });
  }, [router]);

  // Loading state while redirect resolves
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center animate-pulse">
          <Ship className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-gray-900 font-medium">Portix</p>
          <p className="text-gray-400 text-xs">Redirecting…</p>
        </div>
      </div>
    </div>
  );
}
