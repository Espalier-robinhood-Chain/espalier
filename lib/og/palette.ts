// Palet terang brief §4 (nilai konkret: gambar tidak mengenal CSS variable). Gambar share selalu tema terang.
export const PALETTE = { wall: "#f3eee4", leaf: "#2f4a3a", bark: "#5a4636", wire: "#b8b2a6", fruit: "#c9a227", ink: "#1e2a22" } as const;

// Kisi trellis seperti TrellisBackground (diagonal 24px, wire, opacity rendah), sebagai data URI untuk <img>.
export const TRELLIS_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><pattern id="t" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 0L24 24M24 0L0 24" stroke="${PALETTE.wire}" stroke-width="1" fill="none"/></pattern></defs><rect width="1200" height="630" fill="url(#t)" opacity=".3"/></svg>`,
)}`;
