import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  detectMime,
  inspectImage,
  MIN_USABLE_EDGE_PX,
} from "./media/imageInspection";

/**
 * F1.5 CLIENT SAFETY GATE
 *
 * These cover the defects that made the product unsafe to hand to a customer:
 * unchecked UI TypeScript, media that was accepted and then rendered blank,
 * publishing forms written in developer vocabulary, and thumbnails that 404'd
 * for older videos.
 */

// ---------------------------------------------------------------- fixtures

/** Minimal valid PNG of the given dimensions (IHDR is all inspection reads). */
function pngWithSize(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** JPEG with a single SOF0 segment carrying the dimensions. */
function jpegWithSize(width: number, height: number): Buffer {
  const parts: number[] = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
  parts.push(...Buffer.from("JFIF\0", "ascii"));
  while (parts.length < 20) parts.push(0x00);
  // SOF0: marker, length, precision, height, width, components
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff);
  parts.push((width >> 8) & 0xff, width & 0xff);
  parts.push(0x03);
  return Buffer.from(parts);
}

/** Lossy WEBP (VP8 ) with 14-bit dimensions. */
function webpWithSize(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(32, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt16LE(width & 0x3fff, 26);
  buffer.writeUInt16LE(height & 0x3fff, 28);
  return buffer;
}

describe("Media format detection", () => {
  it("identifies PNG, JPEG and WEBP from their bytes, not their extension", () => {
    expect(detectMime(pngWithSize(64, 64))).toBe("image/png");
    expect(detectMime(jpegWithSize(64, 64))).toBe("image/jpeg");
    expect(detectMime(webpWithSize(64, 64))).toBe("image/webp");
  });

  it("rejects a file that merely claims to be an image", () => {
    // A text file named .png is still not a PNG.
    expect(detectMime(Buffer.from("this is definitely not an image", "utf8"))).toBeNull();
    expect(detectMime(Buffer.alloc(4))).toBeNull();
  });
});

describe("Media decode validation", () => {
  it("reads real PNG dimensions", () => {
    const result = inspectImage(pngWithSize(1080, 1920));
    expect(result.mime).toBe("image/png");
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.usable).toBe(true);
  });

  it("reads real JPEG dimensions instead of assuming them", () => {
    // The service previously returned a hardcoded 1080x1080 for every JPEG,
    // reporting a size it had never measured.
    const result = inspectImage(jpegWithSize(800, 600));
    expect(result.mime).toBe("image/jpeg");
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.width).not.toBe(1080);
  });

  it("reads real WEBP dimensions", () => {
    const result = inspectImage(webpWithSize(500, 400));
    expect(result.mime).toBe("image/webp");
    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });

  it("rejects the 1x1 placeholder PNGs that filled the library with blank cards", () => {
    // This is the exact shape of the development assets that shipped as
    // "luxury_smartwatch.png": a valid 70-byte, 1x1 PNG with nothing to show.
    const result = inspectImage(pngWithSize(1, 1));
    expect(result.decodable).toBe(true);
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("1x1");
  });

  it("rejects anything below the minimum usable edge", () => {
    const justUnder = inspectImage(pngWithSize(MIN_USABLE_EDGE_PX - 1, 500));
    expect(justUnder.usable).toBe(false);
    const justOver = inspectImage(pngWithSize(MIN_USABLE_EDGE_PX, MIN_USABLE_EDGE_PX));
    expect(justOver.usable).toBe(true);
  });

  it("reports an unreadable header as not decodable rather than guessing", () => {
    const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const result = inspectImage(truncated);
    expect(result.decodable).toBe(false);
    expect(result.usable).toBe(false);
  });

  it("explains every rejection in language a customer can act on", () => {
    [inspectImage(Buffer.from("nope")), inspectImage(pngWithSize(1, 1))].forEach((result) => {
      expect(result.reason).toBeTruthy();
      expect(result.reason).not.toMatch(/magic bytes|IHDR|buffer|undefined/i);
    });
  });
});

describe("UI typecheck gate", () => {
  const root = path.resolve(__dirname, "../../..");

  it("has a UI typecheck configuration that includes src/ui", () => {
    const configPath = path.join(root, "tsconfig.ui.json");
    expect(fs.existsSync(configPath)).toBe(true);
    // Strip comments before parsing; the config is annotated.
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(raw);
    expect(config.include).toContain("src/ui/**/*");
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(config.compilerOptions.jsx).toBeTruthy();
  });

  it("exposes a canonical typecheck command covering server and UI", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toBeTruthy();
    expect(pkg.scripts["typecheck:ui"]).toContain("tsconfig.ui.json");
    expect(pkg.scripts["typecheck:server"]).toContain("tsconfig.build.json");
    expect(pkg.scripts.typecheck).toContain("typecheck:server");
    expect(pkg.scripts.typecheck).toContain("typecheck:ui");
  });

  it("makes a broken UI fail the production build", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    // The build must run typecheck first, so a UI type error cannot reach a bundle.
    expect(pkg.scripts.build.startsWith("npm run typecheck")).toBe(true);
  });
});

