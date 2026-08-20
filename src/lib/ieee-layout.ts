import {
  PdfDocument,
  measureText,
  sanitizeText,
  spaceWidth,
  type FontId,
  type PdfPage,
} from "@/lib/pdf";

/**
 * Module 3 (Member 2): the IEEE Conference Paper Transpiler's layout engine.
 *
 * Everything here is dictated by the IEEE conference template rather than
 * chosen: US Letter, two 3.5" columns separated by 0.2", 10pt Times body set
 * justified, section heads numbered in Roman numerals and set in small caps,
 * subsections lettered and italic, references at 8pt with a hanging indent.
 * The numbers are kept as named constants so a reviewer can check them against
 * the template directly instead of reading them out of the drawing code.
 */

// --- page geometry, in points (72pt = 1in) ---------------------------------

const PAGE_WIDTH = 612; // 8.5in
const PAGE_HEIGHT = 792; // 11in
const MARGIN_TOP = 54; // 0.75in
const MARGIN_BOTTOM = 72; // 1.0in
const COLUMN_WIDTH = 252; // 3.5in
const COLUMN_GAP = 14.4; // 0.2in

const BODY_WIDTH = COLUMN_WIDTH * 2 + COLUMN_GAP; // 7.2in
/** Centring the text block is what puts the side margins at the required 0.65in. */
const MARGIN_LEFT = (PAGE_WIDTH - BODY_WIDTH) / 2;
const CONTENT_TOP = MARGIN_TOP;
const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM;

const COLUMN_X = [MARGIN_LEFT, MARGIN_LEFT + COLUMN_WIDTH + COLUMN_GAP];

// --- typography ------------------------------------------------------------

const TITLE_SIZE = 24;
const TITLE_LEADING = 27;
const AUTHOR_SIZE = 11;
const AUTHOR_LEADING = 13;
const AFFIL_SIZE = 10;
const AFFIL_LEADING = 12;

const ABSTRACT_SIZE = 9;
const ABSTRACT_LEADING = 10.8;

const BODY_SIZE = 10;
const BODY_LEADING = 11.5;

const SECTION_SIZE = 10;
/** Small caps are faked by setting everything but the initial at this size. */
const SECTION_SMALL_SIZE = 8;
const SUBSECTION_SIZE = 10;

const REF_SIZE = 8;
const REF_LEADING = 9.2;

const HEADER_SIZE = 8;
const PAGE_NUMBER_SIZE = 9;

/** First-line indent, one em of body text. */
const PARAGRAPH_INDENT = 10;
const SPACE_BEFORE_SECTION = 11;
const SPACE_AFTER_SECTION = 4;
const SPACE_BEFORE_SUBSECTION = 6;
const SPACE_BEFORE_REFERENCES = 11;
const TITLE_BLOCK_GAP = 16;
/** Gutter between adjacent author blocks in the byline. */
const AUTHOR_SLOT_PADDING = 12;

// --- document model --------------------------------------------------------

export interface IeeeAuthor {
  name: string;
  /** Department / institution line, set italic under the name. */
  affiliation: string;
  email?: string;
}

export interface IeeeBlock {
  kind: "paragraph" | "bullet";
  text: string;
}

export interface IeeeSubsection {
  heading: string;
  blocks: IeeeBlock[];
}

export interface IeeeSection {
  heading: string;
  blocks: IeeeBlock[];
  subsections: IeeeSubsection[];
}

export interface IeeePaper {
  title: string;
  authors: IeeeAuthor[];
  abstract: string;
  indexTerms: string[];
  sections: IeeeSection[];
  /** Pre-formatted IEEE reference strings, without their bracketed number. */
  references: string[];
  /** Optional conference identification line, repeated at the top of each page. */
  runningHeader?: string;
}

// --- line model ------------------------------------------------------------

interface Word {
  text: string;
  font: FontId;
  size: number;
}

interface Segment {
  x: number;
  text: string;
  font: FontId;
  size: number;
  wordSpacing: number;
}

interface Line {
  segments: Segment[];
  /** Baseline advance from this line to the next. */
  leading: number;
  /** Extra vertical space inserted above this line. */
  spaceBefore: number;
  /**
   * How many lines after this one must land in the same column. A section head
   * stranded at the foot of a column is the classic two-column layout failure,
   * so heads declare that they need their first body line beside them.
   */
  keepWithNext: number;
}

/** Roman numerals for section numbering; papers never reach the interesting cases. */
function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rest = n;
  for (const [value, numeral] of table) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/** Column letters for subsection numbering: A, B, ... Z, AA. */
