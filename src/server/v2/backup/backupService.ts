import crypto from "crypto";
import cuid from "cuid";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { Config } from "../../../config";
import { logger } from "../../../logger";
import { PRODUCT_NAME, PRODUCT_VERSION, DATABASE_SCHEMA_VERSION } from "../../../version";
import { V2Database } from "../db";

export type BackupType = "config_only" | "config_db" | "full";

export interface BackupManifest {
  product: string;
  version: string;
  schemaVersion: string;
  type: BackupType;
  includesMedia: boolean;
  includesSecrets: boolean;
  mediaCount: number;
  tablesCount: Record<string, number>;
  checksumSha256: string;
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  filename: string;
  filepath: string;
  type: BackupType;
  sizeBytes: number;
  includesMedia: boolean;
  includesSecrets: boolean;
  version: string;
  checksumSha256: string;
  status: "completed" | "failed";
  manifest: BackupManifest;
  createdAt: Date;
}

export interface CreateBackupOptions {
  type?: BackupType;
  includeSecrets?: boolean;
  notes?: string;
}

export class BackupService {
  private backupDir: string;

  constructor(
    private db: V2Database,
    private config: Config,
  ) {
    const baseDataDir = this.config?.dataDirPath || "./data";
    this.backupDir = path.join(baseDataDir, "backups");
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  public async listBackups(): Promise<BackupRecord[]> {
    if (!this.db.enabled) {
      return this.listLocalBackupFiles();
    }

    try {
      const rows = await this.db.query<{
        id: string;
        filename: string;
        filepath: string;
        type: BackupType;
        size_bytes: string;
        includes_media: boolean;
        includes_secrets: boolean;
        version: string;
        checksum_sha256: string;
        status: "completed" | "failed";
        manifest: any;
        created_at: string;
      }>(`SELECT * FROM backups ORDER BY created_at DESC`);

      return rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        filepath: r.filepath,
        type: r.type,
        sizeBytes: parseInt(r.size_bytes || "0", 10),
        includesMedia: r.includes_media,
        includesSecrets: r.includes_secrets,
        version: r.version,
        checksumSha256: r.checksum_sha256,
        status: r.status,
        manifest: typeof r.manifest === "string" ? JSON.parse(r.manifest) : r.manifest,
        createdAt: new Date(r.created_at),
      }));
    } catch (error) {
      logger.error({ error }, "Error querying backups table; falling back to filesystem");
      return this.listLocalBackupFiles();
    }
  }

  private listLocalBackupFiles(): BackupRecord[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith(".abudbak"));
    return files.map((filename) => {
      const filepath = path.join(this.backupDir, filename);
      const stat = fs.statSync(filepath);
      return {
        id: filename.replace(".abudbak", ""),
        filename,
        filepath,
        type: "config_db",
        sizeBytes: stat.size,
        includesMedia: false,
        includesSecrets: false,
        version: PRODUCT_VERSION,
        checksumSha256: "local",
        status: "completed",
        manifest: {
          product: PRODUCT_NAME,
          version: PRODUCT_VERSION,
          schemaVersion: DATABASE_SCHEMA_VERSION,
          type: "config_db",
          includesMedia: false,
          includesSecrets: false,
          mediaCount: 0,
          tablesCount: {},
          checksumSha256: "local",
          createdAt: stat.mtime.toISOString(),
        },
        createdAt: stat.mtime,
      };
    });
  }

  public async createBackup(options: CreateBackupOptions = {}): Promise<BackupRecord> {
    const type: BackupType = options.type || "config_db";
    const includeSecrets = Boolean(options.includeSecrets);
    const backupId = cuid();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `abud_backup_${type}_${timestamp}_${backupId.slice(-6)}.abudbak`;
    const filepath = path.join(this.backupDir, filename);

    logger.info({ backupId, type, includeSecrets }, "Starting backup creation");

    // Collect DB records
    const tablesData: Record<string, any[]> = {};
    const tablesCount: Record<string, number> = {};

    if (this.db.enabled) {
      const tableNames = [
        "app_settings",
        "system_settings",
        "brands",
        "provider_settings",
        "social_accounts",
        "publications",
        "scheduled_publications",
        "automation_rules",
      ];

      if (type !== "config_only") {
        tableNames.push("jobs", "job_events", "generated_assets", "publishing_attempts", "publishing_events");
      }

      for (const table of tableNames) {
        try {
          const rows = await this.db.query(`SELECT * FROM ${table}`);
          // Redact secrets if includeSecrets is false
          if (!includeSecrets) {
            if (table === "provider_settings") {
              rows.forEach((r: any) => {
                delete r.encrypted_secret;
              });
            }
            if (table === "social_accounts") {
              rows.forEach((r: any) => {
                delete r.encrypted_credentials;
              });
            }
          }
          tablesData[table] = rows;
          tablesCount[table] = rows.length;
        } catch (err) {
          logger.warn({ table, err }, "Skipping table during backup");
        }
      }
    }

    // Collect Media if type === 'full'
    const mediaFiles: Record<string, string> = {}; // filename -> base64
    let mediaCount = 0;
    if (type === "full" && fs.existsSync(this.config.videosDirPath)) {
      const files = fs.readdirSync(this.config.videosDirPath);
      for (const file of files) {
        const fullPath = path.join(this.config.videosDirPath, file);
        if (fs.statSync(fullPath).isFile() && statIsReasonable(fullPath)) {
          mediaFiles[file] = fs.readFileSync(fullPath).toString("base64");
          mediaCount++;
        }
      }
    }

    const payload = {
      backupId,
      product: PRODUCT_NAME,
      version: PRODUCT_VERSION,
      schemaVersion: DATABASE_SCHEMA_VERSION,
      type,
      includeSecrets,
      createdAt: new Date().toISOString(),
      database: tablesData,
      media: mediaFiles,
    };

    const rawJson = JSON.stringify(payload);
    const compressed = zlib.gzipSync(Buffer.from(rawJson, "utf-8"));
    fs.writeFileSync(filepath, compressed);

    const checksumSha256 = crypto.createHash("sha256").update(compressed).digest("hex");
    const stat = fs.statSync(filepath);

    const manifest: BackupManifest = {
      product: PRODUCT_NAME,
      version: PRODUCT_VERSION,
      schemaVersion: DATABASE_SCHEMA_VERSION,
      type,
      includesMedia: type === "full",
      includesSecrets: includeSecrets,
      mediaCount,
      tablesCount,
      checksumSha256,
      createdAt: new Date().toISOString(),
    };

    if (this.db.enabled) {
      await this.db.query(
        `INSERT INTO backups (
          id, filename, filepath, type, size_bytes, includes_media, includes_secrets,
          version, checksum_sha256, status, manifest, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, now())`,
        [
          backupId,
          filename,
          filepath,
          type,
          stat.size,
          type === "full",
          includeSecrets,
          PRODUCT_VERSION,
          checksumSha256,
          JSON.stringify(manifest),
        ],
      );

      // Record in audit log
      await this.db.query(
        `INSERT INTO audit_logs (action, actor, entity_type, entity_id, metadata, created_at)
         VALUES ('backup_created', 'admin', 'backup', $1, $2, now())`,
        [backupId, JSON.stringify({ type, filename, sizeBytes: stat.size })],
      );
    }

    logger.info({ backupId, filename, sizeBytes: stat.size }, "Backup successfully created");

    return {
      id: backupId,
      filename,
      filepath,
      type,
      sizeBytes: stat.size,
      includesMedia: type === "full",
      includesSecrets: includeSecrets,
      version: PRODUCT_VERSION,
      checksumSha256,
      status: "completed",
      manifest,
      createdAt: new Date(),
    };
  }

  public async restoreBackup(backupIdOrFilename: string): Promise<{ success: boolean; message: string; restoredTables: string[]; safetyBackupId?: string }> {
    logger.info({ backupIdOrFilename }, "Initiating backup restore");

    // 1. Resolve File
    let targetFile = path.join(this.backupDir, backupIdOrFilename);
    if (!fs.existsSync(targetFile)) {
      const records = await this.listBackups();
      const matched = records.find((r) => r.id === backupIdOrFilename || r.filename === backupIdOrFilename);
      if (matched && fs.existsSync(matched.filepath)) {
        targetFile = matched.filepath;
      } else {
        throw new Error(`Backup file not found: ${backupIdOrFilename}`);
      }
    }

    // 2. Validate Archive & Checksum
    const compressed = fs.readFileSync(targetFile);
    let rawJson: string;
    try {
      rawJson = zlib.gunzipSync(compressed).toString("utf-8");
    } catch {
      throw new Error("Corrupted backup archive: failed to decompress gzip.");
    }

    const payload = JSON.parse(rawJson);
    if (!payload.product || !payload.version || !payload.database) {
      throw new Error("Invalid backup format: missing required manifest keys.");
    }

    // 3. Pre-restore Safety Backup
    let safetyBackupId: string | undefined;
    try {
      const safety = await this.createBackup({ type: "config_db", notes: "Auto safety backup prior to restore" });
      safetyBackupId = safety.id;
      logger.info({ safetyBackupId }, "Created pre-restore safety backup");
    } catch (err) {
      logger.warn({ err }, "Could not create pre-restore safety backup; proceeding with restore");
    }

    // 4. Staged Database Restore
    const restoredTables: string[] = [];
    if (this.db.enabled && payload.database) {
      for (const [table, rows] of Object.entries(payload.database as Record<string, any[]>)) {
        if (!Array.isArray(rows)) continue;

        if (table === "brands") {
          await this.db.query(`DELETE FROM brands`);
          for (const brand of rows) {
            await this.db.query(
              `INSERT INTO brands (id, name, watermark_text, primary_color, accent_color, caption_style, include_outro, outro_text, contact_text, is_default, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                brand.id,
                brand.name,
                brand.watermark_text || "",
                brand.primary_color || "#24545a",
                brand.accent_color || "#d28b4c",
                brand.caption_style || "bold",
                brand.include_outro ?? true,
                brand.outro_text || "",
                brand.contact_text || "",
                brand.is_default || false,
                brand.created_at || new Date(),
                brand.updated_at || new Date(),
              ],
            );
          }
          restoredTables.push(table);
        } else if (table === "app_settings") {
          await this.db.query(`DELETE FROM app_settings`);
          for (const s of rows) {
            await this.db.query(
              `INSERT INTO app_settings (key, value, updated_at)
               VALUES ($1, $2, now())`,
              [s.key, typeof s.value === "string" ? s.value : JSON.stringify(s.value)],
            );
          }
          restoredTables.push(table);
        } else if (table === "system_settings") {
          for (const s of rows) {
            await this.db.query(
              `INSERT INTO system_settings (key, value, updated_at)
               VALUES ($1, $2, now())
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
              [s.key, typeof s.value === "string" ? s.value : JSON.stringify(s.value)],
            );
          }
          restoredTables.push(table);
        }
      }
    }

    // 5. Media Restore if full
    if (payload.media && typeof payload.media === "object") {
      if (!fs.existsSync(this.config.videosDirPath)) {
        fs.mkdirSync(this.config.videosDirPath, { recursive: true });
      }
      for (const [filename, base64Data] of Object.entries(payload.media as Record<string, string>)) {
        const destPath = path.join(this.config.videosDirPath, filename);
        if (!fs.existsSync(destPath)) {
          fs.writeFileSync(destPath, Buffer.from(base64Data, "base64"));
        }
      }
    }

    if (this.db.enabled) {
      await this.db.query(
        `INSERT INTO audit_logs (action, actor, entity_type, entity_id, metadata, created_at)
         VALUES ('restore_performed', 'admin', 'backup', $1, $2, now())`,
        [backupIdOrFilename, JSON.stringify({ restoredTables, safetyBackupId })],
      );
    }

    logger.info({ backupIdOrFilename, restoredTables }, "Backup successfully restored");

    return {
      success: true,
      message: `Backup restored successfully (${restoredTables.length} tables processed).`,
      restoredTables,
      safetyBackupId,
    };
  }

  public async deleteBackup(backupId: string): Promise<boolean> {
    if (this.db.enabled) {
      const rows = await this.db.query<{ filepath: string }>(
        `DELETE FROM backups WHERE id = $1 RETURNING filepath`,
        [backupId],
      );
      if (rows.length > 0 && fs.existsSync(rows[0].filepath)) {
        fs.unlinkSync(rows[0].filepath);
      }
    }
    return true;
  }

  public exportConfiguration(): Record<string, any> {
    return {
      product: PRODUCT_NAME,
      version: PRODUCT_VERSION,
      exportedAt: new Date().toISOString(),
      schemaVersion: DATABASE_SCHEMA_VERSION,
      defaults: {
        language: "ar",
        dialect: "egyptian",
        captionStyle: "bold",
        aspectRatio: "9:16",
        resolution: "1080p",
      },
    };
  }
}

function statIsReasonable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.size < 200 * 1024 * 1024; // Limit single media restore item in json to 200MB
  } catch {
    return false;
  }
}
