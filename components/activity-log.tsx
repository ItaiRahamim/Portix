"use client";

/**
 * ActivityLog
 *
 * Fetches portix.activity_logs for a container and renders them as a vertical
 * timeline, most recent entry first. Each event shows:
 *   - Relative/absolute timestamp
 *   - Actor (user display name + role)
 *   - Action label (colour-coded badge)
 *   - Details (human-readable description)
 *
 * Self-contained: fetches its own data, no props beyond containerId.
 */

import { useState, useEffect, useCallback } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getActivityLogs, type ActivityLog } from "@/lib/db";

// ─── action → display ────────────────────────────────────────────────────────

interface ActionMeta {
  label: string;
  className: string; // Tailwind text + bg for the badge
}

const ACTION_META: Record<string, ActionMeta> = {
  MANUAL_UPDATE:  { label: "Manual Update",   className: "bg-blue-100 text-blue-700" },
  DOC_APPROVED:   { label: "Doc Approved",     className: "bg-green-100 text-green-700" },
  DOC_REJECTED:   { label: "Doc Rejected",     className: "bg-red-100 text-red-700" },
  DOC_UPLOADED:   { label: "Doc Uploaded",     className: "bg-purple-100 text-purple-700" },
  STATUS_CHANGED: { label: "Status Changed",   className: "bg-yellow-100 text-yellow-700" },
  NOTE_ADDED:     { label: "Note Added",        className: "bg-gray-100 text-gray-600" },
};

function getActionMeta(action: string): ActionMeta {
  return ACTION_META[action] ?? { label: action, className: "bg-gray-100 text-gray-600" };
}

// ─── timestamp ────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): { relative: string; absolute: string } {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  let relative: string;
  if (diffMins < 1)        relative = "Just now";
  else if (diffMins < 60)  relative = `${diffMins}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays < 7)   relative = `${diffDays}d ago`;
  else                     relative = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const absolute = d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return { relative, absolute };
}

// ─── component ────────────────────────────────────────────────────────────────

interface Props {
  containerId: string;
}

export function ActivityLog({ containerId }: Props) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const data = await getActivityLogs(containerId);
    setLogs(data);
    setLoading(false);
  }, [containerId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            Activity Log
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={fetchLogs}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loading && logs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No activity recorded yet.</p>
        ) : (
          <ol className="relative border-l border-gray-200 space-y-0">
            {logs.map((log, i) => {
              const { relative, absolute } = formatTimestamp(log.created_at);
              const meta = getActionMeta(log.action);
              const isLast = i === logs.length - 1;

              return (
                <li key={log.id} className={`ml-4 ${isLast ? "pb-0" : "pb-5"}`}>
                  {/* Timeline dot */}
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-gray-300" />

                  <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5">
                    {/* Action badge */}
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${meta.className}`}>
                      {meta.label}
                    </span>

                    {/* Timestamp */}
                    <time
                      dateTime={log.created_at}
                      title={absolute}
                      className="text-xs text-gray-400 mt-0.5"
                    >
                      {relative}
                    </time>
                  </div>

                  {/* Actor */}
                  <p className="mt-0.5 text-xs text-gray-500">{log.actor}</p>

                  {/* Details */}
                  {log.details && (
                    <p className="mt-0.5 text-sm text-gray-700">{log.details}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
