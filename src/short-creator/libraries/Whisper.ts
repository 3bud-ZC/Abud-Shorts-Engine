import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
} from "@remotion/install-whisper-cpp";
import fs from "fs-extra";
import path from "path";

import { Config } from "../../config";
import type { Caption } from "../../types/shorts";
import { logger } from "../../logger";

export const ErrorWhisper = new Error("There was an error with WhisperCpp");

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
