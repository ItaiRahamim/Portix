"use client";

/**
 * Portix — Global AI Copilot ("Porty")
 *
 * Floating chat widget visible on every authenticated dashboard screen.
 * Streams responses from the `global-copilot` Supabase Edge Function via
 * @ai-sdk/react useChat + TextStreamChatTransport (plain text deltas).
 *
 * Persona, system prompt, and rate-limit gate live server-side in the
 * Edge Function — this component is pure UI + transport plumbing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// Native overflow-y-auto used instead of shadcn ScrollArea — Radix's viewport
// wrapper inside a flex column doesn't always propagate height correctly,
// leaving the message list non-scrollable for long answers.
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { X, Send, Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase";

// ─── Porty avatar ────────────────────────────────────────────────────────────
// A humanized shipping-container mascot: ridged body, glasses over big eyes,
// and a tiny hand that waves on hover (.group:hover triggers .porty-hand
// keyframes defined in app/globals.css).

interface PortyAvatarProps {
  size?: number;          // pixel size of the wrapper square
  className?: string;
  /** Show the waving hand. Disable for compact header use. */
  showHand?: boolean;
}

function PortyAvatar({ size = 44, className = "", showHand = true }: PortyAvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      {/* Container body — gentle bob */}
      <g className="porty-body">
        {/* Body shell */}
        <rect x="8" y="14" width="48" height="38" rx="4" fill="#fde68a" stroke="#92400e" strokeWidth="1.5" />
        {/* Ridges (vertical lines characteristic of intermodal containers) */}
        <g stroke="#b45309" strokeWidth="1" opacity="0.55">
          <line x1="16" y1="18" x2="16" y2="48" />
          <line x1="22" y1="18" x2="22" y2="48" />
          <line x1="28" y1="18" x2="28" y2="48" />
          <line x1="36" y1="18" x2="36" y2="48" />
          <line x1="42" y1="18" x2="42" y2="48" />
          <line x1="48" y1="18" x2="48" y2="48" />
        </g>
        {/* Top + bottom rails */}
        <rect x="8" y="14" width="48" height="3" fill="#92400e" opacity="0.35" />
        <rect x="8" y="49" width="48" height="3" fill="#92400e" opacity="0.35" />

        {/* Eyes (white sclera) */}
        <ellipse cx="24" cy="30" rx="6" ry="6.5" fill="#ffffff" stroke="#1f2937" strokeWidth="1.2" />
        <ellipse cx="40" cy="30" rx="6" ry="6.5" fill="#ffffff" stroke="#1f2937" strokeWidth="1.2" />
        {/* Pupils — blink-animated via CSS */}
        <circle className="porty-eye" cx="24" cy="31" r="2.2" fill="#1f2937" />
        <circle className="porty-eye" cx="40" cy="31" r="2.2" fill="#1f2937" />
        {/* Eye sparkle */}
        <circle cx="25.2" cy="29.6" r="0.7" fill="#ffffff" />
        <circle cx="41.2" cy="29.6" r="0.7" fill="#ffffff" />

        {/* Glasses frames + bridge */}
        <g fill="none" stroke="#1f2937" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="24" cy="30" r="8" />
          <circle cx="40" cy="30" r="8" />
          <line x1="32" y1="30" x2="32" y2="30" strokeWidth="2" />
          <path d="M 32 30 L 32 30 M 31.5 30 L 32.5 30" />
          {/* Bridge between lenses */}
          <line x1="31.5" y1="30" x2="32.5" y2="30" strokeWidth="3" strokeLinecap="butt" />
          <line x1="31.5" y1="30" x2="32.5" y2="30" strokeWidth="2" />
          <line x1="16" y1="30" x2="13" y2="29" />
          <line x1="48" y1="30" x2="51" y2="29" />
        </g>
        {/* Mouth — small friendly smile */}
        <path
          d="M 27 42 Q 32 46 37 42"
          fill="none"
          stroke="#1f2937"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* Cheek blush */}
        <circle cx="18" cy="40" r="2" fill="#fb7185" opacity="0.55" />
        <circle cx="46" cy="40" r="2" fill="#fb7185" opacity="0.55" />
      </g>

      {/* Waving hand — anchored at top-right corner of body */}
      {showHand && (
        <g className="porty-hand">
          {/* Forearm */}
          <rect x="51" y="18" width="3.5" height="8" rx="1.5" fill="#fde68a" stroke="#92400e" strokeWidth="1" />
          {/* Palm */}
          <circle cx="53" cy="14" r="3.5" fill="#fde68a" stroke="#92400e" strokeWidth="1" />
          {/* Tiny fingers hint */}
          <path
            d="M 51 12 Q 53 10 55 12"
            fill="none"
            stroke="#92400e"
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}

// ─── Transport: hits the Supabase Edge Function URL with the user JWT ────────
// IMPORTANT: build the transport whenever NEXT_PUBLIC_SUPABASE_URL is present,
// even if the user JWT isn't loaded yet. Returning null here makes useChat
// fall back to its default '/api/chat' route which doesn't exist in this
// Next.js app — the request 404s and the chatbot renders the Next 404 HTML
// page as a "response" (the original symptom).

interface UseChatTransport {
  api: string;
  headers: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransport(token: string | null): any | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      "[GlobalChatbot] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing — Porty cannot reach the edge function.",
    );
    return null;
  }

  // Headers Supabase Edge Functions expect:
  //   apikey         — required by the gateway for every request
  //   Authorization  — Bearer <user_jwt> so the function can call
  //                    supabase.auth.getUser() and resolve auth.uid()
  //
  // IMPORTANT: don't fall back to the anon key for Authorization. New-format
  // anon keys (sb_publishable_…) are NOT JWTs and the gateway rejects them
  // with UNAUTHORIZED_INVALID_JWT_FORMAT. Only attach Authorization when
  // we have a real user JWT (which always starts with "eyJ").
  const headers: Record<string, string> = { apikey: anonKey };
  const cleanToken = (token ?? "").trim();
  if (cleanToken && cleanToken.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${cleanToken}`;
  }

  const transport: UseChatTransport = {
    api: `${supabaseUrl}/functions/v1/global-copilot`,
    headers,
  };
  // TextStreamChatTransport accepts {api, headers} via constructor options.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new TextStreamChatTransport(transport as any);
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/** Pull plain text out of a UIMessage (parts can hold text + tool calls). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMessageText(m: any): string {
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.parts)) {
    return m.parts
      .filter((p: { type?: string }) => p?.type === "text")
      .map((p: { text?: string }) => p?.text ?? "")
      .join("");
  }
  return "";
}

// ─── Inner panel — mounted ONLY when a valid user JWT is in hand ─────────────
// Splitting this out so useChat() initializes with a transport that already
// carries the Authorization header. Mounting the hook before the token is
// loaded caused a stale closure in @ai-sdk/react: the internal fetcher kept
// using the headers from first-render forever, producing UNAUTHORIZED_NO_AUTH_HEADER
// once the token finally arrived.
//
// `token` here is guaranteed JWT-shaped (parent already checks startsWith("eyJ")).
// `key={token}` on the parent's render of this component remounts cleanly on
// token rotation (logout → login as a different user), preventing any cross-
// session message bleed.

interface PortyChatPanelProps {
  token: string;
}

function PortyChatPanel({ token }: PortyChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Transport built once at mount because `token` is already valid here.
  // useMemo gives it a stable identity for the hook's lifetime.
  const transport = useMemo(() => buildTransport(token), [token]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: transport ?? undefined,
  });

  const isStreaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ text });
  }

  return (
    <>
      {/* Messages — flex-1 + min-h-0 lets the column shrink and scroll;
          overflow-y-auto is what actually triggers the scroll. */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 py-4 space-y-3"
      >
          {messages.length === 0 && (
            <div className="text-center py-10 text-gray-500">
              <div className="group inline-block mb-2">
                <PortyAvatar size={64} />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">Ask Porty anything</p>
              <p className="text-xs text-gray-500 px-4 leading-relaxed">
                Incoterms, Israeli customs codes, B/L vs Sea Waybill, demurrage,
                HS-code lookups… give it a try.
              </p>
            </div>
          )}

          {messages.map((m) => {
            const text = renderMessageText(m);
            if (!text) return null;
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                {/* dir="auto" lets the browser autodetect direction per message,
                    so a Hebrew reply flows RTL inside the same bubble while
                    English replies stay LTR — no broken mixed-script layout.
                    text-start/end are logical (honour dir), so the alignment
                    matches the script direction. */}
                <div
                  dir="auto"
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    isUser
                      ? "bg-blue-600 text-white rounded-br-sm text-end"
                      : "bg-white text-gray-800 border border-gray-200 rounded-bl-sm text-start"
                  }`}
                >
                  {text}
                </div>
              </div>
            );
          })}

          {/* Streaming pulse while waiting for first token */}
          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3.5 py-2 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error.message ?? "Something went wrong."}
            </div>
          )}
      </div>

      {/* Input */}
      <CardContent className="p-3 border-t bg-white">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Porty…"
            disabled={isStreaming}
            rows={1}
            className="resize-none min-h-9 max-h-32 text-sm py-2"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => stop()}
              className="h-9 w-9 shrink-0"
              aria-label="Stop generation"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              className="h-9 w-9 shrink-0"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      </CardContent>
    </>
  );
}

