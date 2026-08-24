import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { Button, Grid, Stack, Typography, Box, Card, CardContent, Divider } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MovieIcon from "@mui/icons-material/Movie";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useNavigate } from "react-router-dom";
import {
  bidiProps,
  isArabicText,
  DashboardSkeleton,
  EmptyState,
  ErrorBoundary,
  ErrorState,
  PageHeader,
  RecentJobCard,
  SectionCard,
  StatCard,
  StatusBadge,
} from "../components/v2";
import { ClientHealthSummary } from "../components/ClientHealthSummary";
import type { V2HealthComponent, V2Job, VideoItem } from "./v2Types";
import { buildDashboardMetrics, formatDashboardBytes, summarizeDashboardFailures } from "../utils/dashboardMetrics";

const DashboardHomeContent: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [health, setHealth] = useState<{ status: string; components: V2HealthComponent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      axios.get("/api/v2/jobs", { params: { limit: 1000 } }),
      axios.get("/api/videos"),
      axios.get("/api/v2/system/health"),
    ]).then(([jobsResult, videosResult, healthResult]) => {
      if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.data.jobs || []);
      if (videosResult.status === "fulfilled") setVideos(videosResult.value.data.videos || []);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value.data);
      const failedSources = [
        jobsResult.status === "rejected" ? "jobs" : "",
        videosResult.status === "rejected" ? "videos" : "",
        healthResult.status === "rejected" ? "system health" : "",
      ].filter(Boolean);
      setError(summarizeDashboardFailures(failedSources));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const metrics = useMemo(() => {
    return buildDashboardMetrics({ jobs, videos, health });
  }, [jobs, videos, health]);

  if (loading && jobs.length === 0 && videos.length === 0) {
    return <DashboardSkeleton />;
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        eyebrow="Overview"
        description="Create videos, watch production progress, review completed outputs, and prepare publishing from one workspace."
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              Refresh
            </Button>
            <Button variant="outlined" startIcon={<MovieIcon />} onClick={() => navigate("/videos")}>
              Videos
            </Button>
            <Button variant="outlined" color="secondary" startIcon={<SendIcon />} onClick={() => navigate("/publishing")}>
              Publishing
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
              Create Video
            </Button>
          </Stack>
        }
      />

      {error && <ErrorState message={error} onRetry={loadData} />}

      {/* Standardized Metrics Grid */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {metrics.map((metric) => (
          <Grid item xs={12} sm={6} md={4} lg={2} key={metric.label}>
            <StatCard {...metric} />
          </Grid>
        ))}
      </Grid>

      {/* Main Content: Recent Jobs on Left, Health & Recent Videos on Right */}
      <Grid container spacing={2.5}>
        {/* Left Column: Recent Jobs */}
        <Grid item xs={12} lg={8}>
          <SectionCard
            title="Recent Productions"
            description="Latest video production requests and their current progress."
            actions={
              <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate("/jobs")}>
                View All Jobs ({jobs.length})
              </Button>
            }
          >
            <Stack spacing={1.5}>
              {jobs.slice(0, 6).map((job) => (
                <RecentJobCard
                  key={job.id}
                  job={job}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                />
              ))}

              {jobs.length === 0 && (
                <EmptyState
                  title="No productions yet"
                  description="Create your first video using Prompt Studio or pre-built Business Templates."
                  action={
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
                      Create Your First Video
                    </Button>
                  }
                />
              )}
            </Stack>
          </SectionCard>
        </Grid>

        {/* Right Column: System Health & Recent Videos */}
        <Grid item xs={12} lg={4}>
          <Stack spacing={2.5}>
            {/* System Health Panel */}
            <SectionCard
              title="System Health"
              description="Everything needed to make videos."
              actions={<StatusBadge status={health?.status || "healthy"} />}
            >
              <Stack spacing={1}>
                {/* Grouped into what a customer can act on. The technical
                    component list stays under System Health → Advanced Details. */}
                <ClientHealthSummary components={health?.components || []} />
              </Stack>
            </SectionCard>

            {/* Recent Videos Preview Panel */}
            <SectionCard
              title="Recent Videos"
              description="Completed videos ready for preview."
              actions={
                <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate("/videos")}>
                  All Videos
                </Button>
              }
            >
              <Stack spacing={1.5}>
                {videos.slice(0, 4).map((video) => {
                  const isAr = isArabicText(video.title);
                  return (
                    <Card
                      key={video.videoId}
                      variant="outlined"
                      onClick={() => navigate(`/video/${video.videoId}`)}
                      sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        "&:hover": {
                          borderColor: "primary.main",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                        },
                      }}
                    >
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box
                          sx={{
                            width: 54,
                            height: 72,
                            borderRadius: 1,
                            bgcolor: "#0f172a",
                            overflow: "hidden",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <MovieIcon sx={{ color: "#94a3b8", fontSize: 24 }} />
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography
                            variant="subtitle2"
                            fontWeight={700}
                            noWrap
                            dir={isAr ? "rtl" : "ltr"}
                            sx={{ textAlign: isAr ? "right" : "left" }}
                          >
                            {video.title || video.templateName || "Untitled Short"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {formatDashboardBytes(video.sizeBytes)} · {new Date(video.createdAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                      </Stack>
                    </Card>
                  );
                })}

                {videos.length === 0 && (
                  <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 2 }}>
                    No rendered videos available yet.
                  </Typography>
                )}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
};

export const DashboardHome: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Dashboard Error">
      <DashboardHomeContent />
    </ErrorBoundary>
  );
};

export default DashboardHome;
