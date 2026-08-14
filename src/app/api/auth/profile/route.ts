import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession, createSessionToken, setSessionCookie } from "@/lib/auth";

/** Lets a signed-in user rename themselves from the Profile page. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Your name is required." }, { status: 400 });
  }

  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) {
    return NextResponse.json({ error: "Name must be at least 2 characters." }, { status: 400 });
  }
  if (trimmed.length > 100) {
    return NextResponse.json({ error: "Name must be 100 characters or fewer." }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.sub },
    data: { name: trimmed },
    select: { id: true, name: true, email: true, role: true },
  });

  // The session JWT carries the display name — it's what the sidebar, the page
  // headers, and every avatar read. Without re-issuing it the user would keep
  // seeing their old name everywhere until the cookie expired.
  await setSessionCookie(
    await createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    })
  );

  return NextResponse.json({ success: true, name: user.name });
}
