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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { Container as ContainerIcon, X, Send, Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase";

// ─── Transport: hits the Supabase Edge Function URL with the user JWT ────────

interface UseChatTransport {
  api: string;
  headers: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransport(token: string | null): any | null {
  if (!token) return null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  const transport: UseChatTransport = {
    api:     `${supabaseUrl}/functions/v1/global-copilot`,
    headers: { Authorization: `Bearer ${token}` },
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

// ─── Main component ──────────────────────────────────────────────────────────

export function GlobalChatbot() {
  const [open, setOpen]   = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pull the user's access token once on mount. Re-fetch on auth-state change
  // so a fresh login (or sign-out) is reflected without a page reload.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).getSession().then(({ data }: { data: { session: { access_token: string } | null } }) => {
      setToken(data.session?.access_token ?? null);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sub } = (supabase.auth as any).onAuthStateChange(
      (_event: string, session: { access_token: string } | null) => {
        setToken(session?.access_token ?? null);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const transport = useMemo(() => buildTransport(token), [token]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: transport ?? undefined,
  });

  const isStreaming = status === "submitted" || status === "streaming";

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !transport || isStreaming) return;
    setInput("");
    // sendMessage accepts a UIMessage-shaped object
    sendMessage({ text });
  }

  // ── Closed state: floating button ──────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open Porty AI copilot"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg hover:shadow-xl hover:scale-110 hover:animate-pulse transition-all flex items-center justify-center group"
      >
        <ContainerIcon className="w-7 h-7 group-hover:animate-bounce" />
        {/* Tiny "online" pulse dot */}
        <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-green-400 ring-2 ring-white">
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
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
            <ContainerIcon className="w-5 h-5" />
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

      {/* Messages */}
      <ScrollArea className="flex-1 bg-gray-50">
        <div ref={scrollRef} className="px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-10 text-gray-500">
              <ContainerIcon className="w-10 h-10 mx-auto mb-2 text-blue-400" />
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
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    isUser
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-white text-gray-800 border border-gray-200 rounded-bl-sm"
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
      </ScrollArea>

      {/* Input */}
      <CardContent className="p-3 border-t bg-white">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={transport ? "Ask Porty…" : "Sign in to chat with Porty"}
            disabled={!transport || isStreaming}
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
              disabled={!input.trim() || !transport}
              className="h-9 w-9 shrink-0"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
