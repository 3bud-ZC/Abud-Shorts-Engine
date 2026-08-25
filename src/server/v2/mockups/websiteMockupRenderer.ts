/**
 * PROGRAMMATIC WEBSITE MOCKUP RENDERER
 * ------------------------------------
 * A website-design advertisement should show websites, not stock footage of
 * someone typing. This renders clean, project-safe browser and phone mockups as
 * SVG, which FFmpeg rasterizes through librsvg - no browser, no AI service and
 * no network access at render time.
 *
 * Every mockup uses invented placeholder brands and copy. Real third-party
 * websites are never reproduced.
 */

export type MockupTemplateId =
  | "desktop_browser"
  | "mobile_site"
  | "responsive_transition"
  | "before_after"
  | "analytics_card"
  | "speed_card"
  | "cta_card";

export type MockupPalette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  accent: string;
  text: string;
  textMuted: string;
};

export const DEFAULT_MOCKUP_PALETTE: MockupPalette = {
  background: "#0E1A24",
  surface: "#FFFFFF",
  surfaceAlt: "#F2F5F8",
  primary: "#24545A",
  accent: "#D28B4C",
  text: "#132029",
  textMuted: "#7C8B96",
};

/** Deliberately generic placeholder content - never a real brand. */
export type MockupContent = {
  brandName?: string;
  headline?: string;
  subheadline?: string;
  ctaLabel?: string;
  metricLabel?: string;
  metricValue?: string;
};

const DEFAULT_CONTENT: Required<MockupContent> = {
  brandName: "Nexa Studio",
  headline: "Modern sites that convert",
  subheadline: "Fast, responsive, built for your business",
  ctaLabel: "Get started",
  metricLabel: "Load time",
  metricValue: "0.9s",
};

export type MockupRenderRequest = {
  template: MockupTemplateId;
  width: number;
  height: number;
  palette?: Partial<MockupPalette>;
  content?: MockupContent;
  /** 0..1 progress, used by templates that animate across a shot. */
  progress?: number;
};

/** Handset aspect used by every phone mockup. */
const PHONE_ASPECT = 2.02;

/** Keeps a element of `size` fully inside `extent`, with a small margin. */
function clampToFrame(position: number, size: number, extent: number, margin = 8): number {
  const maximum = Math.max(margin, extent - size - margin);
  return Math.max(margin, Math.min(position, maximum));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  rx = 0,
  extra = "",
): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${rx}" fill="${fill}"${extra ? " " + extra : ""}/>`;
}

/**
 * Rough advance width per character, matching the caption renderer's model.
 * Used only to decide truncation, never to position glyphs.
 */
function estimateTextWidth(value: string, size: number): number {
  let units = 0;
  for (const char of value) {
    if (/[\u064B-\u065F\u0670]/.test(char)) continue;
    if (char === " ") units += 0.26;
    else if (/[\u0627\u0628\u062A\u062B\u0644\u0646\u064A\u0625\u0623\u0622\u0649]/.test(char)) units += 0.34;
    else if (/[\u0600-\u06FF]/.test(char)) units += 0.52;
    else if (/\d/.test(char)) units += 0.56;
    else if (/[a-zA-Z]/.test(char)) units += 0.55;
    else units += 0.3;
  }
  return units * size;
}

