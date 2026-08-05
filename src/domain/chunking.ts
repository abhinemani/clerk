/**
 * Document chunking for embeddings (§6.4 hybrid staff search).
 *
 * A whole 40-page report averaged into one vector matches nothing well; the
 * point of chunking is that "trip and fall" can match a paragraph reading
 * "claimant caught his shoe and fell forward" even though no word overlaps.
 *
 * Line-oriented and overlapping: chunks break on line boundaries (extracted
 * text is already line-structured) and repeat a little context so a passage
 * split across a boundary is still findable from either side. Pure.
 */

export interface TextChunk {
  content: string;
  /** 0-based line index this chunk starts at — lets the UI cite a location. */
  startLine: number;
  endLine: number;
}

/** Target characters per chunk — a few paragraphs, well inside model limits. */
export const CHUNK_TARGET_CHARS = 1200;
/** Lines of context repeated between adjacent chunks. */
export const CHUNK_OVERLAP_LINES = 2;
/** Hard cap so one pathological document can't flood the corpus. */
export const MAX_CHUNKS_PER_DOC = 200;

export function chunkText(
  text: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapLines = CHUNK_OVERLAP_LINES,
): TextChunk[] {
  const lines = text.split("\n");
  const chunks: TextChunk[] = [];

  let start = 0;
  while (start < lines.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    let end = start;
    let size = 0;
    // Always take at least one line, even a pathologically long one.
    while (end < lines.length && (end === start || size + lines[end]!.length + 1 <= targetChars)) {
      size += lines[end]!.length + 1;
      end++;
    }
    const content = lines.slice(start, end).join("\n").trim();
    if (content.length > 0) chunks.push({ content, startLine: start, endLine: end - 1 });

    if (end >= lines.length) break;
    // Step forward with overlap, but never backwards (guards tiny chunks).
    start = Math.max(start + 1, end - overlapLines);
  }

  return chunks;
}
