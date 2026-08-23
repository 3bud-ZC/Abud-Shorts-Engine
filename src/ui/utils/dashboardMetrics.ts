import type { V2HealthComponent, V2Job, VideoItem } from "../pages/v2Types";

export type DashboardMetric = {
  label: string;
  value: number | string;
  hint: string;
};

export function formatDashboardBytes(bytes = 0): string {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function buildDashboardMetrics(input: {
  jobs: V2Job[];
  videos: VideoItem[];
  health: { status: string; components: V2HealthComponent[] } | null;
  now?: Date;
}): DashboardMetric[] {
  const { jobs, videos, health } = input;
  const today = (input.now || new Date()).toDateString();
  const running = jobs.filter((j) => !["ready", "failed", "canceled"].includes(j.status)).length;
  const diskComponent = health?.components?.find((c) => c.name === "Disk");
  const diskBytes =
    typeof diskComponent?.details?.bytes === "number"
      ? diskComponent.details.bytes
      : videos.reduce((sum, v) => sum + (v.sizeBytes || 0), 0);

  return [
    { label: "Total Videos", value: videos.length, hint: "Generated MP4 files, including completed revision outputs" },
    { label: "Videos Ready", value: videos.filter((v) => v.status === "ready").length, hint: "Available in library" },
    { label: "Active Jobs", value: running, hint: running > 0 ? "Rendering in background" : "Pipeline idle" },
    { label: "Failed Jobs", value: jobs.filter((j) => j.status === "failed").length, hint: "Requires review" },
    {
      label: "Videos Today",
      value: videos.filter((v) => new Date(v.createdAt).toDateString() === today).length,
      hint: "Produced today",
    },
    { label: "Disk Storage", value: formatDashboardBytes(diskBytes), hint: "Local media folder" },
  ];
}

export function summarizeDashboardFailures(failedSources: string[]): string | null {
  const unique = Array.from(new Set(failedSources.filter(Boolean)));
  if (unique.length === 0) return null;
  return `Dashboard metrics unavailable: ${unique.join(", ")}.`;
}
