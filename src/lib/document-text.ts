import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Module 2 (Member 3): pulling chapter text out of an uploaded draft.
 *
 * The spec's drop-zone accepts .docx, .pdf, and .txt, so all three are handled
 * here with Node's built-in zlib rather than a parsing dependency: a .docx is a
 * zip holding XML, and a text-based .pdf is a set of deflated content streams.
 *
 * Extraction is best-effort by nature — a scanned PDF holds pictures of words,
 * not words. Rather than scoring whatever fragments come back and quietly
 * reporting a flattering result, callers get a word count and a clear failure,
 * and the UI offers pasting the text instead.
 */

export interface ExtractedDocument {
  text: string;
  /** Which path produced the text, surfaced so a poor result is explainable. */
  source: "txt" | "docx" | "pdf";
}

export class UnreadableDocumentError extends Error {}

/** Collapses the whitespace that survives every extraction path. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- .docx -----------------------------------------------------------------

/**
 * Reads one member out of a zip archive.
 *
 * Walks the central directory rather than scanning for local headers, since
 * only the central directory is authoritative about where each entry starts.
 */
function readZipEntry(buffer: Buffer, wanted: string): Buffer | null {
  // End of central directory: signature, then the offset the directory starts at.
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) return null;

    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    if (name === wanted) {
      // The local header repeats the name and extra fields with its own
      // lengths, which are not always the central directory's.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(start, start + compressedSize);
      return method === 0 ? raw : inflateRawSync(raw);
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function extractDocx(buffer: Buffer): string {
  const xml = readZipEntry(buffer, "word/document.xml");
  if (!xml) throw new UnreadableDocumentError("That .docx file could not be opened.");

  return normalize(
    xml
      .toString("utf8")
      // Paragraph and line breaks become real newlines before tags are stripped,
      // otherwise the whole document collapses into one run-on line.
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<w:tab\s*\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  );
}

// --- .pdf ------------------------------------------------------------------

/** code -> character, from a font's ToUnicode CMap. */
function parseCMap(stream: string): Map<number, string> {
  const map = new Map<number, string>();

  for (const block of stream.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const [, src, dst] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const chars = dst.match(/.{1,4}/g) ?? [];
      map.set(parseInt(src, 16), chars.map((c) => String.fromCharCode(parseInt(c, 16))).join(""));
    }
  }

  for (const block of stream.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const [, lo, hi, dst] of block.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    )) {
      const start = parseInt(lo, 16);
      const end = parseInt(hi, 16);
      const base = parseInt(dst, 16);
      // Guard against a malformed range asking for millions of entries.
      for (let i = 0; i <= Math.min(end - start, 65535); i++) {
        map.set(start + i, String.fromCharCode(base + i));
      }
    }
  }

  return map;
}

function extractPdf(buffer: Buffer): string {
  const latin = buffer.toString("latin1");

  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end === -1) continue;
    const slice = buffer.subarray(start, end);
    try {
      streams.push(inflateSync(slice).toString("latin1"));
    } catch {
      // Not deflated, or an image stream. Either way there is nothing to read.
    }
  }

  // Subset fonts store glyph ids, so the CMaps have to be applied. Merging them
  // is an approximation — ids can collide across fonts — but it recovers
  // readable text from ordinary exported documents.
  const cmap = new Map<number, string>();
  for (const stream of streams) {
    if (stream.includes("beginbfchar") || stream.includes("beginbfrange")) {
      for (const [code, char] of parseCMap(stream)) cmap.set(code, char);
    }
  }

  const unescape = (s: string) =>
    s.replace(/\\([nrtbf()\\])/g, (_, c) =>
      ({ n: "\n", r: "\n", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" })[c as string] ?? c
    );

  const out: string[] = [];
  for (const stream of streams) {
    if (!stream.includes("Tj") && !stream.includes("TJ")) continue;

    const parts: string[] = [];

    // Literal strings, hex strings, and TJ arrays, in the order they appear.
    // Positioning operators become a space, which is what separates words once
    // the glyph runs are concatenated.
    for (const m of stream.matchAll(
      /\(((?:[^()\\]|\\.)*)\)\s*Tj|<([0-9A-Fa-f]*)>\s*Tj|\[([\s\S]*?)\]\s*TJ|\bT\*|\bTd\b|\bTD\b/g
    )) {
      if (m[1] !== undefined) {
        parts.push(unescape(m[1]));
      } else if (m[2] !== undefined) {
        parts.push(decodeHex(m[2], cmap));
      } else if (m[3] !== undefined) {
        for (const inner of m[3].matchAll(/\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f]*)>/g)) {
          parts.push(inner[1] !== undefined ? unescape(inner[1]) : decodeHex(inner[2], cmap));
        }
      } else {
        parts.push(" ");
      }
    }

    const text = parts.join("").trim();
    if (text) out.push(text);
  }

  return normalize(out.join("\n"));
}

function decodeHex(hex: string, cmap: Map<number, string>): string {
  if (!hex) return "";
  const padded = hex.length % 4 === 0 ? hex : hex.padStart(hex.length + (4 - (hex.length % 4)), "0");
  let out = "";
  for (let i = 0; i < padded.length; i += 4) {
    const code = parseInt(padded.slice(i, i + 4), 16);
    out += cmap.get(code) ?? "";
  }
  return out;
}

// --- entry point -----------------------------------------------------------

/** Minimum words before a draft is worth scoring at all. */
export const MIN_DRAFT_WORDS = 40;

export function extractDocumentText(fileName: string, buffer: Buffer): ExtractedDocument {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".text")) {
    return { text: normalize(buffer.toString("utf8")), source: "txt" };
  }
  if (lower.endsWith(".docx")) {
    return { text: extractDocx(buffer), source: "docx" };
  }
  if (lower.endsWith(".pdf")) {
    return { text: extractPdf(buffer), source: "pdf" };
  }

  throw new UnreadableDocumentError(
    "Upload a .docx, .pdf, or .txt file — or paste the chapter text instead."
  );
}
