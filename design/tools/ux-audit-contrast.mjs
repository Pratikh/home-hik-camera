/**
 * ux-audit-contrast.mjs — WCAG contrast calculator for the Home CCTV Hub theme.
 * Read-only: parses tokens from src/app/globals.css and prints ratio tables for
 * the text/background pairs that actually occur in the UI (verified by grep).
 *
 * Run: node design/tools/ux-audit-contrast.mjs
 */

const TOKENS = {
  bg: "#080b10",
  panel: "#10151c",
  card: "#141b24",
  ink: "#e8eef6",
  muted: "#93a0b3",
  teal: "#3ee0c7",
  online: "#3ddc97",
  offline: "#ff6b6b",
  warn: "#f0c36a",
  primaryInk: "#08110f", // text colour used on teal primary buttons
  black: "#000000",
  white: "#ffffff",
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Composite `top` (optionally translucent) over an opaque `bottom` hex. */
function over(topHex, alpha, bottomHex) {
  const t = hexToRgb(topHex);
  const b = hexToRgb(bottomHex);
  const mix = t.map((channel, i) => Math.round(channel * alpha + b[i] * (1 - alpha)));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Fade a foreground colour toward a background at `opacity` (CSS opacity on text). */
function fade(fgHex, opacity, bgHex) {
  return over(fgHex, opacity, bgHex);
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function verdict(r, sizePx, bold = false) {
  const large = sizePx >= 24 || (bold && sizePx >= 18.66);
  const need = large ? 3 : 4.5;
  const ok = r >= need;
  return `${ok ? "PASS" : "FAIL"} (needs ${need}:1, ${large ? "large" : "normal"} ${sizePx}px${bold ? " bold" : ""})`;
}

const rows = [];
function check(label, fg, bg, sizePx, bold = false) {
  const r = ratio(fg, bg);
  rows.push({
    label,
    fg,
    bg,
    size: `${sizePx}px${bold ? " bold" : ""}`,
    ratio: Number(r.toFixed(2)),
    verdict: verdict(r, sizePx, bold),
  });
}

// --- Core text pairs -------------------------------------------------------
check("ink on bg (body copy)", TOKENS.ink, TOKENS.bg, 16);
check("ink on card", TOKENS.ink, TOKENS.card, 14);
check("ink on panel (sidebar)", TOKENS.ink, TOKENS.panel, 14);
check("muted on bg (page intro detail)", TOKENS.muted, TOKENS.bg, 14);
check("muted on card (card detail/captions)", TOKENS.muted, TOKENS.card, 14);
check("muted on card at 12px (metadata)", TOKENS.muted, TOKENS.card, 12);
check("muted on panel (sidebar subtitle)", TOKENS.muted, TOKENS.panel, 12);
check("muted on bg-card/50 (disabled rule card)", TOKENS.muted, over("#141b24", 0.5, TOKENS.bg), 12);

// --- Accent / status text --------------------------------------------------
check("teal on card (links, active nav)", TOKENS.teal, TOKENS.card, 14);
check("teal on bg (inline text links)", TOKENS.teal, TOKENS.bg, 14);
check("teal on bg 11px ('New', 'View event')", TOKENS.teal, TOKENS.bg, 11);
check("online on card (Enabled / Sent)", TOKENS.online, TOKENS.card, 14);
check("offline on card (CRITICAL badge text)", TOKENS.offline, TOKENS.card, 11);
check("warn on card (error text / HIGH badge)", TOKENS.warn, TOKENS.card, 14);
check("warn on bg (form error line)", TOKENS.warn, TOKENS.bg, 14);

// --- Status pills: text tint over tinted fill over card --------------------
check(
  "CRITICAL pill: offline text on offline/15 over card",
  TOKENS.offline,
  over(TOKENS.offline, 0.15, TOKENS.card),
  11,
);
check(
  "HIGH pill: warn text on warn/15 over card",
  TOKENS.warn,
  over(TOKENS.warn, 0.15, TOKENS.card),
  11,
);
check(
  "Sent pill: online text on online/15 over card",
  TOKENS.online,
  over(TOKENS.online, 0.15, TOKENS.card),
  11,
);
check("NORMAL pill: muted text on white/5 over card", TOKENS.muted, over("#ffffff", 0.05, TOKENS.card), 11);

// --- Buttons ---------------------------------------------------------------
check("primary: #08110f on teal", TOKENS.primaryInk, TOKENS.teal, 14, true);
check("login/error primary: black on teal", "#000000", TOKENS.teal, 14, true);
check("ghost button: ink on white/5 over card", TOKENS.ink, over("#ffffff", 0.05, TOKENS.card), 14);
check("ghost button: ink on white/5 over bg", TOKENS.ink, over("#ffffff", 0.05, TOKENS.bg), 14);

// --- Disabled controls (Tailwind disabled:opacity-40 / 60 / 50) ------------
check("disabled pagination: ink@40% on card", fade(TOKENS.ink, 0.4, TOKENS.card), TOKENS.card, 14);
check("disabled pagination: ink@40% on card 12px", fade(TOKENS.ink, 0.4, TOKENS.card), TOKENS.card, 12);
check("disabled button label: ink@60% on card", fade(TOKENS.ink, 0.6, TOKENS.card), TOKENS.card, 14);
check("disabled calendar day: muted@35% on panel", fade(TOKENS.muted, 0.35, TOKENS.panel), TOKENS.panel, 14);
check("secondary text @ 0.5 (card/50 treatment)", fade(TOKENS.ink, 0.5, TOKENS.card), TOKENS.card, 12);

// --- Borders / non-text ----------------------------------------------------
rows.push({
  label: "line token rgba(232,237,245,0.1) over bg (1px borders)",
  fg: over("#e8edf5", 0.1, TOKENS.bg),
  bg: TOKENS.bg,
  size: "1px border",
  ratio: Number(ratio(over("#e8edf5", 0.1, TOKENS.bg), TOKENS.bg).toFixed(2)),
  verdict: ratio(over("#e8edf5", 0.1, TOKENS.bg), TOKENS.bg) >= 3 ? "PASS (3:1 non-text)" : "FAIL (3:1 non-text UI component)",
});
rows.push({
  label: "line border on card (input / card boundary)",
  fg: over("#e8edf5", 0.1, TOKENS.card),
  bg: TOKENS.card,
  size: "1px border",
  ratio: Number(ratio(over("#e8edf5", 0.1, TOKENS.card), TOKENS.card).toFixed(2)),
  verdict: ratio(over("#e8edf5", 0.1, TOKENS.card), TOKENS.card) >= 3 ? "PASS (3:1 UI)" : "FAIL (3:1 UI component)",
});
rows.push({
  label: "active nav pill: white/10 over panel vs panel",
  fg: over("#ffffff", 0.1, TOKENS.panel),
  bg: TOKENS.panel,
  size: "fill",
  ratio: Number(ratio(over("#ffffff", 0.1, TOKENS.panel), TOKENS.panel).toFixed(2)),
  verdict: ratio(over("#ffffff", 0.1, TOKENS.panel), TOKENS.panel) >= 3 ? "PASS" : "FAIL (3:1 UI component)",
});
rows.push({
  label: "teal focus ring vs card (2px outline offset 2)",
  fg: TOKENS.teal,
  bg: TOKENS.card,
  size: "2px outline",
  ratio: Number(ratio(TOKENS.teal, TOKENS.card).toFixed(2)),
  verdict: ratio(TOKENS.teal, TOKENS.card) >= 3 ? "PASS" : "FAIL",
});
rows.push({
  label: "teal focus ring vs panel (sidebar nav)",
  fg: TOKENS.teal,
  bg: TOKENS.panel,
  size: "2px outline",
  ratio: Number(ratio(TOKENS.teal, TOKENS.panel).toFixed(2)),
  verdict: ratio(TOKENS.teal, TOKENS.panel) >= 3 ? "PASS" : "FAIL",
});
rows.push({
  label: "teal focus ring vs bg",
  fg: TOKENS.teal,
  bg: TOKENS.bg,
  size: "2px outline",
  ratio: Number(ratio(TOKENS.teal, TOKENS.bg).toFixed(2)),
  verdict: ratio(TOKENS.teal, TOKENS.bg) >= 3 ? "PASS" : "FAIL",
});
rows.push({
  label: "teal focus ring vs teal primary button fill",
  fg: TOKENS.teal,
  bg: TOKENS.teal,
  size: "2px outline",
  ratio: 1,
  verdict: "FAIL (ring is the same colour as the fill it surrounds)",
});
rows.push({
  label: "warning border warn/50 on card",
  fg: over(TOKENS.warn, 0.5, TOKENS.card),
  bg: TOKENS.card,
  size: "1px border",
  ratio: Number(ratio(over(TOKENS.warn, 0.5, TOKENS.card), TOKENS.card).toFixed(2)),
  verdict: ratio(over(TOKENS.warn, 0.5, TOKENS.card), TOKENS.card) >= 3 ? "PASS" : "FAIL (3:1 UI component)",
});
rows.push({
  label: "teal focus ring vs bg (3:1 for UI component)",
  fg: TOKENS.teal,
  bg: TOKENS.bg,
  size: "2px outline",
  ratio: Number(ratio(TOKENS.teal, TOKENS.bg).toFixed(2)),
  verdict: ratio(TOKENS.teal, TOKENS.bg) >= 3 ? "PASS" : "FAIL",
});
rows.push({
  label: "status lamp dot offline vs card (colour-only signal)",
  fg: TOKENS.offline,
  bg: TOKENS.card,
  size: "10px dot",
  ratio: Number(ratio(TOKENS.offline, TOKENS.card).toFixed(2)),
  verdict: ratio(TOKENS.offline, TOKENS.card) >= 3 ? "PASS as graphics" : "FAIL as graphics",
});
rows.push({
  label: "status lamp dot warn vs card",
  fg: TOKENS.warn,
  bg: TOKENS.card,
  size: "10px dot",
  ratio: Number(ratio(TOKENS.warn, TOKENS.card).toFixed(2)),
  verdict: ratio(TOKENS.warn, TOKENS.card) >= 3 ? "PASS as graphics" : "FAIL as graphics",
});

const header = ["Pair", "size", "ratio", "verdict"];
const widths = [52, 14, 7, 40];
const pad = (s, w) => String(s).padEnd(w);
console.log(header.map((h, i) => pad(h, widths[i])).join(""));
console.log(widths.map((w) => "-".repeat(w)).join(""));
for (const row of rows) {
  console.log(pad(row.label, widths[0]) + pad(row.size, widths[1]) + pad(row.ratio + ":1", widths[2]) + pad(row.verdict, widths[3]));
}

console.log("\n--- Failing pairs only (normal-text AA 4.5:1) ---");
for (const row of rows) {
  if (row.verdict.startsWith("FAIL")) console.log(`- ${row.label}: ${row.ratio}:1 ${row.verdict}`);
}
