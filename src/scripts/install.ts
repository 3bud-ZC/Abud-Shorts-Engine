import { ensureBrowser } from "@remotion/renderer";

import { logger } from "../logger";
import { Kokoro } from "../short-creator/libraries/Kokoro";
import { MusicManager } from "../short-creator/music";
import { Config } from "../config";
import { Whisper } from "../short-creator/libraries/Whisper";

async function retryInstallStep<T>(name: string, action: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error: unknown) {
      lastError = error;
      if (attempt >= attempts) break;
      logger.warn({ err: error, attempt, attempts }, `${name} failed; retrying`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
  throw lastError;
}

// runs in docker
export async function install() {
  const config = new Config();

  logger.info("Installing dependencies...");
  logger.info("Installing Kokoro...");
  await retryInstallStep("Kokoro install", () => Kokoro.init(config.kokoroModelPrecision));
  logger.info("Installing browser shell...");
  await retryInstallStep("Browser shell install", () => ensureBrowser());
  logger.info("Installing whisper.cpp");
  await retryInstallStep("Whisper install", () => Whisper.init(config));
  logger.info("Installing dependencies complete");

  logger.info("Ensuring the music files exist...");
  const musicManager = new MusicManager(config);
  try {
    musicManager.ensureMusicFilesExist();
  } catch (error: unknown) {
    logger.error(error, "Missing music files");
    process.exit(1);
  }
}

install()
  .then(() => {
    logger.info("Installation complete");
  })
  .catch((error: unknown) => {
    logger.error(error, "Installation failed");
    process.exit(1);
  });