function letter(n: number): string {
  let out = "";
  let rest = n;
  while (rest > 0) {
    const i = (rest - 1) % 26;
    out = String.fromCharCode(65 + i) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

function words(text: string, font: FontId, size: number): Word[] {
  return sanitizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ text: t, font, size }));
}

function wordWidth(word: Word): number {
  return measureText(word.text, word.font, word.size);
}

/**
 * Turns a run of words into positioned segments on one line.
 *
 * Words are grouped into runs of identical font and size so a whole run can be
 * drawn with a single text-showing operator and PDF's own word spacing, rather
 * than one operator per word. Justification distributes the leftover width
 * evenly across the gaps; the last line of a paragraph is left ragged, as the
 * template requires.
 */
function layOutLine(
  lineWords: Word[],
  availableWidth: number,
  startX: number,
  justify: boolean
): Segment[] {
  if (lineWords.length === 0) return [];

  const natural = lineWords.reduce((sum, w) => sum + wordWidth(w), 0);
  const gaps = lineWords.length - 1;
  const naturalGaps = lineWords
    .slice(0, -1)
    .reduce((sum, w) => sum + spaceWidth(w.font, w.size), 0);

  const slack = availableWidth - natural - naturalGaps;
  // A single over-long word cannot be stretched, and stretching by more than
  // about half an em looks worse than a ragged edge.
  const extra = justify && gaps > 0 && slack > 0 ? Math.min(slack / gaps, BODY_SIZE * 0.5) : 0;

  const segments: Segment[] = [];
  let x = startX;
  let current: Word[] = [];
  let currentX = x;

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      x: currentX,
      text: current.map((w) => w.text).join(" "),
      font: current[0].font,
      size: current[0].size,
      wordSpacing: extra,
    });
    current = [];
  };

  for (let i = 0; i < lineWords.length; i++) {
    const word = lineWords[i];
    if (current.length > 0 && (word.font !== current[0].font || word.size !== current[0].size)) {
      flush();
      currentX = x;
    }
    if (current.length === 0) currentX = x;
    current.push(word);

    x += wordWidth(word);
    if (i < lineWords.length - 1) x += spaceWidth(word.font, word.size) + extra;
  }
  flush();

  return segments;
}

/** Greedy line breaking: the template asks for justified text, not optimal paragraphs. */
function breakIntoLines(
  source: Word[],
  firstWidth: number,
  restWidth: number
): Word[][] {
  const lines: Word[][] = [];
  let current: Word[] = [];
  let width = 0;
  let limit = firstWidth;

  for (const word of source) {
    const w = wordWidth(word);
    const gap = current.length > 0 ? spaceWidth(word.font, word.size) : 0;

    if (current.length > 0 && width + gap + w > limit) {
      lines.push(current);
      current = [];
      width = 0;
      limit = restWidth;
    }

    // A single token wider than the column (a long URL or DOI) is split rather
    // than left to overflow into the gutter.
    if (current.length === 0 && w > limit) {
      let remainder = word.text;
      while (measureText(remainder, word.font, word.size) > limit && remainder.length > 1) {
        let cut = remainder.length - 1;
        while (cut > 1 && measureText(remainder.slice(0, cut), word.font, word.size) > limit) cut--;
        lines.push([{ ...word, text: remainder.slice(0, cut) }]);
        remainder = remainder.slice(cut);
        limit = restWidth;
      }
      current = [{ ...word, text: remainder }];
      width = measureText(remainder, word.font, word.size);
      continue;
    }

    current.push(word);
    width += gap + w;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Builds the justified lines of one paragraph.
 *
 * `indent` shifts only the first line, which is how the template marks a new
 * paragraph; `hanging` shifts every line *but* the first, which is how a
 * reference entry hangs under its own number.
 */
function paragraphLines(
  source: Word[],
  leading: number,
  options: {
    indent?: number;
    hanging?: number;
    spaceBefore?: number;
    justify?: boolean;
    keepWithNext?: number;
  } = {}
): Line[] {
  const indent = options.indent ?? 0;
  const hanging = options.hanging ?? 0;
  const justify = options.justify ?? true;

  const firstWidth = COLUMN_WIDTH - indent;
  const restWidth = COLUMN_WIDTH - hanging;
  const broken = breakIntoLines(source, firstWidth, restWidth);

  return broken.map((lineWords, i) => {
    const isLast = i === broken.length - 1;
    const startX = i === 0 ? indent : hanging;
    const width = i === 0 ? firstWidth : restWidth;
    return {
      segments: layOutLine(lineWords, width, startX, justify && !isLast),
      leading,
      spaceBefore: i === 0 ? (options.spaceBefore ?? 0) : 0,
      keepWithNext: i === 0 ? (options.keepWithNext ?? 0) : 0,
    };
  });
}

/**
 * "INTRODUCTION" as an initial capital followed by reduced-size capitals.
 *
 * Times has no true small-caps companion among the base fourteen, and embedding
 * one would defeat the point of using built-in fonts. Setting the remainder two
 * points smaller is the standard substitution and is visually very close.
 */
function smallCaps(text: string): Word[][] {
  return sanitizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      // The Roman numeral and its period are not words being set in small caps —
      // they stay at full size, as they do in the template.
      if (/^[IVXLCDM]+\.$/.test(token)) {
        return [{ text: token, font: "roman" as FontId, size: SECTION_SIZE }];
      }
      const pieces: Word[] = [
        { text: token.slice(0, 1).toUpperCase(), font: "roman", size: SECTION_SIZE },
      ];
      if (token.length > 1) {
        pieces.push({ text: token.slice(1).toUpperCase(), font: "roman", size: SECTION_SMALL_SIZE });
      }
      return pieces;
    });
}

