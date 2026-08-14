import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  MIN_DRAFT_WORDS,
  UnreadableDocumentError,
  extractDocumentText,
} from "@/lib/document-text";
import { runCheck, saveCheck } from "@/services/novelty.service";
import { wordCount } from "@/lib/similarity";

/**
 * Module 2 (Member 3): Topic Novelty & Similarity Checker — the draft stage.
 *
 * The same engine, pointed at an uploaded chapter: tokenized and scored for
 * TF-IDF cosine similarity against archived theses, flagging duplication before
 * submission.
 *
 * External papers are deliberately not consulted here. At the draft stage the
 * question is "does this duplicate work this university already holds", which
 * the archive answers on its own; a novelty percentage would be the wrong
 * number to put in front of someone about to submit.
 */

/** Generous for a chapter, small enough that a stray upload cannot exhaust memory. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Send the draft as multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  const pasted = form.get("text");

  let text: string;
  let sourceName: string;

  if (file instanceof File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "That file is larger than 10 MB." }, { status: 413 });
    }
    try {
      const extracted = extractDocumentText(file.name, Buffer.from(await file.arrayBuffer()));
      text = extracted.text;
      sourceName = file.name;
    } catch (err) {
      const message =
        err instanceof UnreadableDocumentError
          ? err.message
          : "That file could not be read. Try a .txt export, or paste the text instead.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else if (typeof pasted === "string" && pasted.trim()) {
    text = pasted;
    sourceName = "Pasted text";
  } else {
    return NextResponse.json({ error: "Upload a file or paste your chapter text." }, { status: 400 });
  }

  // A scanned PDF yields a handful of stray glyphs. Scoring that would report a
  // reassuring 0% similarity for a chapter nobody actually read.
  if (wordCount(text) < MIN_DRAFT_WORDS) {
    return NextResponse.json(
      {
        error: `Only ${wordCount(text)} words could be read from that file. If it is a scanned PDF, paste the chapter text instead.`,
      },
      { status: 422 }
    );
  }

  const result = await runCheck(text, { includeExternal: false });
  await saveCheck(session.sub, "CHAPTER_DRAFT", result, { sourceName });

  return NextResponse.json({ ...result, sourceName });
}
