import { EventEmitter } from "events";
import cuid from "cuid";
import type { Response as ExpressResponse } from "express";
import { V2Database } from "./db";
import {
  type CreateVideoJobInput,
  type JobEventRecord,
  type JobRecord,
  type JobStatus,
  terminalJobStatuses,
} from "./types";
import { convertTemplateToProductionSpec } from "./templateToSpec";
import type { ProductionSpec } from "../../types/productionSpec";
import { estimateProductionCost } from "./cost-estimator";

const allowedTransitions: Record<JobStatus, JobStatus[]> = {
  queued: ["preparing", "canceled", "failed"],
  preparing: [
    "generating_content",
    "searching_assets",
    "generating_voice",
    "failed",
    "canceled",
  ],
  generating_content: ["searching_assets", "generating_voice", "failed", "canceled"],
  searching_assets: ["generating_voice", "generating_captions", "rendering", "failed", "canceled"],
  generating_voice: ["generating_captions", "searching_assets", "failed", "canceled"],
  generating_captions: ["searching_assets", "rendering", "failed", "canceled"],
  rendering: ["finalizing", "failed", "canceled"],
  finalizing: ["ready", "failed", "canceled"],
  ready: [],
  failed: [],
  canceled: [],
};

type DbJobRow = {
  id: string;
  type: "video";
  status: JobStatus;
  progress: number;
  current_stage: string;
  title?: string;
  creation_mode?: "prompt" | "template";
  original_prompt?: string;
  production_spec?: ProductionSpec;
  ai_provider?: string;
  ai_model?: string;
  visual_mode?: string;
  visual_providers_used?: string[];
  voice_provider?: string;
  quality_profile?: string;
  resolution?: string;
  aspect_ratio?: string;
  language?: string;
  dialect?: string;
  cost_estimate?: Record<string, unknown>;
  template_id?: string;
  brand_name?: string;
  input: any;
  output?: Record<string, unknown>;
  error?: string;
  technical_error?: string;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  updated_at: Date;
};

type DbJobEventRow = {
  id: string;
  job_id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  message: string;
  technical_message?: string;
  created_at: Date;
};

export function isValidJobTransition(current: JobStatus, next: JobStatus): boolean {
  if (current === next) return true;
  return allowedTransitions[current]?.includes(next) ?? false;
}

export class JobService {
  private events = new EventEmitter();

  constructor(private db: V2Database) {
    this.events.setMaxListeners(200);
  }

  public async createVideoJob(input: CreateVideoJobInput | any): Promise<JobRecord> {
    const id = cuid();

    let resolvedSpec: ProductionSpec | undefined;
    let creationMode: "prompt" | "template" = input.creationMode || "template";
    let originalPrompt: string | undefined = input.prompt || input.userPrompt;
    let templateId = input.businessTemplateId;
    let brandName = input.config?.brandKit?.brandName || input.brandName;

    if (input.productionSpec) {
      resolvedSpec = input.productionSpec;
      creationMode = resolvedSpec?.creationMode || "prompt";
      originalPrompt = resolvedSpec?.userPrompt || originalPrompt;
      templateId = resolvedSpec?.templateId || templateId;
      brandName = resolvedSpec?.brandKit?.brandName || brandName;
    } else if (input.businessTemplateId) {
      creationMode = "template";
      resolvedSpec = convertTemplateToProductionSpec({
        templateId: input.businessTemplateId,
        templateData: input.businessTemplateData,
        config: input.config,
        title: input.title,
        id,
      });
      brandName = resolvedSpec?.brandKit?.brandName || brandName;
    }

    const title =
      input.title ||
      resolvedSpec?.title ||
      brandName ||
      templateId?.replace(/_/g, " ") ||
      "Untitled Video Job";

    const aiProvider = resolvedSpec?.metadata?.planner
      ? String(resolvedSpec.metadata.planner)
      : creationMode === "prompt"
        ? "local_ai"
        : undefined;
    const visualMode = resolvedSpec?.visualMode || "stock";
    const voiceProvider = resolvedSpec?.voiceProvider || "kokoro";
    const qualityProfile = resolvedSpec?.quality || "standard";
    const resolution = resolvedSpec?.resolution || "1080p";
    const aspectRatio = resolvedSpec?.aspectRatio || "9:16";
    const language = resolvedSpec?.language || "ar";
    const dialect = resolvedSpec?.dialect || "egyptian";
    const costEstimate = resolvedSpec?.costEstimate || (resolvedSpec ? estimateProductionCost(resolvedSpec) : undefined);

    const rows = await this.db.query<DbJobRow>(
      `INSERT INTO jobs (
        id, type, status, progress, current_stage, title, template_id, brand_name, input,
        creation_mode, original_prompt, production_spec, ai_provider, visual_mode,
        voice_provider, quality_profile, resolution, aspect_ratio, language, dialect, cost_estimate
      ) VALUES ($1, 'video', 'queued', 0, 'Queued', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        id,
        title,
        templateId || null,
        brandName || null,
        input,
        creationMode,
        originalPrompt || null,
        resolvedSpec ? JSON.stringify(resolvedSpec) : null,
        aiProvider || null,
        visualMode,
        voiceProvider,
        qualityProfile,
        resolution,
        aspectRatio,
        language,
        dialect,
        costEstimate ? JSON.stringify(costEstimate) : null,
      ],
    );

    await this.addEvent(id, "queued", 0, "Queued", "Video job queued.");
    return this.mapJob(rows[0]);
  }

  public async listJobs(status?: string): Promise<JobRecord[]> {
    const rows = status
      ? await this.db.query<DbJobRow>(
          "SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC LIMIT 100",
          [status],
        )
      : await this.db.query<DbJobRow>(
          "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100",
        );
    return rows.map((row) => this.mapJob(row));
  }

  public async getJob(id: string): Promise<JobRecord | null> {
    const rows = await this.db.query<DbJobRow>("SELECT * FROM jobs WHERE id = $1", [
      id,
    ]);
    return rows[0] ? this.mapJob(rows[0]) : null;
  }

  public async getEvents(id: string): Promise<JobEventRecord[]> {
    const rows = await this.db.query<DbJobEventRow>(
      "SELECT * FROM job_events WHERE job_id = $1 ORDER BY id ASC",
      [id],
    );
    return rows.map((row) => this.mapEvent(row));
  }

  public async updateJob(
    id: string,
    nextStatus: JobStatus,
    progress: number,
    currentStage: string,
    message: string,
    options: {
      output?: Record<string, unknown>;
      error?: string;
      technicalError?: string;
      technicalMessage?: string;
      visualProvidersUsed?: string[];
    } = {},
  ): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (!isValidJobTransition(current.status, nextStatus)) {
      throw new Error(`Invalid job transition ${current.status} -> ${nextStatus}.`);
    }

    const startedAt =
      !current.startedAt && nextStatus !== "queued" ? "now()" : "started_at";
    const completedAt = terminalJobStatuses.includes(nextStatus as never)
      ? "now()"
      : "completed_at";

    const rows = await this.db.query<DbJobRow>(
      `UPDATE jobs
       SET status = $2,
           progress = $3,
           current_stage = $4,
           output = COALESCE($5, output),
           error = COALESCE($6, error),
           technical_error = COALESCE($7, technical_error),
           visual_providers_used = COALESCE($8, visual_providers_used),
           started_at = ${startedAt},
           completed_at = ${completedAt},
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        nextStatus,
        Math.round(progress),
        currentStage,
        options.output || null,
        options.error || null,
        options.technicalError || null,
        options.visualProvidersUsed || null,
      ],
    );