/**
 * Centres a small-caps heading.
 *
 * The pieces of one word — its full-size initial and its reduced-size tail —
 * must sit flush against each other, while whole words are separated by a
 * normal space. Grouping by word is what keeps those two rules apart; measuring
 * from the same groups is what keeps the centring exact.
 */
function weldSmallCaps(groups: Word[][]): Line {
  const gap = spaceWidth("roman", SECTION_SIZE);
  const total =
    groups.reduce((sum, group) => sum + group.reduce((s, w) => s + wordWidth(w), 0), 0) +
    Math.max(0, groups.length - 1) * gap;

  let x = Math.max(0, (COLUMN_WIDTH - total) / 2);
  const segments: Segment[] = [];

  groups.forEach((group, i) => {
    for (const word of group) {
      segments.push({ x, text: word.text, font: word.font, size: word.size, wordSpacing: 0 });
      x += wordWidth(word);
    }
    if (i < groups.length - 1) x += gap;
  });

  return { segments, leading: BODY_LEADING, spaceBefore: SPACE_BEFORE_SECTION, keepWithNext: 1 };
}

// --- building the column stream --------------------------------------------

function blockLines(block: IeeeBlock, first: boolean): Line[] {
  if (block.kind === "bullet") {
    const bullet = words("•", "roman", BODY_SIZE);
    const rest = words(block.text, "roman", BODY_SIZE);
    const marker = measureText("• ", "roman", BODY_SIZE);
    const lines = paragraphLines([...bullet, ...rest], BODY_LEADING, {
      indent: PARAGRAPH_INDENT,
      hanging: PARAGRAPH_INDENT + marker,
      justify: true,
    });
    return lines;
  }

  return paragraphLines(words(block.text, "roman", BODY_SIZE), BODY_LEADING, {
    // The template does not indent the first paragraph after a heading.
    indent: first ? 0 : PARAGRAPH_INDENT,
    justify: true,
  });
}

/** Everything that flows through the two columns, in order. */
function buildColumnLines(paper: IeeePaper): Line[] {
  const lines: Line[] = [];

  // Abstract: a bold-italic label run into 9pt bold text, no indent.
  if (paper.abstract.trim()) {
    const label: Word[] = [
      { text: "Abstract—", font: "boldItalic", size: ABSTRACT_SIZE },
    ];
    const body = words(paper.abstract, "bold", ABSTRACT_SIZE);
    lines.push(
      ...paragraphLines([...label, ...body], ABSTRACT_LEADING, {
        justify: true,
      })
    );
  }

  if (paper.indexTerms.length > 0) {
    const label: Word[] = [
      { text: "Index", font: "boldItalic", size: ABSTRACT_SIZE },
      { text: "Terms—", font: "boldItalic", size: ABSTRACT_SIZE },
    ];
    const terms = words(paper.indexTerms.join(", ") + ".", "bold", ABSTRACT_SIZE);
    lines.push(
      ...paragraphLines([...label, ...terms], ABSTRACT_LEADING, {
        spaceBefore: ABSTRACT_LEADING * 0.6,
        justify: true,
      })
    );
  }

  paper.sections.forEach((section, sectionIndex) => {
    const heading = smallCaps(`${roman(sectionIndex + 1)}. ${section.heading}`);
    lines.push(weldSmallCaps(heading));

    section.blocks.forEach((block, i) => {
      const produced = blockLines(block, i === 0);
      if (i === 0 && produced.length > 0) produced[0].spaceBefore = SPACE_AFTER_SECTION;
      lines.push(...produced);
    });

    section.subsections.forEach((sub, subIndex) => {
      const headingWords = words(`${letter(subIndex + 1)}. ${sub.heading}`, "italic", SUBSECTION_SIZE);
      lines.push(
        ...paragraphLines(headingWords, BODY_LEADING, {
          spaceBefore: SPACE_BEFORE_SUBSECTION,
          justify: false,
          keepWithNext: 1,
        })
      );
      sub.blocks.forEach((block, i) => {
        const produced = blockLines(block, i === 0);
        if (i === 0 && produced.length > 0) produced[0].spaceBefore = SPACE_AFTER_SECTION;
        lines.push(...produced);
      });
    });
  });

  if (paper.references.length > 0) {
    lines.push(weldSmallCaps(smallCaps("References")));
    lines[lines.length - 1].spaceBefore = SPACE_BEFORE_REFERENCES;

    paper.references.forEach((reference, i) => {
      const label = `[${i + 1}]`;
      const hanging = measureText(`${label} `, "roman", REF_SIZE);
      const source = words(`${label} ${reference}`, "roman", REF_SIZE);
      lines.push(
        ...paragraphLines(source, REF_LEADING, {
          hanging,
          spaceBefore: i === 0 ? SPACE_AFTER_SECTION : 1.5,
          justify: true,
        })
      );
    });
  }

  return lines;
}

