import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";

/**
 * Sanitises the `next` query-param to prevent open-redirect attacks.
 * Only allows relative paths that start with "/" and do not start with "//",
 * which would be interpreted as a protocol-relative URL by the browser.
 */
function safeRedirectPath(raw: string | null): string {
  if (!raw) return "/";
  // Must be a relative path: starts with "/" but NOT "//"
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // After exchanging the code, look up the user's role to route correctly
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profile?.role) {
          const roleRoutes: Record<string, string> = {
            importer: "/importer",
            supplier: "/supplier",
            customs_agent: "/customs-agent",
            customs: "/customs-agent",
          };
          // Role-based route takes priority; fall back to sanitised `next`
          const destination = roleRoutes[profile.role] ?? next;
          return NextResponse.redirect(new URL(destination, origin));
        }
      }

      // No profile yet — send to sanitised `next`
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Something went wrong — redirect to login with error
  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", origin));
}
