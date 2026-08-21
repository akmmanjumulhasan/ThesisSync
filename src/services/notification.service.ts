import "server-only";
import prisma from "@/lib/prisma";
import { EmailJsService } from "@/services/emailjs.service";
import {
  DEADLINE_WARNING_DAYS,
  MAX_BODY,
  MAX_TITLE,
  catalogueFor,
  defaultChannels,
  isKnownEvent,
  toEmailText,
  type NotificationEvent,
  type PreferenceView,
} from "@/lib/notifications";

/**
 * Module 3 (Member 3): Smart Notification System — the connective layer.
 *
 * Three rules hold everywhere in this file:
 *
 *  1. **Notifying never breaks the thing that triggered it.** Every entry point
 *     is wrapped so an EmailJS outage cannot fail the approval, submission or
 *     invite that raised it. A dropped notification is
 *     a nuisance; a supervisor's approval lost to an email timeout is data loss.
 *  2. **The in-app record is always written**, whatever the channel
 *     preferences say. It is the evidence the event happened, and the bell menu
 *     reads it. Email is additional reach, not the record itself.
 *  3. **Every channel decision is recorded.** Sent, failed, or skipped and why —
 *     because "I never got that email" is the question this system exists to be
 *     able to answer.
 */

export interface NotifyInput {
  userId: string;
  event: NotificationEvent;
  title: string;
  body: string;
  link?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  /**
   * Collapses repeat notifications for the same subject and event. Used by the
   * deadline sweep, where the same chapter is still due tomorrow every time the
   * scheduler runs.
   */
  dedupeWithinMs?: number;
}

/** Absolute URLs for emails. Relative links are useless in an inbox. */
function origin(): string {
  return process.env.APP_ORIGIN?.replace(/\/$/, "") || "http://localhost:3000";
}