// --- the full-width title block --------------------------------------------

interface TitleBlock {
  draw: (page: PdfPage) => void;
  height: number;
}

/**
 * Title, authors and affiliations, centred across the full text width.
 *
 * IEEE sets this above the columns on the first page only, which is why its
 * height has to be measured before any body text can be placed.
 */
function buildTitleBlock(paper: IeeePaper): TitleBlock {
  const draws: { x: number; y: number; text: string; font: FontId; size: number }[] = [];
  let y = CONTENT_TOP + TITLE_SIZE;

  const titleWords = words(paper.title, "roman", TITLE_SIZE);
  for (const lineWords of breakIntoLines(titleWords, BODY_WIDTH, BODY_WIDTH)) {
    const width =
      lineWords.reduce((sum, w) => sum + wordWidth(w), 0) +
      lineWords.slice(0, -1).reduce((sum, w) => sum + spaceWidth(w.font, w.size), 0);
    draws.push({
      x: MARGIN_LEFT + (BODY_WIDTH - width) / 2,
      y,
      text: lineWords.map((w) => w.text).join(" "),
      font: "roman",
      size: TITLE_SIZE,
    });
    y += TITLE_LEADING;
  }

  y += 6;

  // Authors sit side by side across the block, the way the template lays out a
  // multi-author paper, so a solo author simply lands centred.
  const columnCount = Math.max(1, paper.authors.length);
  const slot = BODY_WIDTH / columnCount;
  /** Keeps adjacent author blocks from touching when the byline is crowded. */
  const slotInner = slot - AUTHOR_SLOT_PADDING;

  /**
   * Centres text inside one author's slot, wrapping it first.
   *
   * Wrapping is not optional here: three authors leave each slot 2.4in wide,
   * and a full department-and-university affiliation is wider than that. Laying
   * it out as a single line pushed it past the page edge.
   */
  const centreWrapped = (
    text: string,
    font: FontId,
    size: number,
    slotIndex: number,
    at: number,
    leading: number
  ): number => {
    const clean = sanitizeText(text);
    if (!clean) return at;

    let cursor = at;
    for (const lineWords of breakIntoLines(words(clean, font, size), slotInner, slotInner)) {
      const width =
        lineWords.reduce((sum, w) => sum + wordWidth(w), 0) +
        lineWords.slice(0, -1).reduce((sum, w) => sum + spaceWidth(w.font, w.size), 0);
      draws.push({
        x: MARGIN_LEFT + slot * slotIndex + (slot - width) / 2,
        y: cursor,
        text: lineWords.map((w) => w.text).join(" "),
        font,
        size,
      });
      cursor += leading;
    }
    return cursor;
  };

  let authorBottom = y;
  paper.authors.forEach((author, i) => {
    let cursor = y + AUTHOR_SIZE;
    cursor = centreWrapped(author.name, "roman", AUTHOR_SIZE, i, cursor, AUTHOR_LEADING);
    for (const part of author.affiliation.split("\n").filter(Boolean)) {
      cursor = centreWrapped(part, "italic", AFFIL_SIZE, i, cursor, AFFIL_LEADING);
    }
    if (author.email) {
      cursor = centreWrapped(author.email, "italic", AFFIL_SIZE, i, cursor, AFFIL_LEADING);
    }
    authorBottom = Math.max(authorBottom, cursor);
  });

  return {
    height: authorBottom - CONTENT_TOP + TITLE_BLOCK_GAP,
    draw: (page) => {
      for (const d of draws) {
        page.text({ x: d.x, yFromTop: d.y, text: d.text, font: d.font, size: d.size });
      }
    },
  };
}

