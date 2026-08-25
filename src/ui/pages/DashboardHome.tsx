import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MovieIcon from "@mui/icons-material/Movie";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import { useNavigate } from "react-router-dom";

import {
  bidiProps,
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
import { useI18n } from "../i18n";
import type { V2Job, VideoItem } from "./v2Types";
import {
  buildDashboardAlerts,
  buildDashboardAnalytics,
  buildDashboardMetrics,
  buildPublishingMetrics,
  failedSourceKeys,
  type DashboardAlert,
  type DashboardAnalytics,
  type FastHealthItemLike,
  type PublishingSummaryData,
} from "../utils/dashboardMetrics";
import { withMediaAccessToken } from "../utils/auth";

type FastHealthReport = {
  ok: boolean;
  attentionCount: number;
  status: string;
  items: FastHealthItemLike[];
  checkedAt: string;
};

/** Client-facing name for each fast-health item, as a translation key. */
const HEALTH_ITEM_LABEL_KEYS: Record<string, string> = {
  application: "health.group.application",
  database: "health.group.database",
  videoEngine: "health.group.videoEngine",
  automation: "health.group.automation",
  voice: "health.group.voice",
  ai: "health.group.ai",
  mediaSources: "health.group.mediaSources",
  publishing: "health.group.publishing",
  storage: "health.group.storage",
};

/**
 * Every dashboard request carries a client-side deadline.
 *
 * Without one, a request that never settles leaves the page on its skeleton
 * indefinitely - which is exactly how System Health used to hang. A dashboard
 * that renders with one section missing is strictly better than a dashboard
 * that renders nothing.
 */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * A compact bar chart drawn from divs.
 *
 * Deliberately not a charting library: the dashboard shows one series of at
 * most thirty daily counts, and a dependency for that would cost more in bundle
 * size than the whole feature is worth. Each bar carries its own title, and the
 * series is also exposed as a text summary for screen readers, so the
 * information is not colour- or shape-only.
 */
const ActivityBars: React.FC<{ analytics: DashboardAnalytics }> = ({ analytics }) => {
  const theme = useTheme();
  const { format, t } = useI18n();
  const peak = Math.max(1, ...analytics.daily.map((day) => day.total));

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="flex-end"
        spacing={0.75}
        sx={{ height: 96, mt: 1 }}
        aria-hidden="true"
      >
        {analytics.daily.map((day) => {
          const height = day.total === 0 ? 3 : Math.max(6, (day.total / peak) * 88);
          return (
            <Tooltip
              key={day.date}
              title={`${format.date(day.date)} · ${format.number(day.total)}`}
            >
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  height,
                  borderRadius: 1,
                  bgcolor: day.failed > 0 ? theme.abud.warning : theme.abud.primary,
                  opacity: day.total === 0 ? 0.28 : 0.9,
                  transition: "opacity 0.15s ease",
                  "&:hover": { opacity: 1 },
                }}
              />
            </Tooltip>
          );
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        {t("dashboard.analytics.perDay")} ·{" "}
        {format.date(analytics.daily[0]?.date)} – {format.date(analytics.daily[analytics.daily.length - 1]?.date)}
      </Typography>
    </Box>
  );
};

/** A labelled proportion bar, used for the language and type splits. */
const SplitBar: React.FC<{ label: string; count: number; ratio: number }> = ({
  label,
  count,
  ratio,
}) => {
  const { format } = useI18n();
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ textTransform: "uppercase" }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {format.number(count)} · {format.percent(ratio)}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.round(ratio * 100)}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Stack>
  );
};

