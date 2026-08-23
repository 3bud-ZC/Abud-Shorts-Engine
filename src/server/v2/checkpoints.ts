import crypto from "crypto";
import type { V2Database } from "./db";

export const checkpointStages = [
  "planning",
  "media",
  "voice",
  "captions",
  "render",
  "mastering",
  "validation",
] as const;

export type CheckpointStage = (typeof checkpointStages)[number];

const downstreamInvalidation: Record<CheckpointStage, CheckpointStage[]> = {
  planning: ["planning", "media", "voice", "captions", "render", "mastering", "validation"],
  media: ["media", "render", "validation"],
  voice: ["voice", "captions", "render", "mastering", "validation"],
  captions: ["captions", "render", "validation"],
  render: ["render", "mastering", "validation"],
  mastering: ["mastering", "validation"],
  validation: ["validation"],
};

export type StageCheckpoint = {
  status: "pending" | "running" | "completed" | "failed" | "invalidated";
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  provider?: string;
  artifacts?: Record<string, unknown>;
  inputHash?: string;
  error?: string;
};

export type JobCheckpointState = Partial<Record<CheckpointStage, StageCheckpoint>> & {
  schemaVersion?: "2.1-checkpoints";
  lastRetryStage?: CheckpointStage;
  updatedAt?: string;
};

export function hashCheckpointInput(input: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex");
}

export function normalizeCheckpoint(raw: unknown): JobCheckpointState {
  const state = raw && typeof raw === "object" ? { ...(raw as any) } : {};
  state.schemaVersion = "2.1-checkpoints";
  return state;
}

export function beginStage(
  raw: unknown,
  stage: CheckpointStage,
  input: unknown,
  provider?: string,
): JobCheckpointState {
  const state = normalizeCheckpoint(raw);
  const prior = state[stage];
  state[stage] = {
    status: "running",
    startedAt: new Date().toISOString(),
    attempt: (prior?.attempt || 0) + 1,
    provider,
    inputHash: hashCheckpointInput(input),
  };
  state.updatedAt = new Date().toISOString();
  return state;
}

export function completeStage(
  raw: unknown,
  stage: CheckpointStage,
  artifacts: Record<string, unknown> = {},
  provider?: string,
): JobCheckpointState {
  const state = normalizeCheckpoint(raw);
  const prior = state[stage];
  state[stage] = {
    status: "completed",
    startedAt: prior?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    attempt: prior?.attempt || 1,
    provider: provider || prior?.provider,
    inputHash: prior?.inputHash,
    artifacts,
  };
  state.updatedAt = new Date().toISOString();
  return state;
}

export function failStage(raw: unknown, stage: CheckpointStage, error: string): JobCheckpointState {
  const state = normalizeCheckpoint(raw);
  const prior = state[stage];
  state[stage] = {
    status: "failed",
    startedAt: prior?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    attempt: prior?.attempt || 1,
    provider: prior?.provider,
    inputHash: prior?.inputHash,
    artifacts: prior?.artifacts,
    error,
  };
  state.updatedAt = new Date().toISOString();
  return state;
}

export function invalidateFromStage(raw: unknown, stage: CheckpointStage): JobCheckpointState {
  const state = normalizeCheckpoint(raw);
  for (const item of downstreamInvalidation[stage]) {
    const prior = state[item];
    state[item] = {
      status: "invalidated",
      startedAt: prior?.startedAt,
      completedAt: new Date().toISOString(),
      attempt: prior?.attempt || 0,
      provider: prior?.provider,
      inputHash: prior?.inputHash,
      artifacts: prior?.artifacts,
      error: `Invalidated by retry of ${stage}`,
    };
  }
  state.lastRetryStage = stage;
  state.updatedAt = new Date().toISOString();
  return state;
}

export function reusableStages(raw: unknown): CheckpointStage[] {
  const state = normalizeCheckpoint(raw);
  return checkpointStages.filter((stage) => state[stage]?.status === "completed");
}

export class CheckpointService {
  constructor(private db: V2Database) {}

  public async get(jobId: string): Promise<JobCheckpointState> {
    const rows = await this.db.query<{ checkpoint: unknown }>(
      "SELECT checkpoint FROM jobs WHERE id = $1",
      [jobId],
    );
    return normalizeCheckpoint(rows[0]?.checkpoint);
  }

  public async update(jobId: string, checkpoint: JobCheckpointState): Promise<JobCheckpointState> {
    const rows = await this.db.query<{ checkpoint: unknown }>(
      `UPDATE jobs SET checkpoint = $2, updated_at = now() WHERE id = $1 RETURNING checkpoint`,
      [jobId, JSON.stringify(checkpoint)],
    );
    return normalizeCheckpoint(rows[0]?.checkpoint || checkpoint);
  }

  public async retryStage(jobId: string, stage: CheckpointStage): Promise<JobCheckpointState> {
    const current = await this.get(jobId);
    const next = invalidateFromStage(current, stage);
    return this.update(jobId, next);
  }
}
