import { describe, expect, it } from "vitest";
import {
  completeStage,
  invalidateFromStage,
  reusableStages,
} from "./checkpoints";
import { estimateNearDuplicateRisk, selectSmartClipWindow } from "./media-intelligence/assetScorer";
import { MediaIntelligenceService } from "./media-intelligence/mediaIntelligenceService";
import { RevisionService } from "./revisions/revisionService";
import { WorkerLeaseService } from "./workers/workerLeaseService";
import { buildN8nContractPayload, n8nContractSchema } from "./orchestration/contract";
import { WebhookService } from "./webhooks/webhookService";

class RevisionFakeDb {
  public revisions: any[] = [];

  async query(text: string, values: any[] = []) {
    if (text.includes("SELECT * FROM video_revisions WHERE project_id = $1 ORDER BY")) {
      return this.revisions
        .filter((row) => row.project_id === values[0])
        .sort((a, b) => a.revision_number - b.revision_number);
    }
    if (text.includes("SELECT MAX(revision_number)")) {
      const max = Math.max(0, ...this.revisions.filter((row) => row.project_id === values[0]).map((row) => row.revision_number));
      return [{ max: max ? String(max) : null }];
    }
    if (text.includes("UPDATE video_revisions SET is_final = false")) {
      this.revisions.filter((row) => row.project_id === values[0]).forEach((row) => { row.is_final = false; });
      return [];
    }
    if (text.includes("UPDATE video_revisions") && text.includes("RETURNING")) {
      const row = this.revisions.find((item) => item.project_id === values[0] && item.id === values[1]);
      if (!row) return [];
      row.is_final = true;
      row.updated_at = new Date();
      return [row];
    }
    if (text.includes("INSERT INTO video_revisions")) {
      const isInitial = text.includes("Initial generated video");
      const now = new Date();
      const row = isInitial
        ? {
            id: values[0],
            project_id: values[1],
            revision_number: 1,
            parent_revision_id: null,
            source_job_id: values[2],
            output_video_id: values[3],
            status: "ready",
            reason: "Initial generated video",
            change_type: "initial",
            changed_fields: {},
            is_final: true,
            created_at: now,
            updated_at: now,
          }
        : {
            id: values[0],
            project_id: values[1],
            revision_number: values[2],
            parent_revision_id: values[3],
            source_job_id: values[4],
            output_video_id: values[5],
            status: values[6],
            reason: values[7],
            change_type: values[8],
            changed_fields: JSON.parse(values[9]),
            is_final: false,
            created_at: now,
            updated_at: now,
          };
      this.revisions.push(row);
      return [row];
    }
    return [];
  }
}

class WorkerFakeDb {
  public jobs = new Map<string, any>([
    ["job_a", { id: "job_a", status: "queued" }],
  ]);
  public leases = new Map<string, any>();

  async query(text: string, values: any[] = []) {
    if (text.includes("FROM worker_leases") && text.includes("count")) {
      const active = [...this.leases.values()].filter((row) => row.status === "busy").length;
      return [{ count: String(active) }];
    }
    if (text.includes("FROM jobs WHERE status = 'queued'")) {
      const queued = [...this.jobs.values()].filter((row) => row.status === "queued").length;
      return [{ count: String(queued) }];
    }
    if (text.includes("WHERE id = $1 AND status = 'queued'")) {
      const row = this.jobs.get(values[0]);
      if (!row || row.status !== "queued") return [];
      row.status = "preparing";
      return [{ id: row.id }];
    }
    if (text.includes("INSERT INTO worker_leases")) {
      const row = {
        worker_id: values[0],
        status: values[1],
        active_job_id: values[2],
        capabilities: JSON.parse(values[3]),
        started_at: new Date(),
        last_heartbeat: new Date(),
        lease_expires_at: new Date(values[4]),
      };
      this.leases.set(row.worker_id, row);
      return [row];
    }
    if (text.includes("SELECT * FROM worker_leases")) {
      return [...this.leases.values()];
    }
    if (text.includes("avg(EXTRACT")) return [{ avg_ms: null }];
    if (text.includes("jsonb_each")) return [];
    return [];
  }
}

