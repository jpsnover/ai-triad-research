// Semantic chunking for long documents (>80k tokens / ~200k chars)

const MAX_CHUNK_CHARS = 200000;
const OVERLAP_CHARS = 500;

export function chunkDocument(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = offset + MAX_CHUNK_CHARS;

    if (end < text.length) {
      // Try to split at paragraph boundary
      const searchStart = Math.max(end - 2000, offset);
      const searchRegion = text.slice(searchStart, end);
      const lastParagraph = searchRegion.lastIndexOf('\n\n');

      if (lastParagraph > 0) {
        end = searchStart + lastParagraph + 2;
      } else {
        // Fall back to sentence boundary
        const lastSentence = searchRegion.lastIndexOf('. ');
        if (lastSentence > 0) {
          end = searchStart + lastSentence + 2;
        }
      }
    } else {
      end = text.length;
    }

    chunks.push(text.slice(offset, end));

    // Next chunk starts with overlap for context continuity
    const nextOffset = end - OVERLAP_CHARS;
    if (nextOffset <= 0 || nextOffset <= offset) {
      offset = end;
    } else {
      offset = nextOffset;
    }
  }

  return chunks;
}
