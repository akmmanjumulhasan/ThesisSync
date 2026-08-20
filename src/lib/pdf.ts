/**
 * Module 3 (Member 2): a minimal PDF writer for the IEEE Conference Paper
 * Transpiler.
 *
 * The obvious way to "compile headlessly into a print-ready PDF" is to render
 * HTML in a headless browser, but that drags a ~300MB Chromium download into a
 * project whose entire dependency list is nine packages, and Vercel's serverless
 * runtime will not host it without a custom binary. It also gives up exact
 * control of the thing IEEE actually specifies: where the glyphs land.
 *
 * So the paper is emitted as a PDF directly. That is tractable here because
 * IEEE mandates Times, and Times is one of the fourteen fonts every conforming
 * PDF reader already has built in — no font embedding, no glyph subsetting.
 * What is needed instead is the width of every character, which is what the
 * tables below hold, so the layout engine can measure a line before committing
 * to it. This mirrors the approach in `document-text.ts`, which reads PDFs with
 * nothing but `node:zlib`.
 */

import { deflateSync } from "node:zlib";

/** The four Times faces IEEE needs: body, headings, emphasis, and run-in heads. */
export type FontId = "roman" | "bold" | "italic" | "boldItalic";

const BASE_FONTS: Record<FontId, string> = {
  roman: "Times-Roman",
  bold: "Times-Bold",
  italic: "Times-Italic",
  boldItalic: "Times-BoldItalic",
};

/** Resource name each face is published under inside the page dictionary. */
const RESOURCE_NAMES: Record<FontId, string> = {
  roman: "F1",
  bold: "F2",
  italic: "F3",
  boldItalic: "F4",
};

/**
 * Adobe's published advance widths for codes 32-126, in 1/1000 em.
 *
 * These are the same numbers in every Type 1 Times AFM, and they are what makes
 * justification honest: a line is only flush on both edges if the measurement
 * that sized it matches what the reader will draw.
 */
const WIDTHS_ASCII: Record<FontId, number[]> = {
  roman: [
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
    278, 278, 564, 564, 564, 444, 921,
    722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556,
    722, 667, 556, 611, 722, 722, 944, 722, 722, 611,
    333, 278, 333, 469, 500, 333,
    444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500,
    500, 333, 389, 278, 500, 500, 722, 500, 500, 444,
    480, 200, 480, 541,
  ],
  bold: [
    250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
    333, 333, 570, 570, 570, 500, 930,
    722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611,
    778, 722, 556, 667, 722, 722, 1000, 722, 722, 667,
    333, 278, 333, 581, 500, 333,
    500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556,
    556, 444, 389, 333, 556, 500, 722, 500, 500, 444,
    394, 220, 394, 520,
  ],
  italic: [
    250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
    333, 333, 675, 675, 675, 500, 920,
    611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611,
    722, 611, 500, 556, 722, 611, 833, 611, 556, 556,
    389, 278, 389, 422, 500, 333,
    500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500, 500,
    500, 389, 389, 278, 500, 444, 667, 444, 444, 389,
    400, 275, 400, 541,
  ],
  boldItalic: [
    250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
    333, 333, 570, 570, 570, 500, 832,
    667, 667, 667, 722, 667, 667, 722, 778, 389, 500, 667, 611, 889, 722, 722, 611,
    722, 667, 556, 611, 722, 667, 889, 667, 611, 611,
    333, 278, 333, 570, 500, 333,
    500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500, 278, 778, 556, 500, 500,
    500, 389, 389, 278, 556, 444, 667, 500, 444, 389,
    348, 220, 348, 570,
  ],
};

/**
 * Typographic characters that survive a copy-paste from Word, mapped to their
 * WinAnsi code and width. Without this a pasted abstract full of curly quotes
 * and en dashes would either measure wrong or render as noise.
 */
const HIGH_CHARS: Record<string, { code: number; width: Record<FontId, number> }> = {
  "–": { code: 150, width: { roman: 500, bold: 500, italic: 500, boldItalic: 500 } }, // –
  "—": { code: 151, width: { roman: 1000, bold: 1000, italic: 889, boldItalic: 889 } }, // —
  "‘": { code: 145, width: { roman: 333, bold: 333, italic: 333, boldItalic: 333 } }, // '
  "’": { code: 146, width: { roman: 333, bold: 333, italic: 333, boldItalic: 333 } }, // '
  "“": { code: 147, width: { roman: 444, bold: 500, italic: 556, boldItalic: 500 } }, // "
  "”": { code: 148, width: { roman: 444, bold: 500, italic: 556, boldItalic: 500 } }, // "
  "•": { code: 149, width: { roman: 350, bold: 350, italic: 350, boldItalic: 350 } }, // •
  "…": { code: 133, width: { roman: 1000, bold: 1000, italic: 889, boldItalic: 889 } }, // …
};

