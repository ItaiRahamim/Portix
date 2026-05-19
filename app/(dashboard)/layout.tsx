/**
 * Authenticated dashboard layout.
 *
 * Wraps every page under app/(dashboard)/* — importer, supplier, and
 * customs-agent routes — and mounts the global "Porty" copilot so it
 * persists across navigation (Containers → Claims → Finance, etc.).
 *
 * Auth flows (/auth, /login, /) sit OUTSIDE this route group and therefore
 * never see the chatbot.
 */

import { GlobalChatbot } from "@/components/GlobalChatbot";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <GlobalChatbot />
    </>
  );
}
