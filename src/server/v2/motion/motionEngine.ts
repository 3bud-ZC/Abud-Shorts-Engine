import fs from "fs-extra";
import path from "path";
import cuid from "cuid";
import { execFile } from "child_process";
import { capabilityManager } from "../capabilities/capabilityManager";
import { containsArabic, prepareArabicForRaster } from "./arabicRasterText";

export type MotionTemplateType =
  | "kinetic_typography"
  | "stat_animation"
  | "feature_list"
  | "cta_card"
  | "logo_reveal"
  | "explainer_diagram";

/** Colours the templates draw with. Resolved by `brandStyle.resolveBrandStyle`. */
export type MotionPalette = {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  textMuted?: string;
  onPrimary?: string;
  onAccent?: string;
};

/** Brand copy a template may draw. Absent fields are simply not drawn. */
export type MotionBrandFields = {
  brandName?: string;
  website?: string;
  socialHandle?: string;
  logoPath?: string;
};

export type MotionSceneRenderInput = {
  template: MotionTemplateType;
  title: string;
  subtitle?: string;
  numberStat?: { value: string; label: string; suffix?: string };
  features?: string[];
  /** Ordered process steps for the explainer diagram. */
  steps?: string[];
  ctaText?: string;
  contactText?: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  brandColors?: MotionPalette;
  brand?: MotionBrandFields;
  language?: string;
};

export type MotionSceneRenderResult = {
  artifactId: string;
  relativePath: string;
  absolutePath: string;
  durationSeconds: number;
  width: number;
  height: number;
  template: MotionTemplateType;
  generatedAt: string;
  /** Font file the frames were actually rasterized with. */
  fontPath?: string;
  /** True when Arabic was pre-shaped because the renderer could not shape it. */
  preShapedArabic: boolean;
  /** Characters the chosen font has no glyph for. Empty means no tofu. */
  missingGlyphs: string[];
  /** Which brand fields were actually drawn. */
  brandFieldsDrawn: string[];
};

/**
 * MOTION ENGINE
 * -------------
 * Renders the graphic treatments - kinetic type, stat cards, feature lists,
 * process diagrams and CTA cards - as real MP4 clips, with Pillow drawing the
 * frames and FFmpeg encoding them from a raw pipe.
 *
 * Three defects were closed here in F2.1:
 *
 *  - Arabic came out unshaped. The QUALITY_CPU Pillow wheel is built without
 *    libraqm, so it drew disconnected letters in left-to-right order. Arabic is
 *    now pre-shaped by `arabicRasterText` when the renderer cannot shape it
 *    itself, and left in logical order when it can.
 *  - Font discovery depended on `os.getcwd()` and fell through to Windows system
 *    fonts, which is how tofu boxes appeared. Resolution now starts from the
 *    fonts bundled in this repository, resolved from the module's own location,
 *    and WOFF/WOFF2 files are refused outright because FreeType cannot rasterize
 *    them for Pillow.
 *  - Templates drew hardcoded Arabic placeholder copy ("99.9%", a fixed feature
 *    list) when the caller supplied nothing, so a motion-graphics video asserted
 *    statistics nobody had claimed. A template now draws only what it was given.
 */

/** Only these can be rasterized by FreeType for Pillow. */
const RASTER_FONT_EXTENSIONS = [".ttf", ".otf", ".ttc"];

/** Preference order: bold display faces first, all bundled under OFL. */
const PREFERRED_FONT_FILES = [
  "IBMPlexSansArabic-Bold.ttf",
  "NotoKufiArabic-Bold.ttf",
  "Cairo-Bold.ttf",
  "IBMPlexSansArabic-SemiBold.ttf",
  "NotoKufiArabic-Variable.ttf",
  "Cairo-Variable.ttf",
  "NotoSansArabic-Variable.ttf",
  "IBMPlexSansArabic-Regular.ttf",
];