const AlertRow: React.FC<{ alert: DashboardAlert; onAction: (href: string) => void }> = ({
  alert,
  onAction,
}) => {
  const { t } = useI18n();
  const severity = alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warning" : "info";

  return (
    <Alert
      severity={severity}
      action={
        <Button color="inherit" size="small" onClick={() => onAction(alert.href)}>
          {t(alert.actionKey)}
        </Button>
      }
      sx={{ alignItems: "center" }}
    >
      <AlertTitle sx={{ mb: alert.bodyKey ? 0.25 : 0 }}>
        {t(alert.titleKey, alert.titleVars)}
      </AlertTitle>
      {alert.bodyKey && (
        <Typography variant="caption" color="text.secondary">
          {t(alert.bodyKey, alert.bodyVars)}
        </Typography>
      )}
    </Alert>
  );
};

const DashboardHomeContent: React.FC = () => {
  const navigate = useNavigate();
  const { t, format } = useI18n();
  const theme = useTheme();

  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [health, setHealth] = useState<FastHealthReport | null>(null);
  const [publishing, setPublishing] = useState<PublishingSummaryData | null>(null);
  const [channelCount, setChannelCount] = useState<number | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedKeys, setFailedKeys] = useState<string[]>([]);

  const loadData = useCallback(() => {
    setLoading(true);
    const get = (url: string, params?: Record<string, unknown>) =>
      axios.get(url, { params, timeout: REQUEST_TIMEOUT_MS });

    Promise.allSettled([
      get("/api/v2/jobs", { limit: 1000 }),
      get("/api/videos"),
      get("/api/v2/system/health/fast"),
      get("/api/v2/publishing/summary"),
      get("/api/v2/publishing/accounts"),
      get("/api/v2/system/storage"),
    ]).then(([jobsRes, videosRes, healthRes, summaryRes, accountsRes, storageRes]) => {
      if (jobsRes.status === "fulfilled") setJobs(jobsRes.value.data.jobs || []);
      if (videosRes.status === "fulfilled") setVideos(videosRes.value.data.videos || []);
      if (healthRes.status === "fulfilled") setHealth(healthRes.value.data);

      // Publishing figures are only shown when the API actually answered.
      // Rendering zeroes for an unreachable publishing service would claim
      // "nothing has ever been published", which is a different statement.
      setPublishing(summaryRes.status === "fulfilled" ? summaryRes.value.data : null);
      setChannelCount(
        accountsRes.status === "fulfilled"
          ? (accountsRes.value.data.accounts || accountsRes.value.data || []).length
          : null,
      );
      setStorageBytes(
        storageRes.status === "fulfilled"
          ? Number(storageRes.value.data?.usedProjectStorageBytes ?? 0)
          : null,
      );

      setFailedKeys(
        failedSourceKeys({
          jobs: jobsRes.status === "fulfilled",
          videos: videosRes.status === "fulfilled",
          health: healthRes.status === "fulfilled",
        }),
      );
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  const metrics = useMemo(
    () => buildDashboardMetrics({ jobs, videos, storageBytes }),
    [jobs, videos, storageBytes],
  );

  const publishingMetrics = useMemo(
    () => buildPublishingMetrics({ summary: publishing, connectedChannels: channelCount }),
    [publishing, channelCount],
  );

  const analytics = useMemo(() => buildDashboardAnalytics({ jobs, windowDays: 30 }), [jobs]);

  const serviceLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    Object.entries(HEALTH_ITEM_LABEL_KEYS).forEach(([id, key]) => {
      labels[id] = t(key);
    });
    return labels;
  }, [t]);

  const alerts = useMemo(
    () => buildDashboardAlerts({ jobs, health, publishing, serviceLabels }),
    [jobs, health, publishing, serviceLabels],
  );

  const recentVideos = useMemo(
    () =>
      [...videos]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 4),
    [videos],
  );

  if (loading && jobs.length === 0 && videos.length === 0 && !health) {
    return <DashboardSkeleton />;
  }

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        eyebrow={t("dashboard.eyebrow")}
        description={t("dashboard.description")}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ rowGap: 1 }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t("common.refresh")}
            </Button>
            <Button variant="outlined" startIcon={<MovieIcon />} onClick={() => navigate("/videos")}>
              {t("navigation.videoLibrary")}
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<SendIcon />}
              onClick={() => navigate("/publishing")}
            >
              {t("navigation.publishing")}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
              {t("navigation.createVideo")}
            </Button>
          </Stack>
        }
      />

      {failedKeys.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <ErrorState
            message={t("errors.dashboardSources", {
              sources: failedKeys.map((key) => t(key)).join(", "),
            })}
            onRetry={loadData}
          />
        </Box>
      )}

      {/* ------------------------------------------------ operational metrics */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {metrics.map((metric) => (
          <Grid item xs={6} sm={4} md={4} lg={2} key={metric.id}>
            <StatCard
              label={t(metric.labelKey)}
              value={metric.bytes ? format.bytes(metric.value) : format.number(metric.value)}
              hint={t(metric.hintKey)}
              tone={metric.tone}
              onClick={metric.href ? () => navigate(metric.href!) : undefined}
            />
          </Grid>
        ))}
      </Grid>

      {/* Publishing metrics appear only when the publishing API answered. */}
      {publishingMetrics && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {publishingMetrics.map((metric) => (
            <Grid item xs={6} sm={4} md={3} key={metric.id}>
              <StatCard
                label={t(metric.labelKey)}
                value={format.number(metric.value)}
                hint={t(metric.hintKey)}
                tone={metric.tone}
                onClick={metric.href ? () => navigate(metric.href!) : undefined}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <Grid container spacing={2.5}>
        {/* ------------------------------------------------------ left column */}
        <Grid item xs={12} lg={8}>
          <Stack spacing={2.5}>
            {/* ------------------------------------------------------ alerts */}
            <SectionCard
              title={t("dashboard.alerts.title")}
              description={t("dashboard.alerts.description")}
            >
              {alerts.length === 0 ? (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                  <CheckCircleIcon sx={{ color: theme.abud.success }} />
                  <Box>
                    <Typography variant="subtitle1">{t("dashboard.alerts.allClear")}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t("dashboard.alerts.allClearBody")}
                    </Typography>
                  </Box>
                </Stack>
              ) : (
                <Stack spacing={1.25}>
                  {alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onAction={(href) => navigate(href)} />
                  ))}
                </Stack>
              )}
            </SectionCard>

            {/* ------------------------------------------ recent productions */}
            <SectionCard
              title={t("dashboard.recentProductions.title")}
              description={t("dashboard.recentProductions.description")}
              actions={
                <Button
                  size="small"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() => navigate("/jobs")}
                >
                  {t("common.viewAll")} ({format.number(jobs.length)})
                </Button>
              }
            >
              <Stack spacing={1.5}>
                {jobs.slice(0, 6).map((job) => (
                  <RecentJobCard
                    key={job.id}
                    job={job}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    onPreview={
                      job.output?.videoId
                        ? () => navigate(`/video/${job.output.videoId}`)
                        : undefined
                    }
                    onViewError={() => navigate(`/jobs/${job.id}`)}
                  />
                ))}

                {jobs.length === 0 && (
                  <EmptyState
                    title={t("dashboard.recentProductions.empty")}
                    description={t("dashboard.recentProductions.emptyBody")}
                    action={
                      <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate("/create")}
                      >
                        {t("dashboard.recentProductions.createFirst")}
                      </Button>
                    }
                  />
                )}
              </Stack>
            </SectionCard>

            {/* --------------------------------------------------- analytics */}
            <SectionCard
              title={t("dashboard.analytics.title")}
              description={t("dashboard.analytics.description")}
              actions={<Chip size="small" variant="outlined" label={t("dashboard.analytics.last30")} />}
            >
              {analytics.empty ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  {t("dashboard.analytics.noData")}
                </Typography>
              ) : (
                <Stack spacing={2.5}>
                  <ActivityBars analytics={analytics} />
                  <Divider />
                  <Grid container spacing={2.5}>
                    <Grid item xs={12} sm={6}>
                      <Stack spacing={1.5}>
                        <Typography variant="subtitle2" color="text.secondary">
                          {t("dashboard.analytics.outcome")}
                        </Typography>
                        <SplitBar
                          label={t("dashboard.analytics.completed")}
                          count={analytics.completed}
                          ratio={
                            analytics.completed + analytics.failed > 0
                              ? analytics.completed / (analytics.completed + analytics.failed)
                              : 0
                          }
                        />
                        <SplitBar
                          label={t("dashboard.analytics.failed")}
                          count={analytics.failed}
                          ratio={
                            analytics.completed + analytics.failed > 0
                              ? analytics.failed / (analytics.completed + analytics.failed)
                              : 0
                          }
                        />
                        <Stack direction="row" justifyContent="space-between" sx={{ pt: 0.5 }}>
                          <Typography variant="body2" color="text.secondary">
                            {t("dashboard.analytics.averageDuration")}
                          </Typography>
                          <Typography variant="body2" fontWeight={650}>
                            {analytics.averageDurationMs === null
                              ? t("common.notAvailable")
                              : format.durationMs(analytics.averageDurationMs)}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Stack spacing={2}>
                        {analytics.languageSplit.length > 0 && (
                          <Stack spacing={1.25}>
                            <Typography variant="subtitle2" color="text.secondary">
                              {t("dashboard.analytics.languageSplit")}
                            </Typography>
                            {analytics.languageSplit.slice(0, 4).map((entry) => (
                              <SplitBar
                                key={entry.key}
                                label={entry.label}
                                count={entry.count}
                                ratio={entry.ratio}
                              />
                            ))}
                          </Stack>
                        )}
                        {analytics.typeSplit.length > 0 && (
                          <Stack spacing={1.25}>
                            <Typography variant="subtitle2" color="text.secondary">
                              {t("dashboard.analytics.typeSplit")}
                            </Typography>
                            {analytics.typeSplit.map((entry) => (
                              <SplitBar
                                key={entry.key}
                                label={
                                  entry.key === "prompt"
                                    ? t("productions.typePrompt")
                                    : t("productions.typeTemplate")
                                }
                                count={entry.count}
                                ratio={entry.ratio}
                              />
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </Grid>
                  </Grid>
                </Stack>
              )}
            </SectionCard>
          </Stack>
        </Grid>

        {/* ----------------------------------------------------- right column */}
        <Grid item xs={12} lg={4}>
          <Stack spacing={2.5}>
            {/* ---------------------------------------------- service status */}
            <SectionCard
              title={t("dashboard.health.title")}
              description={t("dashboard.health.description")}
              actions={
                <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate("/system")}>
                  {t("common.viewDetails")}
                </Button>
              }
            >
              {!health ? (
                <Typography variant="body2" color="text.secondary">
                  {t("dashboard.health.checking")}
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {health.items.map((item) => (
                    <Stack
                      key={item.id}
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      spacing={1}
                      sx={{ py: 0.85, px: 1, borderRadius: 1.5, "&:hover": { bgcolor: "action.hover" } }}
                    >
                      <Typography variant="body2">
                        {t(HEALTH_ITEM_LABEL_KEYS[item.id] || "common.unknown")}
                      </Typography>
                      <StatusBadge status={item.status} />
                    </Stack>
                  ))}
                </Stack>
              )}
            </SectionCard>

            {/* -------------------------------------------- publishing summary */}
            {publishing && (
              <SectionCard
                title={t("dashboard.publishingSummary.title")}
                description={t("dashboard.publishingSummary.description")}
                actions={
                  <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate("/publishing")}>
                    {t("common.open")}
                  </Button>
                }
              >
                <Stack spacing={1.25}>
                  {[
                    { labelKey: "dashboard.publishingSummary.total", value: publishing.totalPublications },
                    { labelKey: "publishing.publishedToday", value: publishing.publishedTodayCount },
                    { labelKey: "publishing.scheduled", value: publishing.scheduledCount },
                    { labelKey: "dashboard.publishingSummary.inProgress", value: publishing.publishingCount },
                    { labelKey: "publishing.failed", value: publishing.failedCount },
                  ].map((row) => (
                    <Stack
                      key={row.labelKey}
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <Typography variant="body2" color="text.secondary">
                        {t(row.labelKey)}
                      </Typography>
                      <Typography variant="body2" fontWeight={650}>
                        {format.number(row.value)}
                      </Typography>
                    </Stack>
                  ))}
                  {channelCount === 0 && (
                    <>
                      <Divider />
                      <Typography variant="caption" color="text.secondary">
                        {t("dashboard.publishingSummary.noAccounts")}
                      </Typography>
                    </>
                  )}
                </Stack>
              </SectionCard>
            )}

            {/* ------------------------------------------------ recent videos */}
            <SectionCard
              title={t("dashboard.recentVideos.title")}
              description={t("dashboard.recentVideos.description")}
              actions={
                <Button size="small" endIcon={<ArrowForwardIcon />} onClick={() => navigate("/videos")}>
                  {t("common.viewAll")}
                </Button>
              }
            >
              <Stack spacing={1.25}>
                {recentVideos.map((video) => {
                  const title = video.title || video.templateName || t("videos.untitled");
                  const titleDir = bidiProps(title);
                  return (
                    <Card
                      key={video.videoId}
                      variant="outlined"
                      onClick={() => navigate(`/video/${video.videoId}`)}
                      sx={{
                        p: 1.25,
                        borderRadius: 2,
                        cursor: "pointer",
                        transition: "border-color 0.15s ease, background-color 0.15s ease",
                        "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                      }}
                    >
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box
                          sx={{
                            width: 46,
                            height: 62,
                            borderRadius: 1.5,
                            bgcolor: theme.abud.backgroundAlt,
                            border: `1px solid ${theme.abud.border}`,
                            overflow: "hidden",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {video.thumbnailUrl ? (
                            <Box
                              component="img"
                              src={withMediaAccessToken(video.thumbnailUrl)}
                              alt={t("videos.thumbnailAlt", { title })}
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <MovieIcon sx={{ color: theme.abud.muted, fontSize: 22 }} />
                          )}
                        </Box>

                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            noWrap
                            dir={titleDir.dir}
                            sx={titleDir.style}
                          >
                            {title}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            alignItems="center"
                            flexWrap="wrap"
                            sx={{ mt: 0.25 }}
                          >
                            <Typography variant="caption" color="text.secondary">
                              {typeof video.durationSeconds === "number"
                                ? format.duration(video.durationSeconds)
                                : format.bytes(video.sizeBytes)}
                            </Typography>
                            {video.language && (
                              <Typography variant="caption" color="text.secondary">
                                · {video.language.toUpperCase()}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary">
                              · {format.date(video.createdAt)}
                            </Typography>
                          </Stack>
                        </Box>

                        <Stack spacing={0.5} alignItems="flex-end">
                          <StatusBadge status={video.status} />
                          <Button
                            size="small"
                            variant="text"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/publishing?video=${video.videoId}`);
                            }}
                            sx={{ minHeight: 26, px: 0.75, fontSize: "0.75rem" }}
                          >
                            {t("dashboard.recentVideos.publish")}
                          </Button>
                        </Stack>
                      </Stack>
                    </Card>
                  );
                })}

                {recentVideos.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }} textAlign="center">
                    {t("dashboard.recentVideos.empty")}
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

export const DashboardHome: React.FC = () => (
  <ErrorBoundary>
    <DashboardHomeContent />
  </ErrorBoundary>
);

export default DashboardHome;
