import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateOtp, hashOtp } from "@/lib/auth";
import { EmailJsService } from "@/services/emailjs.service";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between codes for the same account

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a 6-digit code to it.";

/**
 * Common workflow: Registration & Login — step 1 of self-service password
 * recovery. Sends a one-time code to the account's email so a locked-out user
 * (someone who has forgotten their password, not just changed it) can prove
 * ownership and set a new one via /api/auth/reset-password.
 *
 * Always responds with the same generic message regardless of whether the
 * email matches an account — otherwise this endpoint would double as an
 * email-enumeration oracle.
 */
export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, notificationEmail: true },
  });

  if (user) {
    const recent = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    // Within the cooldown: don't mint or send another code, but still answer
    // with the generic message so timing/response shape can't reveal whether
    // the address exists.
    if (!recent) {
      const code = generateOtp();
      const codeHash = await hashOtp(code);

      await prisma.passwordResetOtp.create({
        data: { userId: user.id, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      });

      const to = user.notificationEmail?.trim() || user.email;
      const result = await EmailJsService.send({
        toEmail: to,
        toName: user.name,
        subject: "ThesisSync — Your password reset code",
        message: [
          `Your ThesisSync password reset code is ${code}.`,
          "",
          "It expires in 10 minutes. If you didn't request this, you can safely ignore this email.",
        ].join("\n"),
      });

      if (!result.ok) {
        // Never surfaced to the caller (see GENERIC_MESSAGE) — this is purely
        // so an unconfigured/failing EmailJS is visible to whoever runs the
        // server, instead of silently looking like a sent email forever.
        console.error(`[forgot-password] could not email ${to}:`, result.reason);
      }
    }
  }

  return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
}
