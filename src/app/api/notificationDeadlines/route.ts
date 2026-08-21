import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { NotificationService } from "@/services/notification.service";

/**
 * Module 3 (Member 3): the deadline sweep.
 *
 * Every other notification is raised by someone doing something. "Deadline
 * approaching" is the exception — nothing happens, time simply passes — so it
 * needs something to call it. Nothing in this project runs on a timer, so this
 * is a route a scheduler hits (cron, GitHub Actions, Vercel Cron).
 *
 * Two ways in, because it has two callers with nothing in common:
 *
 *  - A scheduler presents `NOTIFICATIONS_CRON_SECRET` as a bearer token. It has
 *    no session and never will.
 *  - A signed-in supervisor can trigger it by hand, which makes the feature
 *    demonstrable without waiting for a scheduler to be configured.
 *
 * Safe to call at any frequency: each chapter is stamped once per deadline, so
 * an hourly schedule still produces exactly one reminder per due date.
 */
export async function POST(req: Request) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  // Compared only when a secret is actually configured, so an unset variable
  // can never authorise a caller by matching undefined against undefined.
  const viaCron = Boolean(secret && bearer && bearer === secret);

  if (!viaCron) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    if (session.role !== Role.SUPERVISOR) {
      return NextResponse.json(
        { error: "Only a supervisor or the scheduler can run the deadline sweep." },
        { status: 403 }
      );
    }
  }

  const result = await NotificationService.runDeadlineSweep();
  return NextResponse.json({ success: true, ...result, triggeredBy: viaCron ? "scheduler" : "supervisor" });
}
