/**
 * Module 3 (Member 1): Version Control & Inline Annotation.
 *
 * A hand-rolled word-level LCS diff between two draft versions' plain text —
 * no external diff library, matching this project's existing convention of
 * hand-building math/rendering (see evaluation.ts's ROC/formula computation)
 * rather than pulling in a dependency for something this contained.
 */

export type DiffTokenType = "equal" | "add" | "remove";

export interface DiffToken {
  type: DiffTokenType;
  value: string;
}

/** Splits on whitespace boundaries while keeping the whitespace itself as its own token, so re-joining tokens losslessly reconstructs the original text. */
function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Longest Common Subsequence-based diff. O(n*m) time/space in token count —
 * fine for chapter-length prose, not meant for huge documents.
 */
export function computeWordDiff(oldText: string, newText: string): DiffToken[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ type: "equal", value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ type: "remove", value: a[i] });
      i++;
    } else {
      tokens.push({ type: "add", value: b[j] });
      j++;
    }
  }
  while (i < n) {
    tokens.push({ type: "remove", value: a[i] });
    i++;
  }
  while (j < m) {
    tokens.push({ type: "add", value: b[j] });
    j++;
  }

  // Merge adjacent same-type tokens so the UI isn't rendering a span per word.
  const merged: DiffToken[] = [];
  for (const t of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === t.type) {
      last.value += t.value;
    } else {
      merged.push({ ...t });
    }
  }
  return merged;
}
