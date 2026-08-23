import axios from "axios";
import cuid from "cuid";
import { Config } from "../../config";
import { JobService } from "./jobs";
import type { JobRecord } from "./types";
import { buildN8nContractPayload, n8nContractSchema } from "./orchestration/contract";

export class N8nOrchestrator {
  constructor(
    private config: Config,
    private jobs: JobService,
  ) {}

  public async enqueue(job: JobRecord): Promise<void> {
    const url = `${this.config.n8nBaseUrl}${this.config.n8nWebhookPath}`;
    const payload = buildN8nContractPayload({
      jobId: job.id,
      requestId: cuid(),
      appBaseUrl: this.config.appInternalBaseUrl,
      renderWorkerBaseUrl: this.config.renderWorkerBaseUrl,
      jobInput: job.input,
    });
    n8nContractSchema.parse(payload);
    try {
      await axios.post(
        url,
        payload,
        {
          timeout: this.config.webhookTimeoutMs,
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