/** Anything with no WinAnsi home at all, folded to an ASCII stand-in. */
const FOLD: Record<string, string> = {
  " ": " ",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "ʼ": "'",
  "´": "'",
  "′": "'",
  "″": '"',
  "„": '"',
  "«": '"',
  "»": '"',
  "\t": " ",
};

/**
 * Reduces arbitrary input to characters this writer can both measure and draw.
 *
 * Dropping the unmappable rather than substituting a visible marker is
 * deliberate: a stray glyph box in the middle of a published paper is worse
 * than a missing one, and the common cases are all handled above.
 */
export function sanitizeText(input: string): string {
  let out = "";
  for (const ch of input) {
    const folded = FOLD[ch] ?? ch;
    const code = folded.codePointAt(0) ?? 0;
    if (code >= 32 && code <= 126) {
      out += folded;
    } else if (HIGH_CHARS[folded]) {
      out += folded;
    } else if (code >= 160 && code <= 255) {
      // Latin-1 supplement is WinAnsi-identical; accented names survive intact.
      out += folded;
    }
  }
  return out;
}

/** Width of one character in 1/1000 em, or null when it cannot be drawn. */
function charWidth(ch: string, font: FontId): number | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return WIDTHS_ASCII[font][code - 32];
  const high = HIGH_CHARS[ch];
  if (high) return high.width[font];
  // Latin-1 accented letters are close enough to their base letter's advance
  // that using it keeps justification within a fraction of a point.
  if (code >= 192 && code <= 255) return WIDTHS_ASCII[font][("a".codePointAt(0) ?? 97) - 32];
  return null;
}

/** Rendered width of a string at a given size, in points. */
export function measureText(text: string, font: FontId, size: number): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch, font) ?? 0;
  return (units * size) / 1000;
}

/** Width of a single space, needed to distribute slack across a justified line. */
export function spaceWidth(font: FontId, size: number): number {
  return (WIDTHS_ASCII[font][0] * size) / 1000;
}

// --- drawing ---------------------------------------------------------------

interface TextOp {
  kind: "text";
  /** Left edge of the text, in points from the page's left edge. */
  x: number;
  /** Baseline, in points measured *down* from the top of the page. */
  yFromTop: number;
  text: string;
  font: FontId;
  size: number;
  /**
   * Extra points added to every space on this line. This is how a justified
   * line is stretched: PDF's Tw operator applies it to the space character
   * itself, so the words stay unmolested and only the gaps grow.
   */
  wordSpacing?: number;
}

interface RuleOp {
  kind: "rule";
  x: number;
  yFromTop: number;
  width: number;
  thickness: number;
}

type Op = TextOp | RuleOp;

/** One rendered page: a size and a flat list of things drawn on it. */
class Page {
  readonly ops: Op[] = [];
  constructor(
    readonly width: number,
    readonly height: number
  ) {}

  text(op: Omit<TextOp, "kind">) {
    if (op.text) this.ops.push({ kind: "text", ...op });
  }

  rule(op: Omit<RuleOp, "kind">) {
    this.ops.push({ kind: "rule", ...op });
  }
}