export class NotificationService {
  /**
   * Raise one notification: write the record, then fan out to the channels this
   * user has enabled for this event.
   *
   * Returns the notification id, or null when nothing was written (unknown
   * event, missing user, or suppressed as a duplicate). Callers ignore the
   * return value — it exists for tests and for the deadline sweep's counting.
   */
  static async notify(input: NotifyInput): Promise<string | null> {
    if (!isKnownEvent(input.event)) return null;

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true, email: true, notificationEmail: true, role: true },
    });
    if (!user) return null;

    // An event this role is never shown in settings is one they cannot switch
    // off, so raising it would be an alert with no consent behind it.
    if (!catalogueFor(user.role).some((s) => s.event === input.event)) return null;

    if (input.dedupeWithinMs && input.subjectId) {
      const since = new Date(Date.now() - input.dedupeWithinMs);
      const recent = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          event: input.event,
          subjectId: input.subjectId,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (recent) return null;
    }

    const title = input.title.trim().slice(0, MAX_TITLE);
    const body = input.body.trim().slice(0, MAX_BODY);

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        event: input.event,
        title,
        body,
        link: input.link ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        deliveries: {
          create: { channel: "IN_APP", status: "SENT", destination: user.email, detail: "Shown in the app." },
        },
      },
      select: { id: true },
    });

    const prefs = await NotificationService.resolvePreference(user.id, input.event);

    await NotificationService.deliverEmail(
      notification.id,
      prefs.email,
      user,
      title,
      body,
      input.link ?? null
    );

    return notification.id;
  }

  /**
   * Raise a notification without letting it break the caller.
   *
   * This is what the triggers use. `notify` itself is left throwing so tests
   * and the deadline route can see real failures.
   */
  static async safeNotify(input: NotifyInput): Promise<void> {
    try {
      await NotificationService.notify(input);
    } catch (e) {
      console.error(`[notifications] ${input.event} for ${input.userId} failed:`, e);
    }
  }

  /** Several recipients, same event. Failures are isolated per recipient. */
  static async notifyMany(inputs: NotifyInput[]): Promise<void> {
    await Promise.all(inputs.map((i) => NotificationService.safeNotify(i)));
  }

  private static async deliverEmail(
    notificationId: string,
    wanted: boolean,
    user: { name: string; email: string; notificationEmail: string | null },
    title: string,
    body: string,
    link: string | null
  ): Promise<void> {
    // The address the user actually reads, falling back to the account's
    // university email when they have not set one.
    const to = user.notificationEmail?.trim() || user.email;

    if (!wanted) {
      await NotificationService.recordDelivery(notificationId, "EMAIL", "SKIPPED", to, "Email is off for this alert.");
      return;
    }

    const result = await EmailJsService.send({
      toEmail: to,
      toName: user.name,
      subject: `ThesisSync — ${title}`,
      message: toEmailText(title, body, link, origin()),
    });

    await NotificationService.recordDelivery(
      notificationId,
      "EMAIL",
      result.ok ? "SENT" : result.unconfigured ? "SKIPPED" : "FAILED",
      to,
      result.ok ? "Delivered to EmailJS." : (result.reason ?? "Unknown error."),
      result.providerId
    );
  }

  private static async recordDelivery(
    notificationId: string,
    channel: "EMAIL" | "IN_APP",
    status: "SENT" | "FAILED" | "SKIPPED",
    destination: string | null,
    detail: string,
    providerId?: string
  ): Promise<void> {
    await prisma.notificationDelivery.upsert({
      where: { notificationId_channel: { notificationId, channel } },
      update: { status, destination, detail, providerId: providerId ?? null, attemptedAt: new Date() },
      create: { notificationId, channel, status, destination, detail, providerId: providerId ?? null },
    });
  }

  /** This user's setting for one event, falling back to the catalogue default. */
  static async resolvePreference(userId: string, event: NotificationEvent): Promise<{ email: boolean }> {
    const row = await prisma.notificationPreference.findUnique({
      where: { userId_event: { userId, event } },
      select: { email: true },
    });
    return row ?? defaultChannels(event);
  }

  /** Every event this user can configure, with their choice or the default. */
  static async preferences(userId: string, role: "STUDENT" | "SUPERVISOR" | "ADMIN"): Promise<PreferenceView[]> {
    const rows = await prisma.notificationPreference.findMany({ where: { userId } });
    const saved = new Map(rows.map((r) => [r.event as NotificationEvent, r]));

    return catalogueFor(role).map((spec) => {
      const row = saved.get(spec.event);
      return { event: spec.event, email: row ? row.email : spec.defaultEmail };
    });
  }

  static async savePreference(userId: string, event: NotificationEvent, email: boolean): Promise<void> {
    await prisma.notificationPreference.upsert({
      where: { userId_event: { userId, event } },
      update: { email },
      create: { userId, event, email },
    });
  }

  static async list(userId: string, limit = 30) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { deliveries: { orderBy: { channel: "asc" } } },
    });
  }

  static async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Mark one as read. Scoped by userId so an id alone is not enough. */
  static async markRead(userId: string, id: string): Promise<boolean> {
    const res = await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count > 0;
  }

  static async markAllRead(userId: string): Promise<number> {
    const res = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  static async remove(userId: string, id: string): Promise<boolean> {
    const res = await prisma.notification.deleteMany({ where: { id, userId } });
    return res.count > 0;
  }

  /**
   * Find chapters falling due and warn the student once each.
   *
   * Nothing in this project runs on a timer, so this is exposed as a route for
   * a scheduler (cron, GitHub Actions, Vercel Cron) to call. Written to be safe
   * to call at any frequency: `deadlineNotifiedAt` is stamped per chapter, so
   * an hourly scheduler still sends exactly one reminder per deadline.
   *
   * Only chapters the student can still act on are considered. A submitted or
   * approved chapter is out of their hands, and reminding someone about work
   * they have already delivered is how a notification system teaches people to
   * ignore it.
   */
  static async runDeadlineSweep(now = new Date()): Promise<{ scanned: number; notified: number }> {
    const horizon = new Date(now.getTime() + DEADLINE_WARNING_DAYS * 24 * 60 * 60 * 1000);

    // Unnotified only. Moving a deadline clears deadlineNotifiedAt (see the
    // route that sets dueAt), which is what re-arms the reminder — comparing
    // the two timestamps here instead would re-fire on every sweep, since the
    // stamp is always earlier than a future due date.
    const due = await prisma.thesisChapter.findMany({
      where: {
        status: "DRAFT",
        dueAt: { not: null, lte: horizon },
        deadlineNotifiedAt: null,
      },
      select: { id: true, number: true, title: true, dueAt: true, studentId: true },
    });

    let notified = 0;
    for (const chapter of due) {
      if (!chapter.dueAt) continue;

      const days = Math.ceil((chapter.dueAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const when =
        days < 0 ? `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}` : days === 0 ? "due today" : `due in ${days} day${days === 1 ? "" : "s"}`;

      const id = await NotificationService.notify({
        userId: chapter.studentId,
        event: "DEADLINE_APPROACHING",
        title: `Chapter ${chapter.number} is ${when}`,
        body: `"${chapter.title}" is still a draft and is ${when}. Submit it for approval when you are ready.`,
        link: "/dashboard/chapters",
        subjectType: "chapter",
        subjectId: chapter.id,
      });

      // Stamped whether or not a notification was written: if the student has
      // muted this event, re-checking them every hour is pure waste.
      await prisma.thesisChapter.update({
        where: { id: chapter.id },
        data: { deadlineNotifiedAt: now },
      });

      if (id) notified += 1;
    }

    return { scanned: due.length, notified };
  }

  /** Provider readiness, for the settings page to explain what will actually send. */
  static providerStatus(): { email: boolean } {
    return { email: EmailJsService.isConfigured() };
  }
}
