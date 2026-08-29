import { describe, expect, it } from "vitest";
import { JobService } from "./jobs";

/**
 * V2.4 PASS 5 - WALL-CLOCK ACCOUNTING FIX
 * -------------------------------------------
 * `updateStageCheckpoint` spread the new `timingMs` over
 * `stage_timings[stage + "Ms"]`, which OVERWRITES rather than accumulates.
 * "media"/"voice"/"captions" all fire once PER SCENE in the main render
 * loop, so only the last scene's individual duration ever survived in the
 * stored total - a real production (job cmtewtb4p000107l29fxzfggb) measured
 * 491s of actual wall clock against only 147s of "accounted" stage time,
 * with the other 344s being earlier scenes' time this overwrite had already
 * discarded. This is a minimal in-memory fake of the two queries
 * `updateStageCheckpoint`/`getJob` actually issue, not a full DB mock.
 */

type FakeRow = Record<string, unknown>;

class FakeJobsDb {
  private row: FakeRow;
  public enabled = true;

  constructor(id: string) {
    this.row = {
      id,
      type: "video",
      status: "processing",
      progress: 0,
      current_stage: "queued",
      input: {},
      stage_timings: {},
      checkpoint: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async query<T = any>(sql: string, _params?: unknown[]): Promise<T[]> {
    if (sql.startsWith("SELECT * FROM jobs WHERE id")) {
      return [this.row] as unknown as T[];
    }
    if (sql.startsWith("UPDATE jobs")) {
      const [, checkpointJson, stageTimingsJson] = _params as [string, string, string];
      this.row = {
        ...this.row,
        checkpoint: JSON.parse(checkpointJson),
        stage_timings: JSON.parse(stageTimingsJson),
        updated_at: new Date(),
      };
      return [this.row] as unknown as T[];
    }
    throw new Error(`FakeJobsDb: unhandled query: ${sql}`);
  }
}

describe("JobService.updateStageCheckpoint accumulates per-stage timing across multiple scenes", () => {
  it("sums repeated timingMs calls for the same stage instead of keeping only the last one", async () => {
    const db = new FakeJobsDb("job-1");
    const jobs = new JobService(db as any);

    // Three scenes, each reporting its own "media" (stock search) duration -
    // exactly what the real per-scene render loop does.
    await jobs.updateStageCheckpoint("job-1", "media" as any, "completed", { timingMs: 15000 });
    await jobs.updateStageCheckpoint("job-1", "media" as any, "completed", { timingMs: 40000 });
    const finalJob = await jobs.updateStageCheckpoint("job-1", "media" as any, "completed", { timingMs: 108327 });

    expect(finalJob.stageTimings?.mediaMs).toBe(15000 + 40000 + 108327);
  });

  it("still reports a single duration correctly for a stage that only fires once", async () => {
    const db = new FakeJobsDb("job-2");
    const jobs = new JobService(db as any);
    const finalJob = await jobs.updateStageCheckpoint("job-2", "render" as any, "completed", { timingMs: 6641 });
    expect(finalJob.stageTimings?.renderMs).toBe(6641);
  });

  it("does not touch other stages' totals when accumulating one", async () => {
    const db = new FakeJobsDb("job-3");
    const jobs = new JobService(db as any);
    await jobs.updateStageCheckpoint("job-3", "voice" as any, "completed", { timingMs: 1000 });
    await jobs.updateStageCheckpoint("job-3", "media" as any, "completed", { timingMs: 5000 });
    const finalJob = await jobs.updateStageCheckpoint("job-3", "media" as any, "completed", { timingMs: 7000 });
    expect(finalJob.stageTimings?.voiceMs).toBe(1000);
    expect(finalJob.stageTimings?.mediaMs).toBe(12000);
  });
});
