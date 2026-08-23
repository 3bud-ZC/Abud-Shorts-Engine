import { describe, expect, it } from "vitest";
import { buildDashboardMetrics, formatDashboardBytes, summarizeDashboardFailures } from "./dashboardMetrics";

describe("dashboard metrics", () => {
  it("builds metrics from available canonical jobs, videos, and disk health", () => {
    const metrics = buildDashboardMetrics({
      now: new Date("2026-08-23T12:00:00Z"),
      jobs: [
        { id: "job_ready", type: "video", status: "ready", progress: 100, currentStage: "Ready", createdAt: "", updatedAt: "" },
        { id: "job_failed", type: "video", status: "failed", progress: 50, currentStage: "Failed", createdAt: "", updatedAt: "" },
        { id: "job_active", type: "video", status: "rendering", progress: 70, currentStage: "Rendering", createdAt: "", updatedAt: "" },
      ],
      videos: [
        { videoId: "v1", filename: "v1.mp4", status: "ready", sizeBytes: 1000, createdAt: "2026-08-23T09:00:00Z", downloadUrl: "", previewUrl: "" },
        { videoId: "v2", filename: "v2.mp4", status: "ready", sizeBytes: 2000, createdAt: "2026-08-22T09:00:00Z", downloadUrl: "", previewUrl: "" },
      ],
      health: {
        status: "healthy",
        components: [
          {
            name: "Disk",
            status: "healthy",
            message: "ok",
            checkedAt: "2026-08-23T12:00:00Z",
            details: { bytes: 2249685402 },
          },
        ],
      },
    });

    expect(metrics.find((m) => m.label === "Total Videos")?.value).toBe(2);
    expect(metrics.find((m) => m.label === "Videos Ready")?.value).toBe(2);
    expect(metrics.find((m) => m.label === "Active Jobs")?.value).toBe(1);
    expect(metrics.find((m) => m.label === "Failed Jobs")?.value).toBe(1);
    expect(metrics.find((m) => m.label === "Videos Today")?.value).toBe(1);
    expect(metrics.find((m) => m.label === "Disk Storage")?.value).toBe("2.10 GB");
  });

  it("keeps partial metric failures targeted instead of zeroing every card", () => {
    expect(summarizeDashboardFailures(["system health"])).toBe("Dashboard metrics unavailable: system health.");
    expect(summarizeDashboardFailures(["jobs", "jobs", "videos"])).toBe("Dashboard metrics unavailable: jobs, videos.");
    expect(summarizeDashboardFailures([])).toBeNull();
  });

  it("formats bytes consistently", () => {
    expect(formatDashboardBytes(0)).toBe("0 MB");
    expect(formatDashboardBytes(1024 * 1024 * 12.25)).toBe("12.3 MB");
  });
});
