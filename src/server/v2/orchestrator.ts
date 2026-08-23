import axios from "axios";
import { Config } from "../../config";
import { JobService } from "./jobs";
import type { JobRecord } from "./types";

export class N8nOrchestrator {
  constructor(
    private config: Config,
    private jobs: JobService,
  ) {}

  public async enqueue(job: JobRecord): Promise<void> {
    const url = `${this.config.n8nBaseUrl}${this.config.n8nWebhookPath}`;
    try {
      await axios.post(
        url,
        {
          jobId: job.id,
          input: job.input,
          appBaseUrl: this.config.appInternalBaseUrl,
          renderWorkerBaseUrl: this.config.renderWorkerBaseUrl,
        },
        {
          timeout: 10000,
          headers: {
            "x-internal-token": this.config.internalServiceToken,
          },
        },
      );
    } catch (error) {
      const message = "n8n orchestration is unavailable.";
      await this.jobs.updateJob(job.id, "failed", job.progress, "Orchestration failed", message, {
        error: message,
        technicalError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