    await this.addEvent(
      id,
      nextStatus,
      Math.round(progress),
      currentStage,
      message,
      options.technicalMessage,
    );
    return this.mapJob(rows[0]);
  }

  public async completeJob(
    id: string,
    videoId: string,
    output: Record<string, unknown> = {},
  ): Promise<JobRecord> {
    const job = await this.updateJob(id, "ready", 100, "Ready", "Video is ready.", {
      output: {
        ...output,
        videoId,
        previewUrl: `/api/short-video/${videoId}`,
        downloadUrl: `/api/videos/${videoId}/download`,
      },
    });

    await this.db.query(
      `INSERT INTO generated_assets (id, job_id, video_id, kind, path, metadata)
       VALUES ($1, $2, $3, 'video', $4, $5)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [
        videoId,
        id,
        videoId,
        String(output.path || ""),
        { ...output, videoId },
      ],
    );
    return job;
  }

  public async cancelJob(id: string): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (terminalJobStatuses.includes(current.status as never)) {
      throw new Error("Completed jobs cannot be canceled.");
    }
    return this.updateJob(
      id,
      "canceled",
      current.progress,
      "Canceled",
      "Job canceled before completion.",
    );
  }

  public async retryJob(id: string): Promise<JobRecord> {
    const current = await this.getJob(id);
    if (!current) {
      throw new Error("Job not found.");
    }
    if (current.status !== "failed" && current.status !== "canceled") {
      throw new Error("Only failed or canceled jobs can be retried.");
    }
    return this.createVideoJob({
      ...current.input,
      title: current.title ? `${current.title} retry` : undefined,
    });
  }

  public subscribe(jobId: string, res: ExpressResponse): () => void {
    const listener = (event: JobEventRecord) => {
      res.write(`event: job-event\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    this.events.on(jobId, listener);
    return () => this.events.off(jobId, listener);
  }

  private async addEvent(
    jobId: string,
    status: JobStatus,
    progress: number,
    stage: string,
    message: string,
    technicalMessage?: string,
  ): Promise<void> {
    const rows = await this.db.query<DbJobEventRow>(
      `INSERT INTO job_events (job_id, status, progress, stage, message, technical_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [jobId, status, progress, stage, message, technicalMessage || null],
    );
    this.events.emit(jobId, this.mapEvent(rows[0]));
  }

  private mapJob(row: DbJobRow): JobRecord {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      currentStage: row.current_stage,
      title: row.title,
      creationMode: row.creation_mode || "template",
      originalPrompt: row.original_prompt,
      productionSpec: row.production_spec,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      visualMode: row.visual_mode,
      visualProvidersUsed: row.visual_providers_used,
      voiceProvider: row.voice_provider,
      qualityProfile: row.quality_profile,
      resolution: row.resolution,
      aspectRatio: row.aspect_ratio,
      language: row.language,
      dialect: row.dialect,
      costEstimate: row.cost_estimate,
      templateId: row.template_id,
      brandName: row.brand_name,
      input: row.input,
      output: row.output,
      error: row.error,
      technicalError: row.technical_error,
      createdAt: row.created_at.toISOString(),
      startedAt: row.started_at?.toISOString(),
      completedAt: row.completed_at?.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapEvent(row: DbJobEventRow): JobEventRecord {
    return {
      id: Number(row.id),
      jobId: row.job_id,
      status: row.status,
      progress: row.progress,
      stage: row.stage,
      message: row.message,
      technicalMessage: row.technical_message,
      createdAt: row.created_at.toISOString(),
    };
  }
}
