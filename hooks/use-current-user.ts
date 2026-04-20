"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/lib/supabase";

interface CurrentUser {
  userId: string | null;
  role: UserRole | null;
  isLoading: boolean;
}

/**
 * Returns the authenticated user's ID and role from portix.profiles.
 *
 * Uses getSession() (localStorage, no network) for the user ID to avoid
 * the Supabase "Lock not released within 5000ms" mutex error under
 * concurrent calls. Profile role is fetched from portix.profiles.
 */
export function useCurrentUser(): CurrentUser {
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    supabase.auth
      .getSession()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(async (res: any) => {
        const session = res?.data?.session;
        const uid = session?.user?.id ?? null;
        setUserId(uid);

        if (uid) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", uid)
            .single();
          setRole((profile?.role as UserRole) ?? "importer");
        }
      })
      .catch(() => {
        setRole("importer");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return { userId, role, isLoading };
}
