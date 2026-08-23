import { z } from "zod";

export const n8nContractSchema = z.object({
  schemaVersion: z.literal("abud.v2.internal.job.v1"),
  requestId: z.string().trim().min(8).max(160),
  jobId: z.string().trim().min(1).max(140),
  idempotencyKey: z.string().trim().min(8).max(220),
  timestamp: z.string().datetime(),
  action: z.enum(["job.start"]),
  callbackTarget: z.literal("app-internal-v1"),
  appBaseUrl: z.string().url(),
  renderWorkerBaseUrl: z.string().url(),
  input: z.record(z.unknown()),
});

export type N8nContractPayload = z.infer<typeof n8nContractSchema>;

export function buildN8nContractPayload(input: {
  jobId: string;
  requestId: string;
  appBaseUrl: string;
  renderWorkerBaseUrl: string;
  jobInput: Record<string, unknown>;
}): N8nContractPayload {
  return {
    schemaVersion: "abud.v2.internal.job.v1",
    requestId: input.requestId,
    jobId: input.jobId,
    idempotencyKey: `${input.jobId}:job.start`,
    timestamp: new Date().toISOString(),
    action: "job.start",
    callbackTarget: "app-internal-v1",
    appBaseUrl: input.appBaseUrl,
    renderWorkerBaseUrl: input.renderWorkerBaseUrl,
    input: input.jobInput,
  };
}
