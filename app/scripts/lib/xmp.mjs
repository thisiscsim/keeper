// Minimal XMP sidecar generation — the interop lingua franca. Lightroom,
// Capture One, and Bridge read xmp:Rating (-1 = rejected), xmp:Label, and
// dc:subject keywords from a sidecar named <file>.xmp next to the original.

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build an XMP packet for an asset. Rating mapping:
 * - user rejected  -> xmp:Rating = -1 (Lightroom's "rejected" flag)
 * - rated 1..5     -> xmp:Rating = n
 * - picked, unrated-> xmp:Rating = 0 with a "keeper-pick" keyword
 */
export function buildXmp({ rating = 0, flag = "unrated", tags = [], caption }) {
  const xmpRating = flag === "reject" ? -1 : rating;
  const keywords = [...tags];
  if (flag === "pick") keywords.push("keeper-pick");

  const subjectBlock =
    keywords.length > 0
      ? `
   <dc:subject>
    <rdf:Bag>
${keywords.map((k) => `     <rdf:li>${escapeXml(k)}</rdf:li>`).join("\n")}
    </rdf:Bag>
   </dc:subject>`
      : "";

  const descriptionBlock = caption
    ? `
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${escapeXml(caption)}</rdf:li>
    </rdf:Alt>
   </dc:description>`
    : "";

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Keeper">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="${xmpRating}">${subjectBlock}${descriptionBlock}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

/** Sidecar path convention: IMG_0001.jpg -> IMG_0001.xmp (Lightroom style). */
export function sidecarPath(mediaPath) {
  const dot = mediaPath.lastIndexOf(".");
  return dot > 0 ? `${mediaPath.slice(0, dot)}.xmp` : `${mediaPath}.xmp`;
}
