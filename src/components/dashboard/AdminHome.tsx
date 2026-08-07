import { Avatar } from "@/components/ui/Avatar";
import { firstName as getFirstName } from "@/lib/format";
import type { SessionPayload } from "@/lib/auth";

export function AdminHome({ session }: { session: SessionPayload }) {
  const firstName = getFirstName(session.name);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">Admin</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{session.name}</span>
          <Avatar name={session.name} size={36} />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <p className="font-serif text-lg font-semibold text-foreground">Admin panel: coming soon</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Account management, the institutional thesis repository, and platform-wide notification rules
          will live here.
        </p>
      </div>
    </div>
  );
}