describe("V2.1 Phase 3 platform primitives", () => {
  it("invalidates downstream checkpoints while preserving reusable prior stages", () => {
    let state = completeStage({}, "planning", { specId: "spec_1" }, "local_ai");
    state = completeStage(state, "media", { assetIds: ["pexels_1"] }, "pexels");
    state = completeStage(state, "voice", { voiceId: "ar_JO-kareem-medium" }, "piper");

    const retry = invalidateFromStage(state, "voice");

    expect(reusableStages(retry)).toEqual(["planning", "media"]);
    expect(retry.voice?.status).toBe("invalidated");
    expect(retry.captions?.status).toBe("invalidated");
    expect(retry.render?.status).toBe("invalidated");
  });

  it("creates revision history and enforces exactly one final revision", async () => {
    const service = new RevisionService(new RevisionFakeDb() as any);
    const initial = await service.ensureInitialRevision({ projectId: "video_1", sourceJobId: "job_1", outputVideoId: "video_1" });
    const voice = await service.createRevision({
      projectId: "video_1",
      parentRevisionId: initial.id,
      sourceJobId: "job_2",
      changeType: "voice",
      changedFields: { reusedStages: ["planning", "media"] },
    });
    await service.markFinal("video_1", voice.id);
    const revisions = await service.listRevisions("video_1");

    expect(revisions).toHaveLength(2);
    expect(revisions.filter((revision) => revision.isFinal)).toHaveLength(1);
    expect(revisions.find((revision) => revision.isFinal)?.id).toBe(voice.id);
  });

  it("prevents duplicate job claims through atomic status transition semantics", async () => {
    const db = new WorkerFakeDb();
    const service = new WorkerLeaseService(db as any);

    const first = await service.claimJob("job_a", { workerId: "worker_1", maxConcurrentRenders: 1 });
    const second = await service.claimJob("job_a", { workerId: "worker_2", maxConcurrentRenders: 2 });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe("not_queued");
  });

  it("generates multiple scene search candidates, smart clip windows, and near-duplicate risk", () => {
    const service = new MediaIntelligenceService();
    const spec: any = {
      id: "spec",
      brandKit: { brandName: "ABUD" },
      contentStyle: "advertisement",
      tone: "احترافي",
      language: "ar",
    };
    const scene: any = {
      purpose: "solution",
      narration: "موقع سريع يخلي صاحب البيزنس يكسب عملاء",
      stockSearchTerms: ["website", "small business"],
    };

    const terms = service.generateSearchCandidates(scene, "technology", spec);
    const window = selectSmartClipWindow({ id: "clip", url: "u", width: 1920, height: 1080, duration: 20 }, 5);
    const risk = estimateNearDuplicateRisk(
      { id: "clip-b", url: "u2", width: 1920, height: 1080, duration: 10, tags: ["small business", "office"], creator: "same" },
      [{ id: "clip-a", url: "u1", width: 1910, height: 1080, duration: 9, tags: ["small business", "office"], creator: "same" }],
    );

    expect(terms.length).toBeGreaterThanOrEqual(4);
    expect(window.selectedStart).toBeGreaterThan(0);
    expect(risk).toBeGreaterThanOrEqual(45);
  });

  it("validates versioned n8n contract payloads", () => {
    const payload = buildN8nContractPayload({
      jobId: "job_1",
      requestId: "request_123",
      appBaseUrl: "http://app:3123",
      renderWorkerBaseUrl: "http://render-worker:3123",
      jobInput: { prompt: "test" },
    });
    expect(n8nContractSchema.parse(payload).schemaVersion).toBe("abud.v2.internal.job.v1");
    expect(payload.idempotencyKey).toBe("job_1:job.start");
  });

  it("signs webhook payloads and rejects localhost webhook targets", async () => {
    const service = new WebhookService({ enabled: false } as any);
    const signature = service.signPayload("{\"ok\":true}", "whsec_test", "123");
    expect(signature).toHaveLength(64);
    await expect(service.createWebhook("http://127.0.0.1/hook", ["job.created"] as any)).rejects.toThrow(/private network|localhost/);
  });
});
