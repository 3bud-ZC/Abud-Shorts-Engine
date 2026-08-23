import { V2Database } from "../db";
import { Config } from "../../../config";
import { logger } from "../../../logger";

export interface AnalyticsOverview {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  jobSuccessRatePercent: number;
  totalPublications: number;
  publishedPublications: number;
  failedPublications: number;
  publicationSuccessRatePercent: number;
  platformBreakdown: Record<string, { total: number; published: number; failed: number }>;
  averageDurationSeconds: number;
}

export class AnalyticsService {
  constructor(
    private db: V2Database,
    private config: Config,
  ) {}

  public async getOverview(): Promise<AnalyticsOverview> {
    if (!this.db.enabled) {
      return {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        jobSuccessRatePercent: 100,
        totalPublications: 0,
        publishedPublications: 0,
        failedPublications: 0,
        publicationSuccessRatePercent: 100,
        platformBreakdown: {},
        averageDurationSeconds: 20,
      };
    }

    try {
      // 1. Jobs stats
      const jobRows = await this.db.query<{ status: string; count: string }>(
        `SELECT status, count(*) as count FROM jobs GROUP BY status`,
      );
      let totalJobs = 0;
      let completedJobs = 0;
      let failedJobs = 0;
      for (const r of jobRows) {
        const c = parseInt(r.count, 10);
        totalJobs += c;
        if (["ready", "completed"].includes(r.status)) completedJobs += c;
        if (r.status === "failed") failedJobs += c;
      }
      const jobSuccessRatePercent = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 100;

      // 2. Publications stats
      const pubRows = await this.db.query<{ platform: string; status: string; count: string }>(
        `SELECT platform, status, count(*) as count FROM publications GROUP BY platform, status`,
      );
      let totalPublications = 0;
      let publishedPublications = 0;
      let failedPublications = 0;
      const platformBreakdown: Record<string, { total: number; published: number; failed: number }> = {};

      for (const r of pubRows) {
        const c = parseInt(r.count, 10);
        totalPublications += c;
        if (!platformBreakdown[r.platform]) {
          platformBreakdown[r.platform] = { total: 0, published: 0, failed: 0 };
        }
        platformBreakdown[r.platform].total += c;
        if (r.status === "published") {
          publishedPublications += c;
          platformBreakdown[r.platform].published += c;
        }
        if (r.status === "failed") {
          failedPublications += c;
          platformBreakdown[r.platform].failed += c;
        }
      }
      const publicationSuccessRatePercent =
        totalPublications > 0 ? Math.round((publishedPublications / totalPublications) * 100) : 100;

      return {
        totalJobs,
        completedJobs,
        failedJobs,
        jobSuccessRatePercent,
        totalPublications,
        publishedPublications,
        failedPublications,
        publicationSuccessRatePercent,
        platformBreakdown,
        averageDurationSeconds: 20,
      };
    } catch (error) {
      logger.error({ error }, "Error computing analytics overview");
      return {
        totalJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        jobSuccessRatePercent: 100,
        totalPublications: 0,
        publishedPublications: 0,
        failedPublications: 0,
        publicationSuccessRatePercent: 100,
        platformBreakdown: {},
        averageDurationSeconds: 20,
      };
    }
  }
}
