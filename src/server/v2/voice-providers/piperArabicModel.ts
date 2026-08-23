import crypto from "crypto";
import https from "https";
import fs from "fs-extra";
import path from "path";

export const PIPER_ARABIC_MODEL = {
  engine: "piper-tts",
  runtimeVersion: "1.7.0",
  runtimeSource: "https://pypi.org/project/piper-tts/1.7.0/",
  runtimeLicense: "GPL-3.0-or-later",
  model: "ar_JO-kareem-medium",
  voice: "kareem",
  language: "ar_JO",
  dialectApplicability: "Arabic; Egyptian/colloquial acceptance requires human listening",
  gender: "male",
  quality: "medium",
  sampleRate: 22050,
  modelSizeBytes: 63200000,
  modelLicense: "MIT (rhasspy/piper-voices repository metadata)",
  modelSource:
    "https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium",
  modelUrl:
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx?download=true",
  configUrl:
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json?download=true",
  modelSha256:
    "9e95cab07b679da603bba17c4dec7ab3111320571964ee95c0379603c086491e",
  configSha256:
    "ea6d9b9d9076dbdb6bf5c98c6a141ef154959d2359709b37855727964e7d6c4d",
  attribution: "Piper voice ar_JO/kareem from rhasspy/piper-voices",
  commercialUseAllowed: true,
  redistributionAllowed: true,
} as const;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function availableBytes(dirPath: string): number | null {
  try {
    fs.ensureDirSync(dirPath);
    const statfs = (fs as any).statfsSync?.(dirPath);
    if (!statfs) return null;
    return Number(statfs.bavail) * Number(statfs.bsize);
  } catch {
    return null;
  }
}

function downloadFile(url: string, outputPath: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirects < 5
      ) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, url).toString();
        downloadFile(redirectUrl, outputPath, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed with HTTP ${res.statusCode}: ${url}`));
        return;
      }

      fs.ensureDirSync(path.dirname(outputPath));
      const tmpPath = `${outputPath}.download`;
      const file = fs.createWriteStream(tmpPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.move(tmpPath, outputPath, { overwrite: true })
            .then(() => resolve())
            .catch(reject);
        });
      });
      file.on("error", async (err) => {
        await fs.remove(tmpPath);
        reject(err);
      });
    });
    req.setTimeout(120000, () => {
      req.destroy(new Error(`Timed out downloading ${url}`));
    });
    req.on("error", reject);
  });
}

export function defaultPiperModelDir(): string {
  return path.join(process.env.DATA_DIR_PATH || path.join(process.cwd(), "data"), "models", "piper");
}

export function defaultPiperModelPath(): string {
  return path.join(defaultPiperModelDir(), `${PIPER_ARABIC_MODEL.model}.onnx`);
}

export function defaultPiperConfigPath(): string {
  return path.join(defaultPiperModelDir(), `${PIPER_ARABIC_MODEL.model}.onnx.json`);
}

export async function ensurePiperArabicModel(): Promise<{
  modelPath: string;
  configPath: string;
  downloaded: boolean;
}> {
  const modelPath = process.env.PIPER_AR_MODEL_PATH || defaultPiperModelPath();
  const configPath = process.env.PIPER_AR_MODEL_CONFIG_PATH || defaultPiperConfigPath();
  const dirPath = path.dirname(modelPath);
  const freeBytes = availableBytes(dirPath);
  const requiredBytes = PIPER_ARABIC_MODEL.modelSizeBytes + 15 * 1024 * 1024;

  if (freeBytes !== null && freeBytes < requiredBytes) {
    throw new Error(
      `Insufficient disk space for Piper Arabic model. Required ${requiredBytes} bytes, available ${freeBytes} bytes.`,
    );
  }

  let downloaded = false;
  if (await fs.pathExists(modelPath)) {
    const hash = await sha256File(modelPath);
    if (hash !== PIPER_ARABIC_MODEL.modelSha256) {
      throw new Error(`Piper Arabic model checksum mismatch at ${modelPath}.`);
    }
  } else {
    await downloadFile(PIPER_ARABIC_MODEL.modelUrl, modelPath);
    const hash = await sha256File(modelPath);
    if (hash !== PIPER_ARABIC_MODEL.modelSha256) {
      await fs.remove(modelPath);
      throw new Error("Downloaded Piper Arabic model failed checksum validation.");
    }
    downloaded = true;
  }

  if (await fs.pathExists(configPath)) {
    const hash = await sha256File(configPath);
    if (hash !== PIPER_ARABIC_MODEL.configSha256) {
      throw new Error(`Piper Arabic config checksum mismatch at ${configPath}.`);
    }
  } else {
    await downloadFile(PIPER_ARABIC_MODEL.configUrl, configPath);
    const hash = await sha256File(configPath);
    if (hash !== PIPER_ARABIC_MODEL.configSha256) {
      await fs.remove(configPath);
      throw new Error("Downloaded Piper Arabic config failed checksum validation.");
    }
    downloaded = true;
  }

  return { modelPath, configPath, downloaded };
}
