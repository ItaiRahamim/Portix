"use client";

/**
 * EtaCalendarWidget
 *
 * Wide, compact monthly calendar that highlights days with container ETAs.
 * Clicking a day that has arrivals opens a Sheet drawer listing those containers.
 *
 * Timezone-safe date comparison: all dates are normalised to "YYYY-MM-DD"
 * strings in local time so there are no UTC midnight-shift surprises.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ContainerStatusBadge } from "@/components/status-badge";
import { CARRIER_LABELS, type CarrierKey } from "@/lib/tracking";
import type { ContainerView } from "@/lib/supabase";

// ─── date helpers ─────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in local time — avoids UTC-midnight shift from new Date(str). */
function toLocalDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-GB", {
    month: "long", year: "numeric",
  });
}

function dayLabel(dateKey: string): string {
  // dateKey = "YYYY-MM-DD"
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** Build the grid of day strings for the given month (including leading/trailing empty slots). */
function buildCalendarGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Shift so week starts Monday (ISO). Sunday = 6, Mon=0 … Sat=5
  const startOffset = (firstDay + 6) % 7;

  const cells: (string | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const m = String(month + 1).padStart(2, "0");
    const day = String(d).padStart(2, "0");
    cells.push(`${year}-${m}-${day}`);
  }
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── props & component ────────────────────────────────────────────────────────

interface Props {
  containers: ContainerView[];
}

export function EtaCalendarWidget({ containers }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Build ETA lookup: dateKey → ContainerView[]
  const etaMap = useMemo(() => {
    const map = new Map<string, ContainerView[]>();
    for (const c of containers) {
      if (!c.eta) continue;
      const key = toLocalDateKey(c.eta);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [containers]);

  const cells = useMemo(() => buildCalendarGrid(year, month), [year, month]);
  const today_key = todayKey();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const selectedContainers = selectedKey ? (etaMap.get(selectedKey) ?? []) : [];

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              ETA Calendar — {monthLabel(year, month)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
              >
                Today
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-3 pb-3">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAY_HEADERS.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden border border-gray-100">
            {cells.map((key, i) => {
              if (!key) {
                return <div key={`empty-${i}`} className="bg-white min-h-[60px]" />;
              }

              const arrivals = etaMap.get(key);
              const count = arrivals?.length ?? 0;
              const isToday = key === today_key;
              const hasPast = key < today_key;

              return (
                <div
                  key={key}
                  onClick={() => count > 0 && setSelectedKey(key)}
                  className={[
                    "bg-white min-h-[60px] flex flex-col p-1.5 transition-colors",
                    count > 0 ? "cursor-pointer hover:bg-blue-50" : "",
                    count > 0 ? "bg-blue-50/40" : "",
                    isToday ? "ring-1 ring-inset ring-blue-400" : "",
                    hasPast ? "opacity-50" : "",
                  ].join(" ")}
                >
                  {/* Day number */}
                  <span
                    className={[
                      "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full",
                      isToday ? "bg-blue-600 text-white" : "text-gray-500",
                    ].join(" ")}
                  >
                    {parseInt(key.slice(8), 10)}
                  </span>

                  {/* ETA badge */}
                  {count > 0 && (
                    <div className="mt-auto flex items-center gap-1 flex-wrap">
                      <span className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                        {count} ETA
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Drill-down Sheet ──────────────────────────────────────────── */}
      <Sheet open={!!selectedKey} onOpenChange={(open) => { if (!open) setSelectedKey(null); }}>
        <SheetContent side="right" className="w-[380px] sm:w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              {selectedKey ? dayLabel(selectedKey) : ""}
            </SheetTitle>
            <p className="text-sm text-gray-500">
              {selectedContainers.length} container{selectedContainers.length !== 1 ? "s" : ""} arriving
            </p>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-3">
            {selectedContainers.map((c) => {
              const carrierLabel = c.carrier
                ? (CARRIER_LABELS[c.carrier as CarrierKey] ?? c.carrier.toUpperCase())
                : null;

              return (
                <div
                  key={c.id}
                  className="rounded-lg border border-gray-200 p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/importer/containers/${c.id}`}
                      className="font-medium text-sm text-blue-600 hover:underline"
                      onClick={() => setSelectedKey(null)}
                    >
                      {c.container_number}
                    </Link>
                    <ContainerStatusBadge status={c.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {carrierLabel && <span>{carrierLabel}</span>}
                    <span>{c.supplier_company}</span>
                  </div>
                  {c.product_name && (
                    <p className="text-xs text-gray-400 truncate">{c.product_name}</p>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
