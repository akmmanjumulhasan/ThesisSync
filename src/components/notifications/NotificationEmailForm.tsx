"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/**
 * Module 3 (Member 3): where this user's alerts get emailed.
 *
 * Sits beside the GitHub verification on the profile page, because it is the
 * same kind of thing: an external detail the platform needs from the user in
 * order to reach them somewhere the account itself does not already say.
 *
 * Always shows the address that will actually be used, resolved rather than
 * described. "Leave blank to use your university email" is a rule the user has
 * to apply themselves; naming the resolved address is not.
 */
export function NotificationEmailForm({
  accountEmail,
  initialNotificationEmail,
  emailConfigured,
}: {
  accountEmail: string;
  initialNotificationEmail: string | null;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialNotificationEmail ?? "");
  const [saved, setSaved] = useState(initialNotificationEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const effective = saved.trim() || accountEmail;
  const usingFallback = !saved.trim();

  async function save() {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/notificationEmail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmail: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That address could not be saved.");
        return;
      }
      setSaved(data.notificationEmail ?? "");
      setNote(
        data.notificationEmail
          ? `Alerts will now go to ${data.notificationEmail}.`
          : `Cleared — alerts will go to your university email, ${accountEmail}.`
      );
      router.refresh();
    } catch {
      setError("Network error — your address was not saved.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="font-serif text-lg font-semibold text-foreground">Notification email</h2>
        {usingFallback ? <Badge tone="neutral">Using university email</Badge> : <Badge tone="success">Custom</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">
        Where ThesisSync emails your alerts — approvals, chapter feedback, deadlines and comments. Your
        university address is often not a mailbox you read, so set the one you actually check.
      </p>

      {!emailConfigured && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
          Email delivery is not configured on this deployment yet, so nothing will be sent. Your address is
          saved and will be used once it is.
        </p>
      )}

      {error && <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-foreground">{error}</p>}
      {note && <p className="mt-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success-foreground">{note}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={accountEmail}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
        />
        <Button variant="outline" disabled={loading || value.trim() === saved.trim()} onClick={save}>
          {loading ? "Saving…" : "Save"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted">
        Alerts currently go to <span className="font-medium text-foreground">{effective}</span>
        {usingFallback && " — leave the box empty to keep using it."}
      </p>
    </div>
  );
}