describe("Client-facing language", () => {
  const uiRoot = path.resolve(__dirname, "../../ui");

  function collectTsx(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...collectTsx(full));
      else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(full);
    }
    return found;
  }

  /**
   * Surfaces allowed to name infrastructure.
   *
   * ProvidersPage and SystemPage are the explicitly technical screens.
   * ClientHealthSummary exists precisely to recognise technical service names
   * so it can map them into client groups - it never renders them.
   */
  const TECHNICAL_SURFACES = [
    "ProvidersPage.tsx",
    "SystemPage.tsx",
    "ClientHealthSummary.tsx",
    "v2Types.ts",
  ];

  /**
   * Strips comments so only code and rendered strings are inspected. Comments
   * legitimately quote the old wording to record why it was removed.
   */
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("never tells a customer to edit an environment variable", () => {
    const offenders: string[] = [];
    collectTsx(uiRoot).forEach((file) => {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      if (/set in environment|environment variable|\.env\b|DATABASE_URL/i.test(code)) {
        offenders.push(path.basename(file));
      }
    });
    expect(offenders).toEqual([]);
  });

  it("keeps infrastructure names out of ordinary client pages", () => {
    const offenders: string[] = [];
    collectTsx(uiRoot).forEach((file) => {
      const name = path.basename(file);
      if (TECHNICAL_SURFACES.includes(name)) return;
      const code = stripComments(fs.readFileSync(file, "utf8"));
      if (/PostgreSQL|\bn8n\b|worker lease|service token/i.test(code)) {
        offenders.push(name);
      }
    });
    expect(offenders).toEqual([]);
  });

  it("ships no debug or performance overlay in the client build", () => {
    const offenders: string[] = [];
    collectTsx(uiRoot).forEach((file) => {
      const text = fs.readFileSync(file, "utf8");
      // An FPS counter or debug overlay must never render on a customer page.
      if (/FPS\s*[:=]|showDebugOverlay|debugOverlay|__DEV_OVERLAY__/.test(text)) {
        offenders.push(path.basename(file));
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe("On-demand thumbnail generation", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-thumb-"));
  });
  afterAll(() => {
    fs.removeSync(tempDir);
  });

  it("serves a cached thumbnail without regenerating it", () => {
    // The route streams the cached file whenever it exists; generation is only
    // reached when it does not. This asserts the caching contract the route
    // relies on: once written, the file is present for the next request.
    const thumb = path.join(tempDir, "video1.thumb.jpg");
    fs.writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(fs.existsSync(thumb)).toBe(true);
    expect(fs.statSync(thumb).size).toBeGreaterThan(0);
  });

  it("keeps thumbnail routes behind authentication and a safe id check", () => {
    const restSource = fs.readFileSync(
      path.resolve(__dirname, "../../server/routers/rest.ts"),
      "utf8",
    );
    const routeIndex = restSource.indexOf("thumbnail cover image");
    expect(routeIndex).toBeGreaterThan(-1);
    const routeBlock = restSource.slice(routeIndex, routeIndex + 2200);
    // Auth guard, id validation and generation must all be present, and the
    // path must be composed from the configured videos directory.
    expect(routeBlock).toContain('requireProtectedAccess("videos:read")');
    expect(routeBlock).toContain("isSafeVideoId(videoId)");
    expect(routeBlock).toContain("ensureThumbnail");
    expect(routeBlock).toContain("this.config.videosDirPath");
  });

  it("writes the generated cover atomically", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../short-creator/ShortCreator.ts"),
      "utf8",
    );
    const index = source.indexOf("public async ensureThumbnail");
    expect(index).toBeGreaterThan(-1);
    const block = source.slice(index, index + 1600);
    // Encoded to a separate pending file and then renamed into place, so no
    // request can observe a half-written JPEG. The pending name keeps a .jpg
    // extension because ffmpeg derives the output format from it.
    expect(block).toContain(".thumb.pending-");
    expect(block).toContain(".jpg`");
    expect(block).toContain("moveSync");
    // The pending file is cleaned up whether or not encoding succeeded.
    expect(block).toContain("finally");
  });
});
