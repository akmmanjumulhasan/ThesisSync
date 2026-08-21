import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Module 3 (Member 3): the address a user's alerts are emailed to.
 *
 * Held apart from the account's `email`, which is the university address the
 * account was registered with. That address is often not a mailbox anyone
 * actually opens — a student registers as `23101266@g.bracu.ac.bd` and reads
 * Gmail — and an alert delivered somewhere unread is the same as no alert.
 *
 * Clearing it falls back to the account email rather than switching
 * notifications off, so this field can never leave someone silently unreachable.
 */

/** Deliberately permissive: the only real test of an address is whether mail arrives. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL = 254;

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.notificationEmail !== "string") {
    return NextResponse.json({ error: "notificationEmail is required." }, { status: 400 });
  }

  const value = body.notificationEmail.trim().slice(0, MAX_EMAIL);

  if (value && !EMAIL.test(value)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

  const saved = await prisma.user.update({
    where: { id: session.sub },
    data: { notificationEmail: value || null },
    select: { email: true, notificationEmail: true },
  });

  return NextResponse.json({
    success: true,
    notificationEmail: saved.notificationEmail,
    // So the form can say exactly where mail will land, whichever it resolved to.
    effective: saved.notificationEmail ?? saved.email,
  });
}