// --- flowing lines into columns --------------------------------------------

interface ColumnBox {
  x: number;
  top: number;
  bottom: number;
}

/**
 * Renders a paper to a print-ready PDF.
 *
 * The two passes matter: page one's columns start below the title block, every
 * later page's start at the top margin, so the available height is not uniform
 * and cannot be precomputed from a line count.
 */
export function renderIeeePaper(paper: IeeePaper): { buffer: Buffer; pageCount: number } {
  const doc = new PdfDocument(PAGE_WIDTH, PAGE_HEIGHT);
  const titleBlock = buildTitleBlock(paper);
  const lines = buildColumnLines(paper);

  let page = doc.addPage();
  titleBlock.draw(page);

  const firstPageTop = CONTENT_TOP + titleBlock.height;
  let boxes: ColumnBox[] = [
    { x: COLUMN_X[0], top: firstPageTop, bottom: CONTENT_BOTTOM },
    { x: COLUMN_X[1], top: firstPageTop, bottom: CONTENT_BOTTOM },
  ];
  let boxIndex = 0;
  let cursor = boxes[0].top;

  const nextColumn = () => {
    boxIndex += 1;
    if (boxIndex >= boxes.length) {
      page = doc.addPage();
      boxes = [
        { x: COLUMN_X[0], top: CONTENT_TOP, bottom: CONTENT_BOTTOM },
        { x: COLUMN_X[1], top: CONTENT_TOP, bottom: CONTENT_BOTTOM },
      ];
      boxIndex = 0;
    }
    cursor = boxes[boxIndex].top;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const box = boxes[boxIndex];

    // Space above a heading is swallowed at the top of a column rather than
    // pushing the first line down away from the margin.
    const spaceBefore = cursor === box.top ? 0 : line.spaceBefore;
    let baseline = cursor + spaceBefore + line.leading;

    // A line that declares dependants needs room for them too, or it moves on.
    let required = baseline;
    for (let k = 1; k <= line.keepWithNext && i + k < lines.length; k++) {
      required += lines[i + k].spaceBefore + lines[i + k].leading;
    }

    if (required > box.bottom) {
      nextColumn();
      baseline = cursor + line.leading;
    }

    const target = boxes[boxIndex];
    for (const segment of line.segments) {
      page.text({
        x: target.x + segment.x,
        yFromTop: baseline,
        text: segment.text,
        font: segment.font,
        size: segment.size,
        wordSpacing: segment.wordSpacing,
      });
    }

    cursor = baseline;
  }

  decoratePages(doc, paper);

  return { buffer: doc.toBuffer(), pageCount: doc.pageCount };
}

/**
 * Running header and page numbers.
 *
 * Applied after the flow so the page count is known — a "Page 1 of 6" footer
 * cannot be written while page six is still hypothetical.
 */
function decoratePages(doc: PdfDocument, paper: IeeePaper) {
  const header = paper.runningHeader ? sanitizeText(paper.runningHeader) : "";

  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAt(i);
    if (!page) continue;

    if (header) {
      const width = measureText(header, "italic", HEADER_SIZE);
      page.text({
        x: (PAGE_WIDTH - width) / 2,
        yFromTop: MARGIN_TOP / 2 + HEADER_SIZE,
        text: header,
        font: "italic",
        size: HEADER_SIZE,
      });
    }

    const label = String(i + 1);
    const width = measureText(label, "roman", PAGE_NUMBER_SIZE);
    page.text({
      x: (PAGE_WIDTH - width) / 2,
      yFromTop: PAGE_HEIGHT - MARGIN_BOTTOM / 2,
      text: label,
      font: "roman",
      size: PAGE_NUMBER_SIZE,
    });
  }
}

/** Geometry the API surfaces so the UI can state what it produced. */
export const IEEE_SPEC = {
  pageSize: "US Letter (8.5in × 11in)",
  columns: 2,
  columnWidthIn: COLUMN_WIDTH / 72,
  columnGapIn: COLUMN_GAP / 72,
  marginTopIn: MARGIN_TOP / 72,
  marginBottomIn: MARGIN_BOTTOM / 72,
  marginSideIn: Math.round((MARGIN_LEFT / 72) * 1000) / 1000,
  bodyFont: "Times 10pt, justified",
} as const;