// ─── Outer component — owns auth + open state ────────────────────────────────

export function GlobalChatbot() {
  const [open, setOpen]   = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // Pull the user's access token once on mount. Re-fetch on auth-state change
  // so a fresh login (or sign-out) is reflected without a page reload.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).getSession().then(({ data }: { data: { session: { access_token: string } | null } }) => {
      setToken(data.session?.access_token ?? null);
      setAuthLoaded(true);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sub } = (supabase.auth as any).onAuthStateChange(
      (_event: string, session: { access_token: string } | null) => {
        setToken(session?.access_token ?? null);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // A token is "ready" only when it's a real JWT — never an anon publishable key
  const validToken = !!token && token.startsWith("eyJ");

  // ── Closed state: floating button ──────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open Porty AI copilot"
        onClick={() => setOpen(true)}
        className="group fixed bottom-6 right-6 z-[9999] w-16 h-16 rounded-full bg-gradient-to-br from-sky-100 to-blue-200 text-white shadow-lg hover:shadow-2xl hover:scale-110 transition-all flex items-center justify-center ring-2 ring-white"
      >
        <PortyAvatar size={56} />
        {/* Online pulse dot */}
        <span className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-green-400 ring-2 ring-white">
          <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
        </span>
      </button>
    );
  }

  // ── Open state: messenger card ─────────────────────────────────────────────
  return (
    <Card className="fixed bottom-6 right-6 z-[9999] w-[min(92vw,380px)] h-[min(80vh,560px)] flex flex-col shadow-2xl border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <PortyAvatar size={36} showHand={false} />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Porty</p>
            <p className="text-xs text-blue-100">Your logistics copilot</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="text-white/80 hover:text-white p-1 -mr-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body — only mount the chat panel once we have a real JWT */}
      {!authLoaded ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading session…
        </div>
      ) : !validToken ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <div>
            <div className="group inline-block mb-3">
              <PortyAvatar size={56} />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Sign in to chat with Porty</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Porty pulls answers from your own container documents, so it
              needs to know who you are before it can help.
            </p>
          </div>
        </div>
      ) : (
        // KEY ON TOKEN: any session refresh / re-login fully remounts useChat
        // so the new Authorization header is captured from the start.
        <PortyChatPanel key={token} token={token!} />
      )}
    </Card>
  );
}
