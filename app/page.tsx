"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { Logo } from "@/components/ui/logo";

/**
 * Root page — redirects authenticated users to their role dashboard.
 * Unauthenticated users go to /login.
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

  // Splash screen shown for the brief moment before the redirect fires
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <Logo className="h-20 w-auto" />
        <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
      </div>
    </div>
  );
}
