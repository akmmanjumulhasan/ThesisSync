import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestEvents, type IncomingEvent } from "@/services/git-analytics.service";

/**
 * Module 2 (Member 2): Git-to-Task Contribution Analytics — GitHub webhook sink.
 *
 * Configure at Settings → Webhooks with content type application/json, the
 * secret in GITHUB_WEBHOOK_SECRET, and the "Pushes" and "Pull requests" events.
 *
 * This is the one route in the app reachable without a session — GitHub has no
 * cookie — so the HMAC signature *is* the authentication. An unsigned or
 * mis-signed payload is rejected before it is parsed as JSON.
 */

/** GitHub signs the raw body, so it has to be read as text, never as parsed JSON. */
async function isValidSignature(raw: string, signature: string | null): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

interface PushCommit {
  id: string;
  message: string;
  url: string;
  timestamp: string;
  author?: { name?: string; username?: string };
}

export async function POST(req: Request) {
  const raw = await req.text();
  const event = req.headers.get("x-github-event");

  if (!(await isValidSignature(raw, req.headers.get("x-hub-signature-256")))) {
    // Deliberately terse: a signature oracle shouldn't explain itself.
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  // GitHub pings a new webhook once before sending anything real.
  if (event === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  const repository = payload.repository as { full_name?: string } | undefined;
  const repo = repository?.full_name;
  if (!repo) {
    return NextResponse.json({ error: "Payload has no repository." }, { status: 400 });
  }

  const incoming: IncomingEvent[] = [];

  if (event === "push") {
    const commits = (payload.commits ?? []) as PushCommit[];
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const branch = ref?.replace("refs/heads/", "") ?? null;
    const pusher = payload.pusher as { name?: string } | undefined;
    const sender = payload.sender as { login?: string } | undefined;

    for (const commit of commits) {
      incoming.push({
        externalId: `push:${commit.id}`,
        type: "PUSH",
        repo,
        actorLogin: commit.author?.username ?? sender?.login ?? pusher?.name ?? "unknown",
        actorName: commit.author?.name ?? null,
        message: commit.message,
        sha: commit.id,
        branch,
        url: commit.url,
        occurredAt: new Date(commit.timestamp),
      });
    }
  } else if (event === "pull_request") {
    const action = typeof payload.action === "string" ? payload.action : "updated";
    const pr = payload.pull_request as
      | {
          number: number;
          title: string;
          state: string;
          html_url: string;
          updated_at: string;
          merged_at: string | null;
          user?: { login?: string };
          head?: { ref?: string };
        }
      | undefined;

    if (pr) {
      incoming.push({
        externalId: `pr:${pr.number}:${action}`,
        type: "PULL_REQUEST",
        repo,
        actorLogin: pr.user?.login ?? "unknown",
        actorName: null,
        message: pr.title,
        prNumber: pr.number,
        // A merged PR reports state "closed"; the board cares about the difference.
        prState: pr.merged_at ? "merged" : pr.state,
        branch: pr.head?.ref ?? null,
        url: pr.html_url,
        occurredAt: new Date(pr.updated_at),
      });
    }
  } else {
    // Subscribed to something we don't model yet: acknowledge so GitHub doesn't
    // mark the delivery failed and start retrying it.
    return NextResponse.json({ ok: true, ignored: event });
  }

  const result = await ingestEvents(incoming);
  return NextResponse.json({ ok: true, ...result });
}
