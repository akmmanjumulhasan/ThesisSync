import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, verifyOtp } from "@/lib/auth";

const MAX_ATTEMPTS = 5;
const INVALID_CODE_ERROR = "Invalid or expired code.";

/**
 * Common workflow: Registration & Login — step 2 of self-service password
 * recovery. Spends the code emailed by /api/auth/forgot-password and, if it
 * checks out, sets the new password.
 */
export async function POST(req: Request) {
  const { email, otp, newPassword } = await req.json().catch(() => ({}));

  if (!email || typeof email !== "string" || !otp || typeof otp !== "string") {
    return NextResponse.json({ error: "Email and code are required." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  // Same generic error whether the email doesn't exist or the code is wrong —
  // neither should be distinguishable to the caller.
  if (!user) {
    return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 400 });
  }

  const record = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) {
    return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 400 });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many incorrect attempts. Request a new code." },
      { status: 429 }
    );
  }

  const valid = await verifyOtp(otp, record.codeHash);
  if (!valid) {
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: INVALID_CODE_ERROR }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordResetOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    // Invalidate any other outstanding codes for this user so an older,
    // still-unexpired one can't also be used to reset the password again.
    prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, consumedAt: null, id: { not: record.id } },
      data: { consumedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ success: true });
}