export function isRasterizableFont(filePath: string): boolean {
  return RASTER_FONT_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Directories that may hold the bundled font pack, most specific first.
 *
 * `__dirname` is used rather than `process.cwd()` because a render worker is
 * started from whatever directory the operator happened to be in, and the
 * previous cwd-relative lookup silently missed the repo's own fonts.
 */
export function motionFontDirectories(): string[] {
  const fromModule = path.resolve(__dirname, "../../../../assets/fonts");
  return [
    process.env.ABUD_FONT_DIR,
    fromModule,
    path.resolve(process.cwd(), "assets/fonts"),
    path.resolve(process.cwd(), "../assets/fonts"),
    "/usr/share/fonts/truetype/abud",
  ].filter(Boolean) as string[];
}

/**
 * Picks the font the frames will be drawn with.
 *
 * Returns null rather than falling back to a system font: a wrong font is how
 * tofu reaches a finished video, and the caller must be able to say so.
 */
export function resolveMotionFont(): { path: string; directory: string } | null {
  for (const directory of motionFontDirectories()) {
    if (!directory || !fs.existsSync(directory)) continue;
    for (const preferred of PREFERRED_FONT_FILES) {
      const candidate = path.join(directory, preferred);
      if (fs.existsSync(candidate) && isRasterizableFont(candidate)) {
        return { path: candidate, directory };
      }
    }
    // Any other rasterizable face in the pack is still better than none. WOFF
    // and WOFF2 are skipped by `isRasterizableFont`.
    const anyFont = fs
      .readdirSync(directory)
      .filter((name) => isRasterizableFont(name))
      .sort()[0];
    if (anyFont) return { path: path.join(directory, anyFont), directory };
  }
  return null;
}

const GENERATOR_SCRIPT = `
import sys, os, math, json, subprocess
from PIL import Image, ImageDraw, ImageFont

out_mp4 = sys.argv[1]
params = json.loads(sys.argv[2])
ffmpeg_exe = sys.argv[3]

width = int(params["width"])
height = int(params["height"])
fps = int(params["fps"])
duration_s = float(params["durationSeconds"])
total_frames = max(1, int(duration_s * fps))
template = params.get("template", "kinetic_typography")
font_path = params.get("fontPath")

# The container's Pillow is built with libraqm and shapes Arabic itself; the
# QUALITY_CPU wheel is not. The caller supplies both forms and the renderer picks
# the one its own build can draw correctly.
try:
    from PIL import features
    has_raqm = bool(features.check("raqm"))
except Exception:
    has_raqm = False

def copy_for(field):
    entry = params.get("copy", {}).get(field)
    if not entry:
        return ""
    return entry["logical"] if has_raqm else entry["raster"]

def copy_list(field):
    entries = params.get("copyLists", {}).get(field) or []
    return [e["logical"] if has_raqm else e["raster"] for e in entries]

def hex_to_rgb(h, fallback=(255, 255, 255)):
    try:
        h = str(h).lstrip("#")
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        return fallback

palette = params.get("palette", {})
c_pri = hex_to_rgb(palette.get("primary"), (36, 84, 90))
c_sec = hex_to_rgb(palette.get("secondary"), (27, 59, 71))
c_acc = hex_to_rgb(palette.get("accent"), (210, 139, 76))
c_bg = hex_to_rgb(palette.get("background"), (9, 13, 22))
c_surface = hex_to_rgb(palette.get("surface"), (19, 32, 41))
c_text = hex_to_rgb(palette.get("text"), (255, 255, 255))
c_muted = hex_to_rgb(palette.get("textMuted"), (185, 198, 210))
c_on_accent = hex_to_rgb(palette.get("onAccent"), (18, 32, 42))

scale = height / 1920.0
def sized(value):
    return max(8, int(value * scale))

if not font_path or not os.path.exists(font_path):
    print(json.dumps({"success": False, "error": "no_raster_font"}))
    sys.exit(1)

font_large = ImageFont.truetype(font_path, sized(72))
font_mid = ImageFont.truetype(font_path, sized(46))
font_small = ImageFont.truetype(font_path, sized(34))

# Glyph coverage check. A character with no glyph rasterizes as a blank or a
# .notdef box, so it is reported rather than silently shipped.
missing = []
probe_font = ImageFont.truetype(font_path, 40)
seen = set()
for field_value in list(params.get("copy", {}).values()):
    for ch in field_value["raster"]:
        if ch in seen or ch.isspace():
            continue
        seen.add(ch)
        try:
            if probe_font.getmask(ch).getbbox() is None and not ch.isspace():
                missing.append(ch)
        except Exception:
            missing.append(ch)

def text_size(value, font):
    if not value:
        return (0, 0)
    box = font.getbbox(value)
    return (box[2] - box[0], box[3] - box[1])

def draw_text(draw, xy, value, font, fill, anchor="mm"):
    if not value:
        return
    kwargs = {"font": font, "fill": fill, "anchor": anchor}
    if has_raqm:
        kwargs["direction"] = "rtl" if params.get("rtl") else "ltr"
    try:
        draw.text(xy, value, **kwargs)
    except Exception:
        draw.text(xy, value, font=font, fill=fill, anchor=anchor)

def fit_font(value, base_font_size, max_width):
    """Shrinks a display line until it fits, so long copy never runs off frame."""
    size = base_font_size
    while size > sized(22):
        candidate = ImageFont.truetype(font_path, size)
        if text_size(value, candidate)[0] <= max_width:
            return candidate
        size = int(size * 0.92)
    return ImageFont.truetype(font_path, sized(22))

def ease_out(t):
    return 1.0 - math.pow(1.0 - max(0.0, min(1.0, t)), 3)

logo = None
logo_path = params.get("logoPath")
if logo_path and os.path.exists(logo_path):
    try:
        logo = Image.open(logo_path).convert("RGBA")
        target_w = int(width * 0.22)
        ratio = target_w / float(logo.width)
        logo = logo.resize((target_w, max(1, int(logo.height * ratio))))
    except Exception:
        logo = None

ffmpeg_cmd = [
    ffmpeg_exe, "-y",
    "-f", "rawvideo", "-vcodec", "rawvideo",
    "-s", "%dx%d" % (width, height),
    "-pix_fmt", "rgb24", "-r", str(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "18",
    out_mp4,
]
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

title = copy_for("title")
subtitle = copy_for("subtitle")
cta = copy_for("ctaText")
contact = copy_for("contactText")
brand_name = copy_for("brandName")
website = copy_for("website")
social = copy_for("socialHandle")
stat_label = copy_for("statLabel")
stat_value = params.get("statValue") or ""
stat_suffix = params.get("statSuffix") or ""
features = copy_list("features")
steps = copy_list("steps")

margin = int(width * 0.08)
safe_width = width - margin * 2

def draw_background(draw, t, style):
    """Each template gets its own clean editorial ground, avoiding meaningless geometric shapes."""
    draw.rectangle([(0, 0), (width, height)], fill=c_bg)
    # Subtle dark gradient / tone ramp
    step_count = 18
    for i in range(step_count):
        y1 = int(height * (i / float(step_count)))
        y2 = int(height * ((i + 1) / float(step_count)))
        ratio = i / float(step_count)
        # Gentle gradient from c_bg into deep surface tone
        r = int(c_bg[0] + (c_surface[0] - c_bg[0]) * 0.45 * ratio)
        g = int(c_bg[1] + (c_surface[1] - c_bg[1]) * 0.45 * ratio)
        b = int(c_bg[2] + (c_surface[2] - c_bg[2]) * 0.45 * ratio)
        draw.rectangle([(0, y1), (width, y2)], fill=(r, g, b))
    
    # Tasteful restrained accent lines
    if style == "editorial_top":
        draw.rectangle([(margin, sized(40)), (width - margin, sized(44))], fill=c_pri)
    elif style == "editorial_bottom":
        draw.rectangle([(margin, height - sized(60)), (width - margin, height - sized(56))], fill=c_sec)
    elif style == "subtle_lines":
        for i in range(0, 3):
            line_y = int(height * (0.82 + i * 0.03))
            draw.line([(margin, line_y), (width - margin, line_y)], fill=(int(c_surface[0] * 1.2), int(c_surface[1] * 1.2), int(c_surface[2] * 1.2)), width=1)

def draw_brand_footer(img, draw):
    """Brand identity sits in the lower band, drawn only from supplied fields."""
    y = int(height * 0.92)
    line = "   ".join([v for v in [brand_name, website, social] if v])
    if line:
        draw_text(draw, (width // 2, y), line, font_small, c_muted, anchor="mm")
    if logo is not None:
        img.paste(logo, (int((width - logo.width) / 2), int(height * 0.05)), logo)

for frame_index in range(total_frames):
    t = frame_index / float(fps)
    progress = frame_index / float(total_frames)

    if template == "stat_animation":
        bg_style = "editorial_top"
    elif template == "feature_list":
        bg_style = "subtle_lines"
    elif template == "explainer_diagram":
        bg_style = "editorial_top"
    elif template == "cta_card":
        bg_style = "editorial_bottom"
    else:
        bg_style = "subtle_lines"

    img = Image.new("RGB", (width, height), color=c_bg)
    draw = ImageDraw.Draw(img)
    draw_background(draw, t, bg_style)

    if template == "stat_animation":
        eased = ease_out(t / max(0.1, duration_s * 0.7))
        cx, cy = width // 2, int(height * 0.44)
        card_w = safe_width
        card_h = int(height * 0.38)
        
        # Clean editorial metric container
        draw.rounded_rectangle(
            [(cx - card_w // 2, cy - card_h // 2), (cx + card_w // 2, cy + card_h // 2)],
            radius=sized(28), fill=c_surface, outline=c_sec, width=sized(2),
        )
        
        # Category / Context pill badge at top of card
        if stat_label:
            badge_font = fit_font(stat_label, sized(32), card_w - sized(80))
            bw, bh = text_size(stat_label, badge_font)
            badge_y = cy - card_h // 2 + sized(50)
            badge_pad_x = sized(32)
            badge_pad_y = sized(14)
            draw.rounded_rectangle(
                [(cx - bw // 2 - badge_pad_x, badge_y - bh // 2 - badge_pad_y),
                 (cx + bw // 2 + badge_pad_x, badge_y + bh // 2 + badge_pad_y)],
                radius=sized(16), fill=c_pri,
            )
            draw_text(draw, (cx, badge_y), stat_label, badge_font, c_on_accent)
        
        # Main numeric counter
        display_value = stat_value
        try:
            numeric = float(str(stat_value).replace("%", "").replace(",", ""))
            display_value = ("%.1f" % (numeric * eased)).rstrip("0").rstrip(".")
        except Exception:
            display_value = stat_value
        headline = (display_value + stat_suffix) if display_value else ""
        if headline:
            num_font = fit_font(headline, sized(110), card_w - sized(80))
            draw_text(draw, (cx, cy + sized(10)), headline, num_font, c_text)
        
        # Sleek progress indicator line
        bar_w = int((card_w - sized(120)) * eased)
        bar_y = cy + card_h // 2 - sized(45)
        draw.rounded_rectangle(
            [(cx - (card_w - sized(120)) // 2, bar_y - sized(4)),
             (cx + (card_w - sized(120)) // 2, bar_y + sized(4))],
            radius=sized(4), fill=c_sec,
        )
        if bar_w > 0:
            draw.rounded_rectangle(
                [(cx - (card_w - sized(120)) // 2, bar_y - sized(4)),
                 (cx - (card_w - sized(120)) // 2 + bar_w, bar_y + sized(4))],
                radius=sized(4), fill=c_acc,
            )
        
        # Context Title below card
        if title:
            draw_text(draw, (cx, int(height * 0.72)), title, fit_font(title, sized(50), safe_width), c_text)

    elif template == "feature_list":
        if title:
            draw_text(draw, (width // 2, int(height * 0.2)), title, fit_font(title, sized(64), safe_width), c_text)
        card_h = sized(112)
        gap = sized(36)
        start_y = int(height * 0.30)
        shown_features = features[:5]
        step_delay = (duration_s * 0.55) / max(1, len(shown_features))
        for idx, item in enumerate(shown_features):
            reveal = ease_out((t - idx * step_delay) / max(0.18, step_delay * 0.8))
            if reveal <= 0:
                continue
            y = start_y + idx * (card_h + gap)
            x = margin + int((1.0 - reveal) * margin)
            draw.rounded_rectangle(
                [(x, y), (x + safe_width, y + card_h)],
                radius=sized(20),
                fill=c_surface,
                outline=c_acc if reveal > 0.8 else c_sec,
                width=sized(2),
            )
            marker = (x + safe_width - sized(58)) if params.get("rtl") else (x + sized(58))
            draw.rounded_rectangle(
                [(marker - sized(24), y + card_h // 2 - sized(24)), (marker + sized(24), y + card_h // 2 + sized(24))],
                radius=sized(10),
                fill=c_acc,
            )
            draw_text(draw, (marker, y + card_h // 2), str(idx + 1), font_small, c_on_accent)
            if params.get("rtl"):
                label_x = marker - sized(54)
                label_anchor = "rm"
            else:
                label_x = marker + sized(54)
                label_anchor = "lm"
            draw_text(
                draw,
                (label_x, y + card_h // 2),
                item,
                fit_font(item, sized(40), safe_width - sized(180)),
                c_text,
                anchor=label_anchor,
            )

    elif template == "explainer_diagram":
        if title:
            draw_text(draw, (width // 2, int(height * 0.17)), title, fit_font(title, sized(62), safe_width), c_text)
        items = steps if steps else features
        box_h = sized(124)
        gap = sized(64)
        start_y = int(height * 0.28)
        shown_steps = items[:4]
        step_delay = (duration_s * 0.6) / max(1, len(shown_steps))
        for idx, item in enumerate(shown_steps):
            reveal = ease_out((t - idx * step_delay) / max(0.18, step_delay * 0.8))
            if reveal <= 0:
                continue
            y = start_y + idx * (box_h + gap)
            box_w = int(safe_width * reveal)
            cx = width // 2
            draw.rounded_rectangle(
                [(cx - box_w // 2, y), (cx + box_w // 2, y + box_h)],
                radius=sized(20), fill=c_surface, outline=c_acc if reveal > 0.8 else c_sec, width=sized(2),
            )
            draw_text(draw, (cx, y + box_h // 2), item, fit_font(item, sized(40), safe_width - sized(60)), c_text)
            if idx < len(shown_steps) - 1:
                arrow_y = y + box_h + gap // 2
                draw.line([(cx, y + box_h + sized(6)), (cx, arrow_y + sized(10))], fill=c_acc, width=sized(4))

    elif template == "cta_card":
        cx, cy = width // 2, height // 2
        card_w = safe_width
        card_h = int(height * 0.36)
        draw.rounded_rectangle(
            [(cx - card_w // 2, cy - card_h // 2), (cx + card_w // 2, cy + card_h // 2)],
            radius=sized(32), fill=c_surface, outline=c_sec, width=sized(3),
        )
        if title:
            draw_text(draw, (cx, cy - card_h // 3), title, fit_font(title, sized(56), card_w - sized(80)), c_text)
        if subtitle:
            draw_text(draw, (cx, cy - sized(10)), subtitle, fit_font(subtitle, sized(38), card_w - sized(80)), c_muted)
        if cta:
            btn_w = min(card_w - sized(60), int(width * 0.72))
            btn_h = sized(104)
            btn_y = cy + card_h // 2 - btn_h // 2 - sized(36)
            draw.rounded_rectangle(
                [(cx - btn_w // 2, btn_y - btn_h // 2), (cx + btn_w // 2, btn_y + btn_h // 2)],
                radius=sized(24), fill=c_acc,
            )
            draw_text(draw, (cx, btn_y), cta, fit_font(cta, sized(48), btn_w - sized(50)), c_on_accent)
        if contact:
            draw_text(draw, (cx, cy + card_h // 2 + sized(50)), contact, font_small, c_muted)

    elif template == "logo_reveal":
        reveal = ease_out(t / max(0.4, duration_s * 0.6))
        cx, cy = width // 2, height // 2
        box_size = int(sized(260) * reveal)
        draw.rounded_rectangle(
            [(cx - box_size // 2, cy - box_size // 2), (cx + box_size // 2, cy + box_size // 2)],
            radius=sized(28), fill=c_surface, outline=c_acc, width=sized(3),
        )
        if title:
            draw_text(draw, (cx, cy + box_size // 2 + sized(60)), title, fit_font(title, sized(56), safe_width), c_text)

    else:
        # Kinetic typography: clean word-by-word reveal
        words = [w for w in title.split(" ") if w]
        line_font = fit_font(title, sized(70), safe_width)
        if words:
            per_word = max(0.12, (duration_s * 0.55) / len(words))
            shown = [w for i, w in enumerate(words) if t >= i * per_word]
            partial = " ".join(shown)
            draw_text(draw, (width // 2, int(height * 0.44)), partial, line_font, c_text)
        if subtitle:
            sub_reveal = ease_out((t - duration_s * 0.45) / max(0.3, duration_s * 0.3))
            if sub_reveal > 0:
                draw_text(draw, (width // 2, int(height * 0.58)), subtitle, fit_font(subtitle, sized(42), safe_width), c_acc)
        underline_w = int(safe_width * min(1.0, progress * 1.4))
        draw.rounded_rectangle(
            [(margin, int(height * 0.52)), (margin + underline_w, int(height * 0.52) + sized(4))],
            radius=sized(2),
            fill=c_acc,
        )

    draw_brand_footer(img, draw)
    proc.stdin.write(img.tobytes())

proc.stdin.close()
proc.wait()
print(json.dumps({
    "success": True,
    "missingGlyphs": sorted(set(missing)),
    "shapedByRenderer": has_raqm,
}))
`;

export class MotionEngine {
  private baseDataDir: string;
  private artifactsDir: string;

  constructor() {
    this.baseDataDir = process.env.DATA_DIR_PATH
      ? path.resolve(process.env.DATA_DIR_PATH)
      : path.resolve(process.cwd(), "data-dev");
    this.artifactsDir = path.join(this.baseDataDir, "artifacts", "motion");
    fs.ensureDirSync(this.artifactsDir);
  }

  private ffmpegBinary(): string {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const installer = require("@ffmpeg-installer/ffmpeg");
      if (installer?.path && fs.existsSync(installer.path)) return installer.path;
    } catch {
      // Falls through to whatever is on PATH.
    }
    return "ffmpeg";
  }

  public async renderMotionScene(
    input: MotionSceneRenderInput,
  ): Promise<MotionSceneRenderResult> {
    const artifactId = `motion_${cuid()}`;
    const outputPath = path.join(this.artifactsDir, `${artifactId}.mp4`);

    const width = input.width || 1080;
    const height = input.height || 1920;
    const fps = input.fps || 25;
    const duration = Math.max(1.0, input.durationSeconds);

    const font = resolveMotionFont();
    if (!font) {
      throw new Error(
        "Motion rendering needs a bundled TTF/OTF font. None was found in assets/fonts or ABUD_FONT_DIR; " +
          "WOFF and WOFF2 files cannot be rasterized and are ignored deliberately.",
      );
    }

    const brand = input.brand || {};
    const palette = input.brandColors || {};

    // Every drawn string is carried twice: the logical string for a renderer
    // that shapes Arabic itself, and a pre-shaped one for a renderer that does
    // not. Nothing is invented - an absent field stays an empty string and the
    // template simply does not draw it.
    const copyFields: Record<string, string | undefined> = {
      title: input.title,
      subtitle: input.subtitle,
      ctaText: input.ctaText,
      contactText: input.contactText,
      brandName: brand.brandName,
      website: brand.website,
      socialHandle: brand.socialHandle,
      statLabel: input.numberStat?.label,
    };
    const copy: Record<string, { logical: string; raster: string }> = {};
    Object.entries(copyFields).forEach(([key, value]) => {
      const logical = String(value ?? "").trim();
      if (!logical) return;
      copy[key] = { logical, raster: prepareArabicForRaster(logical) };
    });

    const toCopyList = (values?: string[]) =>
      (values || [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .map((logical) => ({ logical, raster: prepareArabicForRaster(logical) }));

    const payload = {
      template: input.template,
      width,
      height,
      fps,
      durationSeconds: duration,
      fontPath: font.path,
      rtl: containsArabic(
        [input.title, input.subtitle, input.ctaText].filter(Boolean).join(" "),
      ),
      palette: {
        primary: palette.primary || "#24545A",
        secondary: palette.secondary || "#1B3B47",
        accent: palette.accent || "#D28B4C",
        background: palette.background || "#090D16",
        surface: palette.surface || "#132029",
        text: palette.text || "#FFFFFF",
        textMuted: palette.textMuted || "#B9C6D2",
        onAccent: palette.onAccent || "#12202A",
      },
      logoPath: brand.logoPath && fs.existsSync(brand.logoPath) ? brand.logoPath : undefined,
      statValue: input.numberStat?.value || "",
      statSuffix: input.numberStat?.suffix || "",
      copy,
      copyLists: {
        features: toCopyList(input.features),
        steps: toCopyList(input.steps),
      },
    };

    const pythonBin =
      capabilityManager.getQualityPythonPath() || process.env.PYTHON_BIN || "python";

    const result = await new Promise<{ missingGlyphs: string[]; shapedByRenderer: boolean }>(
      (resolve, reject) => {
        execFile(
          pythonBin,
          ["-c", GENERATOR_SCRIPT, outputPath, JSON.stringify(payload), this.ffmpegBinary()],
          { timeout: 90000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
          (error, stdout, stderr) => {
            if (error || !fs.existsSync(outputPath)) {
              reject(new Error(`Motion rendering failed: ${stderr || error?.message}`));
              return;
            }
            try {
              const parsed = JSON.parse(String(stdout).trim().split("\n").pop() || "{}");
              resolve({
                missingGlyphs: parsed.missingGlyphs || [],
                shapedByRenderer: Boolean(parsed.shapedByRenderer),
              });
            } catch {
              resolve({ missingGlyphs: [], shapedByRenderer: false });
            }
          },
        );
      },
    );

    return {
      artifactId,
      relativePath: path.relative(this.baseDataDir, outputPath).replace(/\\/g, "/"),
      absolutePath: outputPath,
      durationSeconds: duration,
      width,
      height,
      template: input.template,
      generatedAt: new Date().toISOString(),
      fontPath: font.path,
      preShapedArabic: !result.shapedByRenderer && payload.rtl,
      missingGlyphs: result.missingGlyphs,
      brandFieldsDrawn: ["brandName", "website", "socialHandle"].filter((key) => Boolean(copy[key])),
    };
  }
}

export const motionEngine = new MotionEngine();
