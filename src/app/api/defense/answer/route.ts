import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { DefenseService } from "@/services/defense.service";

/**
 * Module 3 (Member 2): the candidate's answer, and the examiner's reply.
 *
 * The reply is streamed rather than returned whole. A viva is a conversation,
 * and watching an examiner's response appear is a materially different
 * rehearsal from waiting ten seconds for a verdict to drop in complete.
 */

export const maxDuration = 120;

const MAX_ANSWER = 6000;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  if (session.role !== Role.STUDENT) {
    return NextResponse.json(
      { error: "The mock defense is available to student accounts." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const interactionId = typeof body?.interactionId === "string" ? body.interactionId : "";
  const answer = typeof body?.answer === "string" ? body.answer.trim().slice(0, MAX_ANSWER) : "";

  if (!interactionId) {
    return NextResponse.json({ error: "Which question is being answered?" }, { status: 400 });
  }
  if (!answer) {
    return NextResponse.json({ error: "Write an answer before submitting." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const chunks = DefenseService.answer(session.sub, interactionId, answer);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        // The stream has already begun, so an error cannot become a status
        // code. It is written into the text instead, where the page shows it.
        const message = error instanceof Error ? error.message : "The examiner stopped responding.";
        controller.enqueue(encoder.encode(`\n\n[${message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Without this a proxy may hold the response until it completes, which
      // would defeat the point of streaming it.
      "X-Accel-Buffering": "no",
    },
  });
}
