import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button, Grid, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MovieIcon from "@mui/icons-material/Movie";
import { useNavigate } from "react-router-dom";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressDisplay,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../components/v2";
import type { V2HealthComponent, V2Job, VideoItem } from "./v2Types";

function formatBytes(bytes = 0) {
  if (!bytes) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DashboardHome: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [health, setHealth] = useState<{ status: string; components: V2HealthComponent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      axios.get("/api/v2/jobs"),
      axios.get("/api/videos"),
      axios.get("/api/v2/system/health"),
    ]).then(([jobsResult, videosResult, healthResult]) => {
      if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.data.jobs || []);
      if (videosResult.status === "fulfilled") setVideos(videosResult.value.data.videos || []);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value.data);
      if ([jobsResult, videosResult, healthResult].some((result) => result.status === "rejected")) {
        setError("Some dashboard data could not be loaded.");
      }
      setLoading(false);
    });
  }, []);

  const metrics = useMemo(() => {
    const today = new Date().toDateString();
    const running = jobs.filter((j) => !["ready", "failed", "canceled"].includes(j.status)).length;
    const diskComponent = health?.components.find((c) => c.name === "Disk");
    const diskBytes =
      typeof diskComponent?.details?.bytes === "number"
        ? diskComponent.details.bytes
        : videos.reduce((sum, v) => sum + (v.sizeBytes || 0), 0);
    return [
      { label: "Total Videos", value: videos.length, hint: "Includes legacy MP4 files" },
      { label: "Videos Ready", value: videos.filter((v) => v.status === "ready").length },
      { label: "Jobs Running", value: running },
      { label: "Failed Jobs", value: jobs.filter((j) => j.status === "failed").length },
      {
        label: "Videos Today",
        value: videos.filter((v) => new Date(v.createdAt).toDateString() === today).length,
      },
      { label: "Disk Usage", value: formatBytes(diskBytes) },
      { label: "System Health", value: health?.status || "checking" },
    ];
  }, [jobs, videos, health]);

  if (loading) return <LoadingState label="Loading dashboard data..." />;

  return (
    <>
      <PageHeader
        title="Dashboard"
        eyebrow="Control Plane V2"
        description="Create videos, monitor hidden orchestration, and manage local generation from the dashboard."
        actions={
          <>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
              Create Video
            </Button>
            <Button variant="outlined" startIcon={<MovieIcon />} onClick={() => navigate("/videos")}>
              Videos
            </Button>
          </>
        }
      />
      {error && <ErrorState message={error} />}

      <Grid container spacing={2} sx={{ mt: error ? 2 : 0, mb: 3 }}>
        {metrics.map((metric) => (
          <Grid item xs={12} sm={6} lg={3} xl={2} key={metric.label}>
            <StatCard {...metric} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <SectionCard title="Recent Jobs" description="Latest orchestration events from PostgreSQL.">
            <Stack spacing={1.5}>
              {jobs.slice(0, 8).map((job) => (
                <SectionCard key={job.id}>
                  <Stack spacing={1.25} onClick={() => navigate(`/jobs/${job.id}`)} sx={{ cursor: "pointer" }}>
                    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                      <Stack spacing={0.5}>
                        <Typography fontWeight={800}>{job.title || job.templateId || "Video job"}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {job.templateId || "Manual"} · {job.brandName || "No brand"} · {new Date(job.createdAt).toLocaleString()}
                        </Typography>
                      </Stack>
                      <StatusBadge status={job.status} />
                    </Stack>
                    <ProgressDisplay
                      stage={job.currentStage}
                      progress={job.progress}
                      timestamp={job.updatedAt}
                      message={job.error || "Job state is persisted and survives refresh."}
                    />
                  </Stack>
                </SectionCard>
              ))}
              {jobs.length === 0 && (
                <EmptyState
                  title="No V2 jobs yet"
                  description="Create a video to start the hidden n8n orchestration flow."
                  action={<Button onClick={() => navigate("/create")}>Create Video</Button>}
                />
              )}
            </Stack>
          </SectionCard>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Stack spacing={2}>
            <SectionCard title="System Health">
              <Stack spacing={1.25}>
                {(health?.components || []).slice(0, 9).map((component) => (
                  <Stack key={component.name} direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="body2">{component.name}</Typography>
                    <StatusBadge status={component.status} />
                  </Stack>
                ))}
              </Stack>
            </SectionCard>
            <SectionCard title="Recent Videos">
              <Stack spacing={1.5}>
                {videos.slice(0, 5).map((video) => (
                  <Stack key={video.videoId} spacing={0.5} onClick={() => navigate(`/video/${video.videoId}`)} sx={{ cursor: "pointer" }}>
                    <Typography fontWeight={800}>{video.templateName || video.templateId || video.filename}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {video.brandName || "No brand"} · {formatBytes(video.sizeBytes)} · {new Date(video.createdAt).toLocaleString()}
                    </Typography>
                  </Stack>
                ))}
                {videos.length === 0 && <Typography color="text.secondary">No videos found.</Typography>}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
};

export default DashboardHome;
