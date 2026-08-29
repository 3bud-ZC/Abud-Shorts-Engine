import z from "zod";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { ensureBrowser } from "@remotion/renderer";

import { Config } from "../../config";
import { shortVideoSchema } from "../../components/utils";
import { logger } from "../../logger";
import { OrientationEnum } from "../../types/shorts";
import { getOrientationConfig } from "../../components/utils";

export class Remotion {
  constructor(
    private bundled: string,
    private config: Config,
  ) {}

  static async init(config: Config): Promise<Remotion> {
    await ensureBrowser();

    const bundled = await bundle({
      entryPoint: path.join(
        config.packageDirPath,
        config.devMode ? "src" : "dist",
        "components",
        "root",
        `index.${config.devMode ? "ts" : "js"}`,
      ),
    });

    return new Remotion(bundled, config);
  }

  async render(
    data: z.infer<typeof shortVideoSchema>,
    id: string,
    orientation: OrientationEnum,
    quality: "draft" | "standard" | "high" | "premium" = "standard",
  ) {
    const { component } = getOrientationConfig(orientation);
    const timeoutInMilliseconds = this.config.remotionRenderTimeoutMs;

    const composition = await selectComposition({
      serveUrl: this.bundled,
      id: component,
      inputProps: data,
      timeoutInMilliseconds: Math.max(120000, Math.min(timeoutInMilliseconds, 240000)),
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
        disableWebSecurity: true,
      },
    });

    const isDraft = quality === "draft";
    const isHigh = quality === "high";

    logger.debug({ component, videoID: id, quality, isDraft, isHigh, timeoutInMilliseconds }, "Rendering video with Remotion");

    const outputLocation = path.join(this.config.videosDirPath, `${id}.mp4`);

    await renderMedia({
      codec: "h264",
      composition,
      serveUrl: this.bundled,
      outputLocation,
      inputProps: data,
      imageFormat: "jpeg",
      jpegQuality: isDraft ? 70 : (isHigh ? 92 : 85),
      scale: isDraft ? 0.75 : 1.0,
      timeoutInMilliseconds,
      // "if-possible" tries h264_nvenc when ffmpeg + a GPU are actually
      // available and falls back to libx264 automatically otherwise - never
      // a hard requirement on any particular host. Off by default; see
      // ABUD_SHORTS_ENGINE_STATUS.md V2.4 Pass 5 for the controlled
      // before/after benchmark this default was decided from.
      hardwareAcceleration: this.config.hardwareAcceleration,
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
        disableWebSecurity: true,
      },
      onProgress: ({ progress }) => {
        logger.debug(`Rendering ${id} ${Math.floor(progress * 100)}% complete`);
      },
      // preventing memory issues with docker
      concurrency: this.config.concurrency,
      offthreadVideoCacheSizeInBytes: this.config.videoCacheSizeInBytes,
    });

    logger.debug(
      {
        outputLocation,
        component,
        videoID: id,
      },
      "Video rendered with Remotion",
    );
  }

  async testRender(outputLocation: string) {
    const composition = await selectComposition({
      serveUrl: this.bundled,
      id: "TestVideo",
    });

    await renderMedia({
      codec: "h264",
      composition,
      serveUrl: this.bundled,
      outputLocation,
      onProgress: ({ progress }) => {
        logger.debug(
          `Rendering test video: ${Math.floor(progress * 100)}% complete`,
        );
      },
      // preventing memory issues with docker
      concurrency: this.config.concurrency,
      offthreadVideoCacheSizeInBytes: this.config.videoCacheSizeInBytes,
    });
  }
}
