import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";
import { supervises } from "@/services/chapter.service";
import { MAX_BODY, MAX_TITLE } from "@/lib/notifications";

/**
 * Module 3 (Member 3): Smart Notification System — POST /api/sendNotification
 *
 * The one notification a human composes by hand. Everything else in this
 * system is raised by an event: an approval, a submission, a deadline passing.
 * This endpoint covers the requirement's "supervisor comment added" trigger,
 * where the thing worth telling a student is something their supervisor
 * decided to say rather than something the platform observed.
 *
 * Deliberately narrow. It is not a general "send anyone anything" route:
 *
 *  - only a supervisor may call it, and
 *  - only for a student whose supervision request they have accepted, and
 *  - it can only raise SUPERVISOR_COMMENT.
 *
 * Without those three, any signed-in user could post themselves an alert
 * reading "Your proposal has been approved", and the notification feed would
 * stop being evidence of anything.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.SUPERVISOR) {
    return NextResponse.json(
      { error: "Only a supervisor can send a comment to a student." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!studentId || !message) {
    return NextResponse.json({ error: "studentId and message are required." }, { status: 400 });
  }
  if (!(await supervises(session.sub, studentId))) {
    return NextResponse.json({ error: "You are not this student's accepted supervisor." }, { status: 403 });
  }

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, MAX_TITLE)
      : `${session.name} left you a comment`;

  await NotificationService.notify({
    userId: studentId,
    event: "SUPERVISOR_COMMENT",
    title,
    body: message.slice(0, MAX_BODY),
    link: typeof body.link === "string" && body.link.startsWith("/") ? body.link : "/dashboard",
    subjectType: "comment",
    subjectId: null,
  });

  return NextResponse.json({ message: "Notification Sent Successfully" });
}
