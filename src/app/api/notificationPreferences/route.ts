import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";
import { catalogueFor, isKnownEvent, specFor } from "@/lib/notifications";

/**
 * Module 3 (Member 3): per-user notification settings.
 *
 * "Individually configurable per user" is the part of the requirement this
 * route exists for. A user chooses email per event; the in-app record is not
 * configurable, because it is the audit trail rather than an alert.
 */

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const preferences = await NotificationService.preferences(session.sub, session.role);

  return NextResponse.json({
    preferences,
    catalogue: catalogueFor(session.role),
    // So the page can say "email is not set up on this deployment" rather than
    // letting a user switch on a channel that will only ever record SKIPPED.
    providers: NotificationService.providerStatus(),
  });
}

/** PUT: save one event's email setting. */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  if (typeof body.event !== "string" || !isKnownEvent(body.event)) {
    return NextResponse.json({ error: "A known event is required." }, { status: 400 });
  }

  const spec = specFor(body.event);
  if (!spec || !catalogueFor(session.role).some((s) => s.event === body.event)) {
    return NextResponse.json({ error: "That alert does not apply to your account." }, { status: 403 });
  }

  await NotificationService.savePreference(session.sub, body.event, body.email === true);
  return NextResponse.json({ success: true });
}