/** Truncates copy to fit a box, with an ellipsis when it had to cut. */
function fitText(value: string, size: number, maxWidth: number): string {
  if (estimateTextWidth(value, size) <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && estimateTextWidth(out + "…", size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.trimEnd() + "…";
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  fill: string,
  weight = 600,
  anchor: "start" | "middle" | "end" = "start",
): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="IBM Plex Sans Arabic, DejaVu Sans, sans-serif" font-size="${size.toFixed(1)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

/** Browser chrome: traffic lights and an address bar, drawn to scale. */
function browserChrome(x: number, y: number, w: number, h: number, palette: MockupPalette): string {
  const barHeight = Math.max(18, h * 0.055);
  const dotR = barHeight * 0.16;
  const parts = [
    rect(x, y, w, h, palette.surface, 12),
    rect(x, y, w, barHeight, palette.surfaceAlt, 12),
    rect(x, y + barHeight - 12, w, 12, palette.surfaceAlt),
  ];
  ["#FF5F57", "#FEBC2E", "#28C840"].forEach((colour, index) => {
    parts.push(
      `<circle cx="${(x + barHeight * 0.5 + index * dotR * 3).toFixed(1)}" cy="${(y + barHeight / 2).toFixed(1)}" r="${dotR.toFixed(1)}" fill="${colour}"/>`,
    );
  });
  const addrX = x + barHeight * 2.6;
  const addrW = w - barHeight * 3.4;
  parts.push(rect(addrX, y + barHeight * 0.22, addrW, barHeight * 0.56, "#FFFFFF", barHeight * 0.28));
  return parts.join("");
}

function heroContent(
  x: number,
  y: number,
  w: number,
  h: number,
  palette: MockupPalette,
  content: Required<MockupContent>,
  scale: number,
): string {
  const pad = w * 0.06;
  const parts: string[] = [];
  // Hero band
  parts.push(rect(x, y, w, h * 0.46, palette.primary));
  parts.push(text(x + pad, y + h * 0.13, content.brandName, 22 * scale, "#FFFFFF", 700));
  const heroTextWidth = w - pad * 2;
  parts.push(
    text(x + pad, y + h * 0.24, fitText(content.headline, 28 * scale, heroTextWidth), 28 * scale, "#FFFFFF", 700),
  );
  parts.push(
    text(
      x + pad,
      y + h * 0.315,
      fitText(content.subheadline, 15 * scale, heroTextWidth),
      15 * scale,
      "rgba(255,255,255,0.82)",
      400,
    ),
  );
  // CTA button, clear of the subheadline baseline above it.
  const ctaSize = 16 * scale;
  const ctaLabel = fitText(content.ctaLabel, ctaSize, w * 0.5);
  const btnH = h * 0.072;
  // Pill width follows the label so the text can never spill past the button.
  const btnW = Math.min(w * 0.56, estimateTextWidth(ctaLabel, ctaSize) + btnH * 1.4);
  const btnY = y + h * 0.365;
  parts.push(rect(x + pad, btnY, btnW, btnH, palette.accent, btnH / 2));
  parts.push(text(x + pad + btnW / 2, btnY + btnH * 0.66, ctaLabel, ctaSize, "#FFFFFF", 700, "middle"));
  // Three feature cards. The icon is sized against the card HEIGHT so a wide
  // card cannot grow a square icon down over its own text rows.
  const cardW = (w - pad * 2 - pad * 0.6) / 3;
  const cardY = y + h * 0.52;
  const cardH = h * 0.2;
  const iconSize = Math.min(cardW * 0.24, cardH * 0.36);
  for (let i = 0; i < 3; i++) {
    const cx = x + pad + i * (cardW + pad * 0.3);
    parts.push(rect(cx, cardY, cardW, cardH, palette.surfaceAlt, 10));
    parts.push(rect(cx + cardW * 0.1, cardY + cardH * 0.12, iconSize, iconSize, palette.accent, 8));
    parts.push(rect(cx + cardW * 0.1, cardY + cardH * 0.66, cardW * 0.68, cardH * 0.08, palette.textMuted, 4));
    parts.push(rect(cx + cardW * 0.1, cardY + cardH * 0.8, cardW * 0.46, cardH * 0.07, "#C9D3DA", 4));
  }
  // Body lines
  const bodyY = cardY + cardH + h * 0.06;
  [0.86, 0.72, 0.5].forEach((widthRatio, index) => {
    parts.push(rect(x + pad, bodyY + index * h * 0.045, (w - pad * 2) * widthRatio, h * 0.022, "#DCE3E8", 4));
  });
  return parts.join("");
}

function phoneFrame(
  x: number,
  y: number,
  w: number,
  h: number,
  palette: MockupPalette,
  content: Required<MockupContent>,
  scale: number,
): string {
  const radius = w * 0.11;
  const parts = [
    rect(x - w * 0.03, y - h * 0.015, w * 1.06, h * 1.03, "#0B1219", radius * 1.15),
    rect(x, y, w, h, palette.surface, radius),
    // Notch
    rect(x + w * 0.32, y + h * 0.012, w * 0.36, h * 0.022, "#0B1219", h * 0.011),
  ];
  parts.push(rect(x, y + h * 0.05, w, h * 0.3, palette.primary));
  parts.push(text(x + w * 0.08, y + h * 0.14, content.brandName, 15 * scale, "#FFFFFF", 700));
  parts.push(
    text(x + w * 0.08, y + h * 0.215, fitText(content.headline, 17 * scale, w * 0.84), 17 * scale, "#FFFFFF", 700),
  );
  const phoneCtaSize = 12 * scale;
  const phoneCta = fitText(content.ctaLabel, phoneCtaSize, w * 0.72);
  const btnH = h * 0.055;
  const btnW = Math.min(w * 0.84, estimateTextWidth(phoneCta, phoneCtaSize) + btnH * 1.6);
  parts.push(rect(x + w * 0.08, y + h * 0.25, btnW, btnH, palette.accent, btnH / 2));
  parts.push(text(x + w * 0.08 + btnW / 2, y + h * 0.25 + btnH * 0.68, phoneCta, phoneCtaSize, "#FFFFFF", 700, "middle"));
  for (let i = 0; i < 3; i++) {
    const cardY = y + h * 0.4 + i * h * 0.16;
    parts.push(rect(x + w * 0.08, cardY, w * 0.84, h * 0.13, palette.surfaceAlt, 10));
    parts.push(rect(x + w * 0.12, cardY + h * 0.025, w * 0.18, h * 0.08, palette.accent, 8));
    parts.push(rect(x + w * 0.34, cardY + h * 0.035, w * 0.42, h * 0.018, palette.textMuted, 4));
    parts.push(rect(x + w * 0.34, cardY + h * 0.065, w * 0.3, h * 0.016, "#C9D3DA", 4));
  }
  return parts.join("");
}

/** A deliberately dated, cramped page - the "before" in a before/after pair. */
function outdatedSite(x: number, y: number, w: number, h: number, scale: number): string {
  const parts = [rect(x, y, w, h, "#EDE7D8")];
  parts.push(rect(x, y, w, h * 0.1, "#8B7355"));
  parts.push(text(x + w * 0.04, y + h * 0.068, "WELCOME TO OUR HOMEPAGE", 15 * scale, "#FFF8E7", 700));
  parts.push(rect(x + w * 0.04, y + h * 0.14, w * 0.34, h * 0.22, "#C4B89A", 0));
  [0.9, 0.82, 0.88, 0.6].forEach((ratio, index) => {
    parts.push(rect(x + w * 0.42, y + h * 0.15 + index * h * 0.05, (w - w * 0.46) * ratio, h * 0.022, "#A89B7C", 0));
  });
  // Cramped link list
  for (let i = 0; i < 5; i++) {
    parts.push(rect(x + w * 0.04, y + h * 0.42 + i * h * 0.042, w * 0.24, h * 0.02, "#6B5D42", 0));
  }
  parts.push(rect(x + w * 0.34, y + h * 0.42, w * 0.62, h * 0.3, "#D6CCB4", 0));
  parts.push(text(x + w * 0.65, y + h * 0.58, "Under Construction", 14 * scale, "#7A6A4F", 400, "middle"));
  return parts.join("");
}

function analyticsCard(
  x: number,
  y: number,
  w: number,
  h: number,
  palette: MockupPalette,
  content: Required<MockupContent>,
  scale: number,
  progress: number,
): string {
  const parts = [rect(x, y, w, h, palette.surface, 16)];
  parts.push(text(x + w * 0.07, y + h * 0.17, content.metricLabel, 16 * scale, palette.textMuted, 500));
  parts.push(text(x + w * 0.07, y + h * 0.34, content.metricValue, 40 * scale, palette.primary, 700));
  // Rising bar chart, revealed by progress
  const bars = [0.32, 0.46, 0.4, 0.62, 0.74, 0.88];
  const barW = (w * 0.86) / (bars.length * 1.6);
  bars.forEach((value, index) => {
    const reveal = Math.max(0, Math.min(1, progress * bars.length - index));
    const barH = h * 0.42 * value * reveal;
    const bx = x + w * 0.07 + index * barW * 1.6;
    parts.push(rect(bx, y + h * 0.86 - barH, barW, barH, index === bars.length - 1 ? palette.accent : "#BBD3D6", 6));
  });
  return parts.join("");
}

/**
 * Builds the SVG for one mockup frame. Pure and deterministic, so the same
 * request always yields identical bytes.
 */
export function renderMockupSvg(request: MockupRenderRequest): string {
  const palette = { ...DEFAULT_MOCKUP_PALETTE, ...(request.palette || {}) };
  const content = { ...DEFAULT_CONTENT, ...(request.content || {}) };
  const { width: W, height: H } = request;
  const progress = Math.max(0, Math.min(1, request.progress ?? 1));
  // Templates are authored against a 1080-wide frame and scale from there.
  const scale = W / 1080;
  const body: string[] = [rect(0, 0, W, H, palette.background)];

  switch (request.template) {
    case "desktop_browser": {
      const bw = W * 0.88;
      const bh = bw * 0.62;
      const bx = (W - bw) / 2;
      const by = (H - bh) / 2;
      body.push(browserChrome(bx, by, bw, bh, palette));
      const chromeH = Math.max(18, bh * 0.055);
      body.push(heroContent(bx, by + chromeH, bw, bh - chromeH, palette, content, scale * 1.6));
      break;
    }
    case "mobile_site": {
      // Sized against BOTH axes. Deriving the phone from the frame width alone
      // put a 1784px tall handset inside a 1080px tall 16:9 frame, so the top
      // and bottom of the mockup were simply cut off.
      const ph = Math.min(W * 0.46 * PHONE_ASPECT, H * 0.86);
      const pw = ph / PHONE_ASPECT;
      body.push(phoneFrame((W - pw) / 2, (H - ph) / 2, pw, ph, palette, content, scale * 2.2));
      break;
    }
    case "responsive_transition": {
      // Desktop slides left while the phone rises: one site, any screen.
      const bh = Math.min(W * 0.72 * 0.62, H * 0.62);
      const bw = bh / 0.62;
      // Kept fully on-frame: the desktop panel drifts, it never leaves.
      const bx = W * 0.04;
      const by = clampToFrame((H - bh) / 2 - H * 0.04, bh, H);
      body.push(browserChrome(bx, by, bw, bh, palette));
      const chromeH = Math.max(18, bh * 0.055);
      body.push(heroContent(bx, by + chromeH, bw, bh - chromeH, palette, content, scale * 1.35));
      const ph = Math.min(W * 0.26 * PHONE_ASPECT, H * 0.8);
      const pw = ph / PHONE_ASPECT;
      const px = Math.min(W * 0.66, W - pw - W * 0.02);
      // The rise animation must not carry the handset past the top edge.
      const py = clampToFrame((H - ph) / 2 + H * 0.06 - progress * H * 0.05, ph, H);
      body.push(phoneFrame(px, py, pw, ph, palette, content, scale * 1.35));
      break;
    }
    case "before_after": {
      // Two stacked panels have to share the height. Sizing each from the width
      // alone overflowed a 16:9 frame by several hundred pixels.
      const gap = H * 0.06;
      const panelH = Math.min(W * 0.86 * 0.56, (H * 0.84 - gap) / 2);
      const panelW = panelH / 0.56;
      const px = (W - panelW) / 2;
      const topY = (H - (panelH * 2 + gap)) / 2;
      const bottomY = topY + panelH + gap;
      body.push(outdatedSite(px, topY, panelW, panelH, scale * 1.5));
      body.push(rect(px, topY, panelW, panelH, "none", 0, 'stroke="#5A4632" stroke-width="2"'));
      body.push(browserChrome(px, bottomY, panelW, panelH, palette));
      const chromeH = Math.max(18, panelH * 0.055);
      body.push(heroContent(px, bottomY + chromeH, panelW, panelH - chromeH, palette, content, scale * 1.35));
      break;
    }
    case "analytics_card": {
      const cw = W * 0.76;
      const ch = cw * 0.72;
      body.push(analyticsCard((W - cw) / 2, (H - ch) / 2, cw, ch, palette, content, scale * 1.8, progress));
      break;
    }
    case "speed_card": {
      const cw = W * 0.7;
      const ch = cw * 0.7;
      const cx = (W - cw) / 2;
      const cy = (H - ch) / 2;
      body.push(rect(cx, cy, cw, ch, palette.surface, 18));
      // Speed gauge sweeping to the metric.
      const centreX = cx + cw / 2;
      const centreY = cy + ch * 0.6;
      const radius = cw * 0.32;
      const sweep = Math.PI * progress;
      const endX = centreX - radius * Math.cos(sweep);
      const endY = centreY - radius * Math.sin(sweep);
      body.push(
        `<path d="M ${(centreX - radius).toFixed(1)} ${centreY.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${(centreX + radius).toFixed(1)} ${centreY.toFixed(1)}" fill="none" stroke="#DCE3E8" stroke-width="${(cw * 0.06).toFixed(1)}" stroke-linecap="round"/>`,
      );
      body.push(
        `<path d="M ${(centreX - radius).toFixed(1)} ${centreY.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}" fill="none" stroke="${palette.accent}" stroke-width="${(cw * 0.06).toFixed(1)}" stroke-linecap="round"/>`,
      );
      body.push(text(centreX, centreY - ch * 0.02, content.metricValue, 46 * scale * 1.6, palette.primary, 700, "middle"));
      body.push(text(centreX, centreY + ch * 0.12, content.metricLabel, 17 * scale * 1.6, palette.textMuted, 500, "middle"));
      break;
    }
    case "cta_card": {
      const cw = W * 0.8;
      const ch = cw * 0.58;
      const cx = (W - cw) / 2;
      const cy = (H - ch) / 2;
      body.push(rect(cx, cy, cw, ch, palette.primary, 20));
      const ctaCardSize = 32 * scale * 1.6;
      body.push(
        text(cx + cw / 2, cy + ch * 0.34, fitText(content.headline, ctaCardSize, cw * 0.88), ctaCardSize, "#FFFFFF", 700, "middle"),
      );
      const ctaSubSize = 18 * scale * 1.6;
      body.push(
        text(cx + cw / 2, cy + ch * 0.48, fitText(content.subheadline, ctaSubSize, cw * 0.86), ctaSubSize, "rgba(255,255,255,0.85)", 400, "middle"),
      );
      const ctaBtnSize = 20 * scale * 1.6;
      const ctaBtnLabel = fitText(content.ctaLabel, ctaBtnSize, cw * 0.74);
      const btnH = ch * 0.16;
      // The pill grows to its label; a fixed width let long Arabic CTAs spill.
      const btnW = Math.min(cw * 0.86, estimateTextWidth(ctaBtnLabel, ctaBtnSize) + btnH * 1.6);
      body.push(rect(cx + (cw - btnW) / 2, cy + ch * 0.6, btnW, btnH, palette.accent, btnH / 2));
      body.push(
        text(cx + cw / 2, cy + ch * 0.6 + btnH * 0.66, ctaBtnLabel, ctaBtnSize, "#FFFFFF", 700, "middle"),
      );
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body.join("")}</svg>`;
}

export const MOCKUP_TEMPLATE_IDS: MockupTemplateId[] = [
  "desktop_browser",
  "mobile_site",
  "responsive_transition",
  "before_after",
  "analytics_card",
  "speed_card",
  "cta_card",
];

/**
 * Chooses a mockup for a shot intent. Returns null when no mockup is a better
 * answer than footage, so the router keeps using stock for those shots.
 */
export function mockupForIntent(intent: string): MockupTemplateId | null {
  switch (intent) {
    case "contrast_before":
      return "before_after";
    case "contrast_after":
    case "solution":
      return "responsive_transition";
    case "proof":
      return "analytics_card";
    case "cta":
      return "cta_card";
    case "detail":
      return "mobile_site";
    default:
      return null;
  }
}
