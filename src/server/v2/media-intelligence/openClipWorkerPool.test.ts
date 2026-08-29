import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

/**
 * V2.4 PASS 5 - PERSISTENT OPENCLIP WORKER POOL
 * ------------------------------------------------
 * `child_process.spawn` is mocked so this suite exercises the pool's actual
 * request/response correlation, idle/busy tracking, timeout handling and
 * crash-respawn logic deterministically, without needing a real Python /
 * torch runtime (which this dev host does not have installed - the pool is
 * inert here in production too, exactly as designed: getSharedOpenClipWorkerPool()
 * returns null when no quality Python path is configured).
 */

type FakeChildProcess = EventEmitter & {
  stdin: { write: (data: string, cb?: (err?: Error) => void) => void };
  stdout: EventEmitter & { setEncoding: (enc: string) => void };
  stderr: EventEmitter & { setEncoding: (enc: string) => void };
  kill: () => void;
  killed: boolean;
};

function makeFakeChild(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess;
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    proc.emit("exit", null);
  });
  proc.stdin = { write: vi.fn() };
  return proc;
}

const spawnedChildren: FakeChildProcess[] = [];

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = makeFakeChild();
    spawnedChildren.push(child);
    return child;
  }),
}));

// Reply to whatever request a worker receives by echoing a canned response
// tagged with the same requestId, as the real worker script does.
function replyTo(child: FakeChildProcess, response: Record<string, unknown>) {
  const writeMock = child.stdin.write as unknown as ReturnType<typeof vi.fn>;
  const [line] = writeMock.mock.calls[writeMock.mock.calls.length - 1];
  const req = JSON.parse(line);
  child.stdout.emit("data", JSON.stringify({ ...response, requestId: req.requestId }) + "\n");
}

describe("OpenClipWorkerPool", () => {
  beforeEach(() => {
    spawnedChildren.length = 0;
    vi.clearAllMocks();
  });

  it("spawns exactly poolSize workers and answers a request via one of them", async () => {
    const { OpenClipWorkerPool } = await import("./openClipWorkerPool");
    const pool = new OpenClipWorkerPool("fake-python", 2);

    const analysisPromise = pool.analyze(
      { videoPath: "/tmp/a.mp4", intentText: "a laptop", modelId: "openclip:ViT-B-32" },
      2000,
    );

    expect(spawnedChildren).toHaveLength(2);
    // Exactly one worker actually received the request.
    const written = spawnedChildren.filter((c) => (c.stdin.write as any).mock.calls.length > 0);
    expect(written).toHaveLength(1);

    replyTo(written[0], {
      semanticAvailable: true,
      visualSemanticScore: 82.5,
      runtime: "open_clip",
      blackFramePercent: 0,
      longestBlackRunMs: 0,
      perceptualAvailable: true,
      perceptualHashes: ["ab12"],
      frameSampleCount: 3,
    });

    const result = await analysisPromise;
    expect(result.semanticAvailable).toBe(true);
    expect(result.visualSemanticScore).toBe(82.5);
  });

  it("correlates concurrent requests to the correct responses even when they resolve out of order", async () => {
    const { OpenClipWorkerPool } = await import("./openClipWorkerPool");
    const pool = new OpenClipWorkerPool("fake-python", 2);

    const p1 = pool.analyze({ videoPath: "/tmp/1.mp4", intentText: "one", modelId: "m" }, 2000);
    const p2 = pool.analyze({ videoPath: "/tmp/2.mp4", intentText: "two", modelId: "m" }, 2000);

    expect(spawnedChildren).toHaveLength(2);
    const [w1, w2] = spawnedChildren;

    // Reply to the SECOND request first, to prove correlation isn't order-dependent.
    replyTo(w2, { semanticAvailable: true, visualSemanticScore: 20, runtime: "open_clip" });
    replyTo(w1, { semanticAvailable: true, visualSemanticScore: 90, runtime: "open_clip" });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.visualSemanticScore).toBe(90);
    expect(r2.visualSemanticScore).toBe(20);
  });

  it("reuses an idle worker for a new request instead of spawning a third one", async () => {
    const { OpenClipWorkerPool } = await import("./openClipWorkerPool");
    const pool = new OpenClipWorkerPool("fake-python", 2);

    const p1 = pool.analyze({ videoPath: "/tmp/1.mp4", intentText: "one", modelId: "m" }, 2000);
    replyTo(spawnedChildren[0], { semanticAvailable: true, visualSemanticScore: 50, runtime: "open_clip" });
    await p1;

    const p2 = pool.analyze({ videoPath: "/tmp/2.mp4", intentText: "two", modelId: "m" }, 2000);
    // Still only 2 workers total - the second request reused an idle one.
    expect(spawnedChildren).toHaveLength(2);
    replyTo(spawnedChildren[0], { semanticAvailable: true, visualSemanticScore: 60, runtime: "open_clip" });
    const r2 = await p2;
    expect(r2.visualSemanticScore).toBe(60);
  });

  it("rejects and respawns cleanly when a request times out", async () => {
    const { OpenClipWorkerPool } = await import("./openClipWorkerPool");
    const pool = new OpenClipWorkerPool("fake-python", 1);

    const p1 = pool.analyze({ videoPath: "/tmp/1.mp4", intentText: "one", modelId: "m" }, 20);
    await expect(p1).rejects.toThrow(/timed out/);
    expect((spawnedChildren[0].kill as any)).toHaveBeenCalled();

    // The next request must still succeed by spawning a fresh worker.
    const p2 = pool.analyze({ videoPath: "/tmp/2.mp4", intentText: "two", modelId: "m" }, 2000);
    expect(spawnedChildren.length).toBeGreaterThanOrEqual(2);
    replyTo(spawnedChildren[spawnedChildren.length - 1], { semanticAvailable: true, visualSemanticScore: 40, runtime: "open_clip" });
    const r2 = await p2;
    expect(r2.visualSemanticScore).toBe(40);
  });

  it("reports a real init duration for starting the pool", async () => {
    const { OpenClipWorkerPool } = await import("./openClipWorkerPool");
    const pool = new OpenClipWorkerPool("fake-python", 2);
    expect(pool.getInitMs()).toBeNull();
    pool.ensureStarted();
    expect(pool.getInitMs()).not.toBeNull();
    expect(pool.getInitMs()!).toBeGreaterThanOrEqual(0);
  });
});
