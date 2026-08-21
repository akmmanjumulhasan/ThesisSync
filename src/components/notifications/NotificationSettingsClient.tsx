"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EVENT_GROUPS, type EventSpec, type NotificationEvent, type PreferenceView } from "@/lib/notifications";

/**
 * Module 3 (Member 3): per-user notification settings.
 *
 * Every event in the catalogue gets its own switch. That is what "individually
 * configurable per user" means — a single global on/off would let a student
 * mute a returned chapter in order to escape contribution noise.
 *
 * Two channels exist: in-app and email. In-app is not shown here because it is
 * not optional — it is the record that the event happened, and email is extra
 * reach on top of it.
 */
export function NotificationSettingsClient({
  userName,
  catalogue,
  initialPreferences,
  providers,
}: {
  userName: string;
  catalogue: EventSpec[];
  initialPreferences: PreferenceView[];
  providers: { email: boolean };
}) {
  const [prefs, setPrefs] = useState<Record<string, PreferenceView>>(
    Object.fromEntries(initialPreferences.map((p) => [p.event, p]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(event: NotificationEvent, next: boolean) {
    const current = prefs[event];
    if (!current) return;

    setPrefs((p) => ({ ...p, [event]: { ...current, email: next } }));
    setBusy(event);
    setError(null);

    try {
      const res = await fetch("/api/notificationPreferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, email: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Roll the switch back rather than leaving the UI claiming something
        // the server refused.
        setPrefs((p) => ({ ...p, [event]: current }));
        setError(data.error ?? "That change could not be saved.");
      }
    } catch {
      setPrefs((p) => ({ ...p, [event]: current }));
      setError("Network error — your change was not saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold text-foreground">Notifications</h1>
            <Badge tone="neutral">Configurable per alert</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">Module 3 · Member 3 · EmailJS</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-background">
          <span className="text-sm text-foreground">{userName}</span>
          <Avatar name={userName} size={32} />
        </Link>
      </div>

      <div className="space-y-5 bg-background p-6">
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>}

        {!providers.email && (
          <div className="rounded-lg border border-warning-bg bg-warning-bg px-4 py-3 text-sm text-warning-foreground">
            <p className="font-medium">Email is not configured on this deployment.</p>
            <p className="mt-1 text-xs">
              Alerts you switch on are still recorded in the app, and each one records why it was not
              emailed. Add the EmailJS variables to <code>.env</code> to turn delivery on.
            </p>
          </div>
        )}

        {EVENT_GROUPS.map((group) => {
          const rows = catalogue.filter((c) => c.group === group);
          if (rows.length === 0) return null;

          return (
            <div key={group} className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-semibold text-foreground">{group}</h2>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                      <th className="py-2 pr-3 font-semibold">Alert</th>
                      <th className="w-24 py-2 text-center font-semibold">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((spec) => {
                      const pref = prefs[spec.event];
                      if (!pref) return null;

                      return (
                        <tr key={spec.event}>
                          <td className="py-3 pr-3">
                            <p className="font-medium text-foreground">{spec.label}</p>
                            <p className="mt-0.5 text-xs text-muted">{spec.description}</p>
                          </td>
                          <td className="py-3 text-center">
                            <input
                              type="checkbox"
                              checked={pref.email}
                              disabled={busy !== null}
                              onChange={(e) => toggle(spec.event, e.target.checked)}
                              aria-label={`Email for ${spec.label}`}
                              className="h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <p className="text-xs text-muted">
          In-app notifications are always on. They are the record that something happened, so they cannot be
          switched off — only email is optional.
        </p>
      </div>
    </div>
  );
}
