import { describe, expect, it } from "vitest";
import {
  durationFrames,
  durationSeconds,
  parseBenchmarks,
  parseEdl,
  parseMeta,
  parseStyleProfile,
} from "@reel/edl";

describe("parseEdl", () => {
  it("fills defaults for an empty object", () => {
    const res = parseEdl({});
    expect(res.ok).toBe(true);
    expect(res.edl?.format).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(res.edl?.theme.captionStyle).toBe("karaoke");
    expect(res.edl?.assets).toEqual([]);
    expect(res.edl?.tracks).toEqual([]);
  });

  it("rejects an invalid track type with errors", () => {
    const res = parseEdl({ tracks: [{ id: "x", type: "bogus" }] });
    expect(res.ok).toBe(false);
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  it("parses the discriminated track union and defaults audio role to music", () => {
    const res = parseEdl({
      assets: [{ id: "a", kind: "audio", src: "assets/a.mp3" }],
      tracks: [{ id: "aud", type: "audio", clips: [{ id: "c", assetId: "a", out: 5 }] }],
    });
    expect(res.ok).toBe(true);
    const track = res.edl?.tracks[0];
    expect(track?.type).toBe("audio");
    if (track?.type === "audio") {
      expect(track.clips[0].role).toBe("music");
      expect(track.clips[0].duckUnderVoice).toBe(false);
    }
  });

  it("applies grade defaults when theme.grade is provided", () => {
    const res = parseEdl({ theme: { grade: {} } });
    expect(res.ok).toBe(true);
    expect(res.edl?.theme.grade).toEqual({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      vignette: 0,
    });
  });

  it("leaves grade undefined by default", () => {
    expect(parseEdl({}).edl?.theme.grade).toBeUndefined();
  });
});

// Project files are shareable, so the schema is the security boundary:
// unbounded numbers hang the timeline/player, traversal paths escape the
// project sandbox, and non-color palette strings reach inline CSS.
describe("hostile input hardening", () => {
  const withVideoClip = (clip: Record<string, unknown>) => ({
    tracks: [{ id: "v", type: "video", clips: [{ id: "c", assetId: "a", start: 0, in: 0, out: 4, ...clip }] }],
  });

  it("rejects Infinity timings (JSON 1e400 parses to Infinity)", () => {
    expect(parseEdl(withVideoClip({ out: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(parseEdl(withVideoClip({ start: Number.POSITIVE_INFINITY })).ok).toBe(false);
  });

  it("rejects absurd finite timings", () => {
    expect(parseEdl(withVideoClip({ out: 1e13 })).ok).toBe(false);
    expect(parseEdl(withVideoClip({ out: 14_000 })).ok).toBe(true);
  });

  it("rejects traversal and absolute asset paths", () => {
    const asset = (src: string) => parseEdl({ assets: [{ id: "a", kind: "video", src }] });
    expect(asset("../../secret/recording.m4a").ok).toBe(false);
    expect(asset("/etc/passwd").ok).toBe(false);
    expect(asset("C:\\Windows\\evil.mp4").ok).toBe(false);
    expect(asset("assets/../../../x.mp4").ok).toBe(false);
    expect(asset("assets/clip.mp4").ok).toBe(true);
  });

  it("rejects palette entries that are not plain color literals", () => {
    const theme = (color: string) => parseEdl({ theme: { palette: [color] } });
    expect(theme("url('https://attacker.example/beacon')").ok).toBe(false);
    expect(theme("red; background:url(//x)").ok).toBe(false);
    expect(theme("#E8B04B").ok).toBe(true);
    expect(theme("rgba(0, 0, 0, 0.5)").ok).toBe(true);
    expect(theme("rebeccapurple").ok).toBe(true);
  });

  it("caps text clip length", () => {
    const text = (t: string) =>
      parseEdl({ tracks: [{ id: "t", type: "text", clips: [{ id: "t1", start: 0, end: 2, text: t }] }] });
    expect(text("x".repeat(2001)).ok).toBe(false);
    expect(text("x".repeat(500)).ok).toBe(true);
  });
});

describe("duration helpers", () => {
  const edl = parseEdl({
    format: { fps: 30 },
    tracks: [
      { id: "v", type: "video", clips: [{ id: "c1", assetId: "a", start: 0, in: 0, out: 4 }] },
      { id: "t", type: "text", clips: [{ id: "t1", start: 1, end: 6, text: "hi" }] },
    ],
  }).edl!;

  it("durationSeconds is the latest end across tracks", () => {
    expect(durationSeconds(edl)).toBe(6);
  });

  it("durationFrames rounds up to frames", () => {
    expect(durationFrames(edl)).toBe(180);
  });
});

describe("sidecar parsers", () => {
  it("parseMeta defaults", () => {
    expect(parseMeta({})).toMatchObject({ title: "Untitled", platform: "reels", status: "draft" });
  });

  it("parseStyleProfile defaults", () => {
    const p = parseStyleProfile({});
    expect(p.palette).toEqual([]);
    expect(p.exemplars).toEqual([]);
    expect(p.pacing).toEqual({});
  });

  it("parseBenchmarks defaults", () => {
    expect(parseBenchmarks({})).toMatchObject({ count: 0, videos: [], distribution: {} });
  });
});
