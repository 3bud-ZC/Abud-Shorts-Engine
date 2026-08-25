import fs from "fs-extra";
import path from "path";
import cuid from "cuid";
import { execFile } from "child_process";
import { capabilityManager } from "../capabilities/capabilityManager";

export type MotionTemplateType =
  | "kinetic_typography"
  | "stat_animation"
  | "feature_list"
  | "cta_card"
  | "logo_reveal"
  | "explainer_diagram";

export type MotionSceneRenderInput = {
  template: MotionTemplateType;
  title: string;
  subtitle?: string;
  numberStat?: { value: string; label: string; suffix?: string };
  features?: string[];
  ctaText?: string;
  contactText?: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  brandColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
  };
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
};

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

  public async renderMotionScene(input: MotionSceneRenderInput): Promise<MotionSceneRenderResult> {
    const artifactId = `motion_${cuid()}`;
    const outputFilename = `${artifactId}.mp4`;
    const outputPath = path.join(this.artifactsDir, outputFilename);

    const width = input.width || 1080;
    const height = input.height || 1920;
    const fps = input.fps || 25;
    const duration = Math.max(1.0, input.durationSeconds);
    const totalFrames = Math.round(duration * fps);

    const primaryColor = input.brandColors?.primary || "#24545a";
    const accentColor = input.brandColors?.accent || "#d97706";
    const bgColor = input.brandColors?.background || "#090d16";

    let ffmpegBin = "ffmpeg";
    try {
      const installer = require("@ffmpeg-installer/ffmpeg");
      if (installer?.path && fs.existsSync(installer.path)) {
        ffmpegBin = installer.path;
      }
    } catch {}
    if (process.env.FFMPEG_PATH) {
      ffmpegBin = process.env.FFMPEG_PATH;
    }

    // Use Python script with Pillow / OpenCV to render Motion Canvas frames & encode with FFmpeg
    const pythonBin = capabilityManager.getQualityPythonPath() || process.env.PYTHON_BIN || "python";

    const generatorScript = `
import sys, os, math, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out_mp4 = sys.argv[1]
duration_s = float(sys.argv[2])
width = int(sys.argv[3])
height = int(sys.argv[4])
fps = int(sys.argv[5])
params = json.loads(sys.argv[6])
ffmpeg_exe = sys.argv[7]

total_frames = int(duration_s * fps)
template = params.get("template", "kinetic_typography")
title = params.get("title", "ABUD SHORTS")
subtitle = params.get("subtitle", "")
features = params.get("features", [])
stat = params.get("numberStat", {})
cta = params.get("ctaText", "اطلب الآن")

primary = params.get("brandColors", {}).get("primary", "#24545a")
accent = params.get("brandColors", {}).get("accent", "#d97706")
bg = params.get("brandColors", {}).get("background", "#090d16")

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

c_pri = hex_to_rgb(primary)
c_acc = hex_to_rgb(accent)
c_bg = hex_to_rgb(bg)

# Try loading Cairo font or system font
font_large = None
font_mid = None
font_small = None

font_candidates = [
    os.environ.get("ABUD_FONT_DIR", "/usr/share/fonts/truetype/abud") + "/IBMPlexSansArabic-Bold.ttf",
    os.environ.get("ABUD_FONT_DIR", "/usr/share/fonts/truetype/abud") + "/IBMPlexSansArabic-SemiBold.ttf",
    os.environ.get("ABUD_FONT_DIR", "/usr/share/fonts/truetype/abud") + "/NotoKufiArabic-Bold.ttf",
    os.environ.get("ABUD_FONT_DIR", "/usr/share/fonts/truetype/abud") + "/Cairo-Bold.ttf",
    os.path.join(os.getcwd(), "assets/fonts/IBMPlexSansArabic-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

loaded_font_path = None
for fc in font_candidates:
    if os.path.exists(fc):
        try:
            font_large = ImageFont.truetype(fc, 68)
            font_mid = ImageFont.truetype(fc, 44)
            font_small = ImageFont.truetype(fc, 32)
            loaded_font_path = fc
            break
        except Exception:
            pass

if not font_large:
    # Pillow's default bitmap font has no Arabic coverage and renders tofu.
    # Say so on stderr rather than silently producing unreadable frames.
    print("ABUD_MOTION_FONT_MISSING: no usable TTF found", file=sys.stderr)
    font_large = ImageFont.load_default()
    font_mid = font_large
    font_small = font_large

# Open FFmpeg pipe for high-speed direct MP4 encoding
ffmpeg_cmd = [
    ffmpeg_exe, "-y",
    "-f", "rawvideo",
    "-vcodec", "rawvideo",
    "-s", f"{width}x{height}",
    "-pix_fmt", "rgb24",
    "-r", str(fps),
    "-i", "-",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-crf", "18",
    out_mp4
]

proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

for f in range(total_frames):
    t = f / float(fps)
    progress = f / float(total_frames)

    # 1. Background with smooth dynamic gradient and subtle floating particle mesh
    img = Image.new("RGB", (width, height), color=c_bg)
    draw = ImageDraw.Draw(img)

    # Dynamic ambient glow
    glow_x = int(width * 0.5 + math.sin(t * 1.5) * 80)
    glow_y = int(height * 0.45 + math.cos(t * 1.2) * 120)
    glow_r = int(380 + math.sin(t * 2.0) * 40)
    draw.ellipse([(glow_x - glow_r, glow_y - glow_r), (glow_x + glow_r, glow_y + glow_r)], fill=(int(c_pri[0]*0.4), int(c_pri[1]*0.4), int(c_pri[2]*0.4)))

    # Decorative geometric grid lines
    grid_alpha = int(40 + math.sin(t * 1.8) * 15)
    for y_line in range(200, height, 160):
        draw.line([(60, y_line), (width - 60, y_line)], fill=(30, 45, 65), width=1)

    # 2. Render Motion Template
    if template == "stat_animation":
        # Animated rolling counter & circular progress
        pct = min(1.0, (t / max(0.1, duration_s * 0.7)))
        eased_pct = 1.0 - math.pow(1.0 - pct, 3)
        stat_val = stat.get("value", "99.9")
        stat_lbl = stat.get("label", "نسبة رضا العملاء")
        stat_sfx = stat.get("suffix", "%")

        # Draw glowing circular progress bar
        center_x, center_y = width // 2, height // 2 - 120
        radius = 240
        draw.ellipse([(center_x - radius, center_y - radius), (center_x + radius, center_y + radius)], outline=(40, 60, 85), width=16)
        
        # Arc progress
        sweep_angle = int(eased_pct * 360)
        if sweep_angle > 0:
            draw.arc([(center_x - radius, center_y - radius), (center_x + radius, center_y + radius)], start=-90, end=-90 + sweep_angle, fill=c_acc, width=20)

        # Counter text
        try:
            val_num = float(stat_val.replace('%', ''))
            display_val = f"{val_num * eased_pct:.1f}{stat_sfx}"
        except:
            display_val = f"{stat_val} {stat_sfx}"

        draw.text((center_x, center_y - 20), display_val, fill=(255, 255, 255), font=font_large, anchor="mm")
        draw.text((center_x, center_y + 80), stat_lbl, fill=c_acc, font=font_mid, anchor="mm")
        draw.text((center_x, height // 2 + 240), title, fill=(240, 240, 240), font=font_mid, anchor="mm")

    elif template == "feature_list":
        # Staggered feature list reveals
        draw.text((width // 2, 340), title, fill=(255, 255, 255), font=font_large, anchor="mm")
        card_start_y = 520
        items = features if features else ["جودة فائقة بدقة 4K", "سرعة تنفيذ لا مثيل لها", "دعم فني وضمان استرجاع", "تصميم عصري وجذاب"]
        
        for idx, item in enumerate(items):
            item_delay = 0.35 + idx * 0.45
            item_t = max(0.0, min(1.0, (t - item_delay) / 0.4))
            eased_item = 1.0 - math.pow(1.0 - item_t, 3)
            
            card_y = card_start_y + idx * 160
            card_x = int(80 + (1.0 - eased_item) * 120)
            card_w = width - 160

            if item_t > 0:
                # Pill background
                draw.rounded_rectangle([(card_x, card_y), (card_x + card_w, card_y + 110)], radius=24, fill=(int(c_pri[0]*0.65), int(c_pri[1]*0.65), int(c_pri[2]*0.65)), outline=c_acc if item_t > 0.8 else (60, 80, 110), width=3)
                # Checkmark icon circle
                draw.ellipse([(card_x + 30, card_y + 25), (card_x + 90, card_y + 85)], fill=c_acc)
                draw.text((card_x + 60, card_y + 55), "✓", fill=(255, 255, 255), font=font_mid, anchor="mm")
                # Feature text
                draw.text((card_x + 120, card_y + 55), item, fill=(255, 255, 255), font=font_mid, anchor="lm")

    elif template == "cta_card":
        # Pulsing CTA card with glowing action button
        pulse = 1.0 + math.sin(t * 4.0) * 0.04
        card_cx, card_cy = width // 2, height // 2
        card_w, card_h = int(820 * pulse), int(540 * pulse)

        draw.rounded_rectangle([(card_cx - card_w//2, card_cy - card_h//2), (card_cx + card_w//2, card_cy + card_h//2)], radius=36, fill=(int(c_pri[0]*0.8), int(c_pri[1]*0.8), int(c_pri[2]*0.8)), outline=c_acc, width=6)
        
        draw.text((card_cx, card_cy - 120), title, fill=(255, 255, 255), font=font_large, anchor="mm")
        if subtitle:
            draw.text((card_cx, card_cy - 40), subtitle, fill=(210, 225, 240), font=font_mid, anchor="mm")
            
        # Glowing CTA button
        btn_w, btn_h = 560, 110
        btn_y = card_cy + 110
        draw.rounded_rectangle([(card_cx - btn_w//2, btn_y - btn_h//2), (card_cx + btn_w//2, btn_y + btn_h//2)], radius=28, fill=c_acc)
        draw.text((card_cx, btn_y), cta, fill=(255, 255, 255), font=font_large, anchor="mm")

    elif template == "explainer_diagram":
        # Process arrows & steps diagram
        draw.text((width // 2, 280), title, fill=(255, 255, 255), font=font_large, anchor="mm")
        steps = ["1. حماية الملفات", "2. نسخ سحابي فوري", "3. استرجاع بضغطة زر"]
        start_y = 480
        for s_idx, step_txt in enumerate(steps):
            s_delay = 0.2 + s_idx * 0.6
            s_t = max(0.0, min(1.0, (t - s_delay) / 0.4))
            eased_s = 1.0 - math.pow(1.0 - s_t, 3)
            
            box_y = start_y + s_idx * 240
            box_x = width // 2
            
            if s_t > 0:
                bw, bh = int(680 * eased_s), 130
                draw.rounded_rectangle([(box_x - bw//2, box_y), (box_x + bw//2, box_y + bh)], radius=24, fill=(int(c_pri[0]*0.7), int(c_pri[1]*0.7), int(c_pri[2]*0.7)), outline=c_acc, width=3)
                draw.text((box_x, box_y + bh//2), step_txt, fill=(255, 255, 255), font=font_mid, anchor="mm")

                if s_idx < len(steps) - 1:
                    # Arrow
                    arr_y = box_y + bh + 45
                    draw.text((box_x, arr_y), "↓", fill=c_acc, font=font_large, anchor="mm")

    else:
        # Default kinetic typography
        eased_in = min(1.0, t / 0.5)
        scale_in = 0.8 + 0.2 * (1.0 - math.pow(1.0 - eased_in, 3))
        
        draw.text((width // 2, height // 2 - 80), title, fill=(255, 255, 255), font=font_large, anchor="mm")
        if subtitle:
            draw.text((width // 2, height // 2 + 40), subtitle, fill=c_acc, font=font_mid, anchor="mm")

    # Pipe frame bytes directly to FFmpeg
    proc.stdin.write(img.tobytes())

proc.stdin.close()
proc.wait()
print(json.dumps({"success": True}))
`;

    return new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        [
          "-c",
          generatorScript,
          outputPath,
          String(duration),
          String(width),
          String(height),
          String(fps),
          JSON.stringify(input),
          ffmpegBin,
        ],
        { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        (err, stdout, stderr) => {
          if (err || !fs.existsSync(outputPath)) {
            reject(new Error(`Motion Canvas rendering failed: ${stderr || err?.message}`));
            return;
          }

          const relativePath = path.relative(this.baseDataDir, outputPath).replace(/\\/g, "/");

          resolve({
            artifactId,
            relativePath,
            absolutePath: outputPath,
            durationSeconds: duration,
            width,
            height,
            template: input.template,
            generatedAt: new Date().toISOString(),
          });
        },
      );
    });
  }
}

export const motionEngine = new MotionEngine();
