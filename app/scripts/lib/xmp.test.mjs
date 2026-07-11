import { describe, expect, it } from "vitest";
import { buildXmp, sidecarPath } from "./xmp.mjs";

describe("buildXmp", () => {
  it("maps rejection to Rating -1 (Lightroom convention)", () => {
    const xmp = buildXmp({ flag: "reject", rating: 3 });
    expect(xmp).toContain('xmp:Rating="-1"');
  });

  it("keeps star ratings for non-rejects", () => {
    expect(buildXmp({ flag: "pick", rating: 4 })).toContain('xmp:Rating="4"');
  });

  it("adds keeper-pick keyword and tags as dc:subject", () => {
    const xmp = buildXmp({ flag: "pick", rating: 0, tags: ["ocean", "sunset"] });
    expect(xmp).toContain("<rdf:li>ocean</rdf:li>");
    expect(xmp).toContain("<rdf:li>keeper-pick</rdf:li>");
  });

  it("escapes XML in captions", () => {
    const xmp = buildXmp({ flag: "unrated", rating: 0, caption: 'kids & <dogs> "playing"' });
    expect(xmp).toContain("kids &amp; &lt;dogs&gt; &quot;playing&quot;");
    expect(xmp).not.toContain("<dogs>");
  });

  it("omits subject/description blocks when empty", () => {
    const xmp = buildXmp({ flag: "unrated", rating: 0 });
    expect(xmp).not.toContain("dc:subject");
    expect(xmp).not.toContain("dc:description");
  });
});

describe("sidecarPath", () => {
  it("swaps the extension", () => {
    expect(sidecarPath("/x/IMG_1.CR3")).toBe("/x/IMG_1.xmp");
    expect(sidecarPath("/x/clip.mp4")).toBe("/x/clip.xmp");
    expect(sidecarPath("/x/noext")).toBe("/x/noext.xmp");
  });
});
