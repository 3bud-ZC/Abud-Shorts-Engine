import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
} from "@remotion/install-whisper-cpp";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { Config } from "../../config";
import type { Caption } from "../../types/shorts";
import { logger } from "../../logger";

export const ErrorWhisper = new Error("There was an error with WhisperCpp");

/**
 * Mirrors `@remotion/install-whisper-cpp`'s own (unexported) executable path
 * resolution, which `transcribe()` uses internally: versions >= 1.7.4 look
 * for `build/bin/whisper-cli(.exe)` instead of a flat `main(.exe)`. That
 * split matches the prebuilt Windows release zip, but a Unix install (git
 * clone + `make`, no CMake) keeps producing a flat `main` regardless of the
 * pinned version - so on Linux this path never exists and every
 * transcription fails with an unhandled ENOENT from the spawned process
 * rather than a catchable error. After install, normalize whichever layout
 * was actually produced (flat `main`/`whisper-cli`, or `build/bin/...`) into
 * the layout this exact version expects.
 */
async function ensureWhisperExecutableLayout(whisperPath: string, whisperCppVersion: string): Promise<void> {
  const usesBuildBinLayout = compareSemver(whisperCppVersion, "1.7.4") >= 0;
  const expectedName = usesBuildBinLayout ? "whisper-cli" : "main";
  const expectedDir = usesBuildBinLayout ? path.join(whisperPath, "build", "bin") : whisperPath;
  const exeSuffix = os.platform() === "win32" ? ".exe" : "";
  const expectedPath = path.join(expectedDir, `${expectedName}${exeSuffix}`);

  if (await fs.pathExists(expectedPath)) {
    return;
  }

  const candidateDirs = [whisperPath, path.join(whisperPath, "build", "bin"), path.join(whisperPath, "Release")];
  const candidateNames = ["whisper-cli", "main"];
  for (const dir of candidateDirs) {
    for (const name of candidateNames) {
      const candidate = path.join(dir, `${name}${exeSuffix}`);
      if (await fs.pathExists(candidate)) {
        await fs.ensureDir(expectedDir);
        await fs.copy(candidate, expectedPath);
        logger.debug({ candidate, expectedPath }, "Normalized whisper.cpp executable layout for the pinned version");
        return;
      }
    }
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

const minWhisperModelBytes: Record<string, number> = {
  tiny: 50 * 1024 * 1024,
  "tiny.en": 50 * 1024 * 1024,
  base: 100 * 1024 * 1024,
  "base.en": 100 * 1024 * 1024,
  small: 350 * 1024 * 1024,
  "small.en": 350 * 1024 * 1024,
};

export class Whisper {
  constructor(private config: Config) { }

  static async init(config: Config): Promise<Whisper> {
    const modelsDir = path.join(config.whisperInstallPath, "models");
    let shouldInstall = false;

    if (!(await fs.pathExists(config.whisperInstallPath))) {
      shouldInstall = true;
    } else if (!(await fs.pathExists(modelsDir))) {
      shouldInstall = true;
    } else {
      const modelFiles = await fs.readdir(modelsDir);
      shouldInstall = modelFiles.length === 0;
      const expectedModelPath = path.join(modelsDir, `ggml-${config.whisperModel}.bin`);
      const minBytes = minWhisperModelBytes[config.whisperModel] || 20 * 1024 * 1024;
      if (!shouldInstall && !(await fs.pathExists(expectedModelPath))) {
        shouldInstall = true;
      }
      if (!shouldInstall) {
        const stats = await fs.stat(expectedModelPath);
        if (stats.size < minBytes) {
          logger.warn(
            { expectedModelPath, actualBytes: stats.size, minBytes },
            "Whisper model file is too small for the configured model; reprovisioning.",
          );
          await fs.remove(expectedModelPath);
          shouldInstall = true;
        }
      }
    }

    if (!config.runningInDocker || shouldInstall) {
      logger.debug({ runningInDocker: config.runningInDocker }, "Installing WhisperCpp");
      await installWhisperCpp({
        to: config.whisperInstallPath,
        version: config.whisperVersion,
        printOutput: true,
      });
      logger.debug("WhisperCpp installed");
      // downloadWhisperModel writes straight to `${modelsDir}/ggml-*.bin` and
      // does not create the parent directory itself; a fresh install (nothing
      // pre-created by installWhisperCpp's extracted archive) fails with an
      // ENOENT that is easy to miss because it surfaces as an unhandled write
      // stream error rather than a rejected promise.
      await fs.ensureDir(modelsDir);
      logger.debug("Downloading Whisper model");
      await downloadWhisperModel({
        model: config.whisperModel,
        folder: modelsDir,
        printOutput: config.whisperVerbose,
        onProgress: (downloadedBytes, totalBytes) => {
          const progress = `${Math.round((downloadedBytes / totalBytes) * 100)}%`;
          logger.debug(
            { progress, model: config.whisperModel },
            "Downloading Whisper model",
          );
        },
      });
      // todo run the jfk command to check if everything is ok
      logger.debug("Whisper model downloaded");
    }

    // Runs whether or not this call just installed anything: a directory
    // that already satisfied `shouldInstall` (e.g. bootstrapped by an older
    // image/version, or shared across containers via a persistent bind
    // mount) can still have an executable layout that doesn't match the
    // currently pinned whisperVersion.
    await ensureWhisperExecutableLayout(config.whisperInstallPath, config.whisperVersion);

    return new Whisper(config);
  }

  // todo shall we extract it to a Caption class?
  async CreateCaption(audioPath: string, language?: string): Promise<Caption[]> {
    logger.debug({ audioPath, language }, "Starting to transcribe audio");
    const { transcription } = await transcribe({
      model: this.config.whisperModel,
      whisperPath: this.config.whisperInstallPath,
      modelFolder: path.join(this.config.whisperInstallPath, "models"),
      whisperCppVersion: this.config.whisperVersion,
      inputPath: audioPath,
      tokenLevelTimestamps: true,
      language: language === "ar" ? "ar" : language?.startsWith("en") ? "en" : null,
      printOutput: this.config.whisperVerbose,
      onProgress: (progress) => {
        logger.debug({ audioPath }, `Transcribing is ${progress} complete`);
      },
    });
    logger.debug({ audioPath }, "Transcription finished, creating captions");

    const captions: Caption[] = [];
    transcription.forEach((record) => {
      if (record.text === "") {
        return;
      }

      record.tokens.forEach((token) => {
        if (token.text.startsWith("[_TT")) {
          return;
        }
        // if token starts without space and the previous node didn't have space either, merge them
        if (
          captions.length > 0 &&
          !token.text.startsWith(" ") &&
          !captions[captions.length - 1].text.endsWith(" ")
        ) {
          captions[captions.length - 1].text += record.text;
          captions[captions.length - 1].endMs = record.offsets.to;
          return;
        }
        captions.push({
          text: token.text,
          startMs: record.offsets.from,
          endMs: record.offsets.to,
        });
      });
    });
    logger.debug({ audioPath, captions }, "Captions created");
    return captions;
  }
}
