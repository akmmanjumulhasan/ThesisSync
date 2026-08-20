import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "This account has been deactivated. Contact an administrator." },
        { status: 403 }
      );
    }

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    await setSessionCookie(token);

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Failed to sign in." }, { status: 500 });
  }
}
