import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { hashPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, password, studentId, department, role, researchInterests, maxLoad } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, and password are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }

    const resolvedRole: Role = role === "SUPERVISOR" ? Role.SUPERVISOR : Role.STUDENT;
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        studentId: studentId || null,
        department: department || null,
        role: resolvedRole,
        ...(resolvedRole === Role.STUDENT
          ? { studentProfile: { create: {} } }
          : {
              supervisorProfile: {
                create: {
                  researchInterests: Array.isArray(researchInterests) ? researchInterests : [],
                  maxLoad: typeof maxLoad === "number" && maxLoad > 0 ? maxLoad : 5,
                },
              },
            }),
      },
    });

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    await setSessionCookie(token);

    return NextResponse.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
  }
}
