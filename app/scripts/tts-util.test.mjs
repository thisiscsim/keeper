import { describe, expect, it } from "vitest";
import { alignmentToWords, preprocessForTts, synthesisHash } from "./tts-util.mjs";

describe("preprocessForTts", () => {
  it("inserts paragraph breaks between beats", () => {
    const out = preprocessForTts("First beat.\n\nSecond beat.");
    expect(out).toBe('First beat.\n\n<break time="0.5s"/>\n\nSecond beat.');
  });

  it("inserts sentence breaks within a paragraph", () => {
    const out = preprocessForTts("One sentence. Another one! Third?");
    expect(out).toContain('One sentence. <break time="0.25s"/> Another one!');
    expect(out).toContain('Another one! <break time="0.25s"/> Third?');
  });

  it("substitutes symbols ElevenLabs mispronounces and keeps decimals intact", () => {
    const out = preprocessForTts("Section §230 applies to Smith & Co at 2.5 percent.");
    expect(out).toContain("Section 230");
    expect(out).toContain("Smith and Co");
    expect(out).toContain("2.5 percent");
    expect(out).not.toContain("§");
  });

  it("drops empty paragraphs from stray blank lines", () => {
    const out = preprocessForTts("A.\n\n\n\nB.");
    expect(out.match(/<break time="0\.5s"\/>/g)).toHaveLength(1);
  });
});

describe("alignmentToWords", () => {
  const align = (text, offset = 0) => ({
    characters: [...text],
    character_start_times_seconds: [...text].map((_, i) => offset + i * 0.1),
    character_end_times_seconds: [...text].map((_, i) => offset + (i + 1) * 0.1),
  });

  it("groups characters into words with start/end times", () => {
    const words = alignmentToWords(align("hi there"));
    expect(words).toEqual([
      { text: "hi", start: 0, end: 0.2 },
      { text: "there", start: 0.3, end: 0.8 },
    ]);
  });

  it("drops break-tag tokens if the API includes them in the alignment", () => {
    const words = alignmentToWords(align('go <break time="0.5s"/> now'));
    expect(words.map((w) => w.text)).toEqual(["go", "now"]);
  });

  it("handles an empty alignment", () => {
    expect(alignmentToWords(undefined)).toEqual([]);
    expect(alignmentToWords({})).toEqual([]);
  });
});

describe("synthesisHash", () => {
  it("is stable for identical inputs and distinct across voices", async () => {
    const a = await synthesisHash("voiceA", "model", "text");
    const b = await synthesisHash("voiceA", "model", "text");
    const c = await synthesisHash("voiceB", "model", "text");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});
