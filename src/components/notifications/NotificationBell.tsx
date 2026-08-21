"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "@/components/ui/icons";
import { timeAgo } from "@/lib/time";
import type { NotificationView } from "@/lib/notifications";

/**
 * Module 3 (Member 3): the notification bell.
 *
 * Polls rather than holding a socket open. A thesis platform raises a handful
 * of events a day, and a WebSocket per signed-in user to carry that would be a
 * standing cost for a trickle of traffic. Polling stops while the tab is hidden
 * so a backgrounded tab is not making requests all night.
 */

const POLL_MS = 60_000;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/getNotifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // A failed poll leaves the last known state on screen. Blanking the bell
      // because one request lost the network would be worse than stale.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Close on an outside click, so the panel does not sit over the page.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAll() {
    setLoading(true);
    try {
      await fetch("/api/markAllAsRead", { method: "PUT" });
      await load();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function openOne(n: NotificationView) {
    if (!n.readAt) {
      await fetch(`/api/markAsRead/${n.id}`, { method: "PUT" }).catch(() => {});
      load();
    }
    setOpen(false);
  }

  async function remove(id: string) {
    await fetch(`/api/deleteNotification/${id}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-sidebar-fg/85 transition-colors hover:bg-sidebar-hover"
      >
        <BellIcon className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={loading}
                className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id} className={n.readAt ? "bg-surface" : "bg-background"}>
                    <div className="flex items-start gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        {n.link ? (
                          <Link href={n.link} onClick={() => openOne(n)} className="block">
                            <p className="text-sm font-medium text-foreground hover:underline">{n.title}</p>
                          </Link>
                        ) : (
                          <p className="text-sm font-medium text-foreground">{n.title}</p>
                        )}
                        <p className="mt-0.5 text-xs leading-relaxed text-muted">{n.body}</p>
                        <p className="mt-1 text-[11px] text-muted/80">{timeAgo(new Date(n.createdAt))}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(n.id)}
                        aria-label="Dismiss"
                        className="shrink-0 text-xs text-muted hover:text-danger-foreground"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-accent hover:bg-background"
          >
            Notification settings
          </Link>
        </div>
      )}
    </div>
  );
}
