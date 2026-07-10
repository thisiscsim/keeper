// Pure helpers for the ElevenLabs TTS pipeline (ported from Claudia's
// narration preprocessing, general subset). Kept dependency-free and pure so
// they unit-test cleanly.

const round = (n) => Math.round(n * 100) / 100;

/**
 * Prepare narration text for TTS:
 * - symbols ElevenLabs reads unpredictably: `§` -> "Section", ` & ` -> " and "
 * - a 0.25s break after each sentence inside a paragraph (natural pacing)
 * - a 0.5s break between paragraphs (a breath between beats)
 * On-screen text is untouched — this transform applies to the spoken text only.
 */
export function preprocessForTts(text) {
  const paragraphs = String(text)
    .replace(/§/g, "Section ")
    .replace(/\s&\s/g, " and ")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      // Insert a short break after sentence-ending punctuation followed by a
      // space (keeps decimals like "2.5" and trailing sentence-enders intact).
      p.replace(/([.!?])\s+(?=[A-Z0-9"'])/g, '$1 <break time="0.25s"/> '),
    );
  return paragraphs.join('\n\n<break time="0.5s"/>\n\n');
}

/**
 * Convert ElevenLabs character alignment (from /with-timestamps) into
 * word-level timings compatible with the EDL caption track. Break tags may or
 * may not appear in the alignment depending on API behavior — tokens that
 * look like markup are dropped either way.
 */
export function alignmentToWords(alignment) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words = [];
  let text = "";
  let start = null;
  let end = null;
  let inTag = false;

  const flush = () => {
    if (text) words.push({ text, start: round(start ?? 0), end: round(end ?? start ?? 0) });
    text = "";
    start = null;
    end = null;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    // Markup spans (e.g. <break time="0.5s"/>) are never spoken words; skip
    // them wholesale, including the spaces inside them.
    if (inTag) {
      if (ch === ">") inTag = false;
      continue;
    }
    if (ch === "<") {
      flush();
      inTag = true;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (text === "") start = starts[i];
    text += ch;
    end = ends[i];
  }
  flush();
  return words;
}

/** Stable cache key for a synthesis request (voice + model + processed text). */
export async function synthesisHash(voiceId, modelId, processedText) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(`${voiceId}\n${modelId}\n${processedText}`).digest("hex").slice(0, 12);
}