/** Escapes the three characters that are structural inside a PDF literal string. */
function escapePdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (HIGH_CHARS[ch]) out += `\\${HIGH_CHARS[ch].code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}

function formatNumber(n: number): string {
  // Three decimals is well under a printer's resolution and keeps the file small.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Serialises one page's ops into a PDF content stream. */
function contentStream(page: Page): Buffer {
  const parts: string[] = [];
  let currentFont: string | null = null;
  let currentSize = -1;
  let currentWordSpacing = 0;
  let inText = false;

  for (const op of page.ops) {
    if (op.kind === "rule") {
      if (inText) {
        parts.push("ET");
        inText = false;
        currentFont = null;
        currentSize = -1;
      }
      // PDF's origin is bottom-left, so every y is flipped on the way out.
      const y = page.height - op.yFromTop;
      parts.push(
        `${formatNumber(op.thickness)} w`,
        `${formatNumber(op.x)} ${formatNumber(y)} m`,
        `${formatNumber(op.x + op.width)} ${formatNumber(y)} l`,
        "S"
      );
      continue;
    }

    if (!inText) {
      parts.push("BT");
      inText = true;
    }

    const resource = RESOURCE_NAMES[op.font];
    if (resource !== currentFont || op.size !== currentSize) {
      parts.push(`/${resource} ${formatNumber(op.size)} Tf`);
      currentFont = resource;
      currentSize = op.size;
    }

    const ws = op.wordSpacing ?? 0;
    if (ws !== currentWordSpacing) {
      parts.push(`${formatNumber(ws)} Tw`);
      currentWordSpacing = ws;
    }

    const y = page.height - op.yFromTop;
    parts.push(`1 0 0 1 ${formatNumber(op.x)} ${formatNumber(y)} Tm`);
    parts.push(`(${escapePdfString(op.text)}) Tj`);
  }

  if (inText) parts.push("ET");
  return Buffer.from(parts.join("\n"), "latin1");
}

/**
 * A PDF being assembled. Pages are collected first and serialised once, because
 * the cross-reference table at the end of the file has to record the byte offset
 * of every object, which is only knowable after the bodies exist.
 */
export class PdfDocument {
  private readonly pages: Page[] = [];

  constructor(
    readonly pageWidth: number,
    readonly pageHeight: number
  ) {}

  addPage(): Page {
    const page = new Page(this.pageWidth, this.pageHeight);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** A page already added, so trailers that need the final count can be drawn last. */
  pageAt(index: number): Page | undefined {
    return this.pages[index];
  }

  toBuffer(): Buffer {
    const fontIds: FontId[] = ["roman", "bold", "italic", "boldItalic"];

    // Object numbering: 1 catalog, 2 page tree, 3-6 fonts, then a page
    // dictionary and a content stream per page.
    const firstFontObj = 3;
    const firstPageObj = firstFontObj + fontIds.length;

    const bodies: string[] = [];
    const streams = new Map<number, Buffer>();

    const pageObjNumbers = this.pages.map((_, i) => firstPageObj + i * 2);

    bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    bodies[2] =
      `<< /Type /Pages /Count ${this.pages.length} ` +
      `/Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`;

    fontIds.forEach((id, i) => {
      bodies[firstFontObj + i] =
        `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONTS[id]} /Encoding /WinAnsiEncoding >>`;
    });

    const fontResource = fontIds
      .map((id, i) => `/${RESOURCE_NAMES[id]} ${firstFontObj + i} 0 R`)
      .join(" ");

    this.pages.forEach((page, i) => {
      const pageObj = firstPageObj + i * 2;
      const contentObj = pageObj + 1;
      // Deflating is what every real-world PDF does: it roughly halves the file
      // and is the form other tools expect to find, including this project's own
      // reader in `document-text.ts`, which only inflates.
      const stream = deflateSync(contentStream(page));

      bodies[pageObj] =
        `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${formatNumber(page.width)} ${formatNumber(page.height)}] ` +
        `/Resources << /Font << ${fontResource} >> >> ` +
        `/Contents ${contentObj} 0 R >>`;

      bodies[contentObj] = `<< /Length ${stream.length} /Filter /FlateDecode >>`;
      streams.set(contentObj, stream);
    });

    const chunks: Buffer[] = [];
    let offset = 0;
    const push = (buf: Buffer) => {
      chunks.push(buf);
      offset += buf.length;
    };

    push(Buffer.from("%PDF-1.4\n", "latin1"));
    // A binary comment marks the file as non-text so transfers don't mangle it.
    push(Buffer.from("%\xE2\xE3\xCF\xD3\n", "latin1"));

    const offsets: number[] = [];
    const lastObj = firstPageObj + this.pages.length * 2 - 1;

    for (let num = 1; num <= lastObj; num++) {
      offsets[num] = offset;
      push(Buffer.from(`${num} 0 obj\n${bodies[num]}\n`, "latin1"));
      const stream = streams.get(num);
      if (stream) {
        push(Buffer.from("stream\n", "latin1"));
        push(stream);
        push(Buffer.from("\nendstream\n", "latin1"));
      }
      push(Buffer.from("endobj\n", "latin1"));
    }

    const xrefStart = offset;
    const xref: string[] = [`xref\n0 ${lastObj + 1}\n`, "0000000000 65535 f \n"];
    for (let num = 1; num <= lastObj; num++) {
      xref.push(`${String(offsets[num]).padStart(10, "0")} 00000 n \n`);
    }
    push(Buffer.from(xref.join(""), "latin1"));
    push(
      Buffer.from(
        `trailer\n<< /Size ${lastObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
        "latin1"
      )
    );

    return Buffer.concat(chunks);
  }
}

export type { Page as PdfPage };
