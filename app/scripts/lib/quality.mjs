// Technical-quality measurement and the deterministic CV verdict. All pure
// functions over grayscale pixel buffers (extracted via ffmpeg) so they are
// unit-testable without media fixtures.

/**
 * Variance of the 3x3 Laplacian over a grayscale image. The classic sharpness
 * proxy: in-focus images have strong second-derivative energy, blurry ones
 * don't. Computed on a normalized-size thumb so scores are comparable.
 */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  const n = (width - 2) * (height - 2);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean/σ/clipping stats over a grayscale buffer. */
export function exposureStats(gray) {
  let sum = 0;
  let sumSq = 0;
  let high = 0;
  let low = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    sum += v;
    sumSq += v * v;
    if (v >= 250) high++;
    if (v <= 5) low++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    meanLuma: round2(mean),
    lumaStdDev: round2(Math.sqrt(variance)),
    clippedHighlights: round4(high / n),
    clippedShadows: round4(low / n),
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10_000) / 10_000;

/** Screenshots: PNGs at exact device resolutions with no camera EXIF. */
export function isLikelyScreenshot({ format, exif, fileName }) {
  if (exif?.make || exif?.model) return false;
  if (/screenshot|screen shot|capture d.ecran/i.test(fileName)) return true;
  return format === "png";
}

export function isLikelyScreenRecording({ mediaType, exif, fileName }) {
  if (mediaType !== "video") return false;
  if (/screen.?record|simulator/i.test(fileName)) return true;
  return false;
}

/**
 * The deterministic CV verdict: quality measurements + taste thresholds in,
 * an AI suggestion with reasons and calibrated confidence out. Conservative
 * by design — only unambiguous junk gets a high-confidence reject; everything
 * borderline routes to review for the human (or the LLM judge) to decide.
 */
export function cvVerdict({ quality, mediaType, durationSec, format, exif, fileName, byteSize }, thresholds) {
  const reasons = [];
  let suggestion = "keep";
  let confidence = 0.55;

  const q = quality ?? {};

  if (byteSize !== undefined && byteSize < 1024) {
    return verdict("reject", 0.97, [{ code: "corrupt", detail: "file is under 1KB" }]);
  }

  // Black/flat frames: nearly no luma variation.
  if (q.lumaStdDev !== undefined && q.lumaStdDev < 2.5) {
    const dark = (q.meanLuma ?? 128) < 16;
    return verdict("reject", 0.95, [
      { code: dark ? "black-frame" : "flat-frame", detail: `σ=${q.lumaStdDev}` },
    ]);
  }

  // Accidental video: sub-second pocket clips.
  if (mediaType === "video" && durationSec !== undefined && durationSec <= thresholds.accidentalClipSec) {
    return verdict("reject", 0.9, [
      { code: "accidental-clip", detail: `${durationSec.toFixed(1)}s long` },
    ]);
  }

  if (isLikelyScreenshot({ format, exif, fileName })) {
    reasons.push({ code: "screenshot" });
    suggestion = "review";
    confidence = 0.6;
  }
  if (isLikelyScreenRecording({ mediaType, exif, fileName })) {
    reasons.push({ code: "screen-recording" });
    suggestion = "review";
    confidence = 0.6;
  }

  // Blur (photos only — video sharpness varies frame to frame).
  if (mediaType === "photo" && q.blurScore !== undefined) {
    if (q.blurScore < thresholds.blurReject) {
      reasons.push({ code: "blurry", detail: `sharpness ${q.blurScore.toFixed(1)}` });
      return verdict("reject", 0.88, reasons);
    }
    if (q.blurScore < thresholds.blurReview) {
      reasons.push({ code: "soft-focus", detail: `sharpness ${q.blurScore.toFixed(1)}` });
      suggestion = "review";
      confidence = 0.55;
    }
  }

  // Exposure.
  if (q.clippedShadows !== undefined && q.clippedShadows > thresholds.clipReject && (q.meanLuma ?? 128) < 40) {
    reasons.push({ code: "underexposed", detail: `${Math.round(q.clippedShadows * 100)}% crushed` });
    return verdict("reject", 0.85, reasons);
  }
  if (q.clippedHighlights !== undefined && q.clippedHighlights > thresholds.clipReject) {
    reasons.push({ code: "overexposed", detail: `${Math.round(q.clippedHighlights * 100)}% blown` });
    return verdict("reject", 0.85, reasons);
  }
  if (
    (q.clippedShadows !== undefined && q.clippedShadows > thresholds.clipReview && (q.meanLuma ?? 128) < 60) ||
    (q.clippedHighlights !== undefined && q.clippedHighlights > thresholds.clipReview)
  ) {
    const under = (q.clippedShadows ?? 0) > (q.clippedHighlights ?? 0);
    reasons.push({ code: under ? "underexposed" : "overexposed" });
    suggestion = "review";
    confidence = Math.min(confidence, 0.55);
  }

  if (reasons.length === 0) {
    reasons.push({ code: "well-exposed" });
    confidence = 0.7;
  }
  return verdict(suggestion, confidence, reasons);
}

function verdict(suggestion, confidence, reasons) {
  return {
    suggestion,
    confidence,
    reasons,
    source: "cv",
    at: new Date().toISOString(),
  };
}
