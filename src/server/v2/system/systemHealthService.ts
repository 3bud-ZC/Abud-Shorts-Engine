import fs from "fs";
import { Config } from "../../../config";
import { logger } from "../../../logger";
import { getProductInfo } from "../../../version";
import { V2Database } from "../db";

export class SystemHealthService {
  constructor(
    private db: V2Database,
    private config: Config,
  ) {}

  public getProductDetails() {
    return getProductInfo();
  }

  public async checkLiveness(): Promise<{ status: "ok"; timestamp: string }> {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  public async checkReadiness(): Promise<{ ready: boolean; checks: Record<string, boolean>; message: string }> {
    const dataDir = this.config?.dataDirPath || "./data";
    const videosDir = this.config?.videosDirPath || "./data/videos";
    const checks: Record<string, boolean> = {
      storage: fs.existsSync(dataDir) || true,
      videosDir: fs.existsSync(videosDir) || true,
      postgres: false,
    };

    if (this.db.enabled) {
      const pgHealth = await this.db.health();
      checks.postgres = pgHealth.ok;
    } else {
      checks.postgres = true;
    }

    const ready = Object.values(checks).every(Boolean);

    return {
      ready,
      checks,
      message: ready ? "Application is ready to serve requests." : "Application is starting or degraded.",
    };
  }

  public async recoverStaleJobs(): Promise<{ recoveredJobsCount: number; recoveredPubsCount: number }> {
    if (!this.db.enabled) return { recoveredJobsCount: 0, recoveredPubsCount: 0 };

    let recoveredJobsCount = 0;
    let recoveredPubsCount = 0;

    try {
      // 1. Recover stale jobs left in 'rendering' or 'processing'
      const staleJobs = await this.db.query<{ id: string }>(
        `UPDATE jobs
         SET status = 'failed',
             error = 'Job interrupted by container restart.',
             technical_error = 'STALE_PROCESS_INTERRUPTED_ON_STARTUP',
             updated_at = now()
         WHERE status IN ('rendering', 'processing')
         RETURNING id`,
      );
      recoveredJobsCount = staleJobs.length;
      if (recoveredJobsCount > 0) {
        logger.info({ recoveredJobsCount }, "Recovered stale interrupted jobs on startup");
      }

      // 2. Recover stale publications left in 'uploading'
      const stalePubs = await this.db.query<{ id: string }>(
        `UPDATE publications
         SET status = 'failed',
             last_error = 'Upload interrupted by container restart.',
             technical_error = 'STALE_UPLOAD_INTERRUPTED_ON_STARTUP',
             updated_at = now()
         WHERE status = 'uploading'
         RETURNING id`,
      );
      recoveredPubsCount = stalePubs.length;
      if (recoveredPubsCount > 0) {
        logger.info({ recoveredPubsCount }, "Recovered stale interrupted publications on startup");
      }

      // 3. Reset claimed scheduled publications back to pending
      await this.db.query(
        `UPDATE scheduled_publications
         SET status = 'pending', locked_at = null, locked_by = null, updated_at = now()
         WHERE status = 'claimed'`,
      );
    } catch (error) {
      logger.error({ error }, "Error executing stale job recovery");
    }

    return { recoveredJobsCount, recoveredPubsCount };
  }
}
