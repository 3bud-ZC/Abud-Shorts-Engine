import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MovieIcon from "@mui/icons-material/Movie";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useNavigate, useParams } from "react-router-dom";
import {
  bidiProps,
  isArabicText,
  getStageLabel,
  EmptyState,
  ErrorBoundary,
  JobDetailsSkeleton,
  PageHeader,
  ProgressDisplay,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { V2Job, V2JobEvent } from "./v2Types";

function formatDuration(startedAt?: string, completedAt?: string) {
  if (!startedAt) return "Not started";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const JobDetailsContent: React.FC = () => {
  const { jobId, id } = useParams<{ jobId?: string; id?: string }>();
  const effectiveId = jobId || id;
  const navigate = useNavigate();

  const [job, setJob] = useState<V2Job | null>(null);
  const [events, setEvents] = useState<V2JobEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!effectiveId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const [jobResponse, eventsResponse] = await Promise.all([
        axios.get(`/api/v2/jobs/${effectiveId}`),
        axios.get(`/api/v2/jobs/${effectiveId}/events`),
      ]);
      setJob(jobResponse.data.job || null);
      setEvents(eventsResponse.data.events || []);
      setError(null);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setNotFound(true);
      } else {
        setError(err?.response?.data?.error || err?.message || "Failed to load job details.");
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveId]);

  useEffect(() => {
    load();
    if (!effectiveId) return;

    let source: EventSource | null = null;
    try {
      source = new EventSource(`/api/v2/jobs/${effectiveId}/events`);
      source.addEventListener("job-event", (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as V2JobEvent;
          setEvents((prev) =>
            [...prev.filter((item) => item.id !== parsed.id), parsed].sort((a, b) => a.id - b.id),
          );
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: parsed.status,
                  progress: parsed.progress,
                  currentStage: parsed.stage,
                  updatedAt: parsed.createdAt,
                }
              : prev,
          );
          if (["ready", "failed", "canceled"].includes(parsed.status)) {
            setTimeout(load, 800);
          }
        } catch (parseError) {
          console.warn("Failed to parse SSE event:", parseError);
        }
      });
      source.onerror = () => {
        source?.close();
      };
    } catch (sseErr) {
      console.warn("SSE connection error:", sseErr);
    }

    return () => {
      source?.close();
    };
  }, [effectiveId, load]);

  const copyId = () => {
    if (!effectiveId) return;
    navigator.clipboard.writeText(effectiveId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const latestEvent = useMemo(() => events[events.length - 1], [events]);
  const videoId = job?.output?.videoId || (job?.status === "ready" ? job?.id : undefined);
  const isPromptMode = job?.creationMode === "prompt";
  const cost = job?.costEstimate || job?.productionSpec?.costEstimate;

  // 1. Loading State
  if (loading && !job) {
    return <JobDetailsSkeleton />;
  }

  // 2. 404 / Not Found State
  if (notFound || (!job && !loading && !error)) {
    return (
      <Box sx={{ py: 4 }}>
        <EmptyState
          title="Job Not Found"
          description={`The requested job ID "${effectiveId || "unknown"}" does not exist in the database or may have been deleted.`}
          action={
            <Button variant="contained" startIcon={<ArrowBackIcon />} onClick={() => navigate("/jobs")}>
              Back to Jobs
            </Button>
          }
        />
      </Box>
    );
  }

  // 3. API Error State
  if (error && !job) {
    return (
      <Box sx={{ py: 4 }}>
        <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "error.light", bgcolor: "#fff5f5" }}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6" color="error.main" fontWeight={800}>
                Unable to Load Job Details
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {error}
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <Button variant="contained" startIcon={<RefreshIcon />} onClick={load}>
                  Retry
                </Button>
                <Button variant="outlined" onClick={() => navigate("/jobs")}>
                  Back to Jobs
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

  if (!job) return null;

  const isArabicTitle = isArabicText(job.title);
  const displayTitle = job.title || job.templateId || "Video Job";

  return (
    <>
      <PageHeader
        title={displayTitle}
        eyebrow={`Job ID: ${job.id}`}
        description={
          `${isPromptMode ? "Prompt Studio" : (job.templateId || "Template Mode")}` +
          `${job.brandName ? ` · Brand: ${job.brandName}` : ""}` +
          ` · Created ${new Date(job.createdAt).toLocaleString()}`
        }
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => navigate("/jobs")}>
              Back to Jobs
            </Button>
            {job.status === "ready" && videoId && (
              <>
                <Button
                  variant="contained"
                  startIcon={<MovieIcon />}
                  onClick={() => navigate(`/video/${videoId}`)}
                >
                  Preview Video
                </Button>
                <Button
                  component="a"
                  href={`/api/videos/${videoId}/download`}
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                >
                  Download MP4
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<SendIcon />}
                  onClick={() => navigate(`/publishing?videoId=${videoId}`)}
                >
                  Publish
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Grid container spacing={2.5}>
        {/* =========================================================================
            LEFT COLUMN: Progress, Video Result, Script/Prompt, Timeline
            ========================================================================= */}
        <Grid item xs={12} lg={7}>
          <Stack spacing={2.5}>
            {/* 1. Current Progress & Execution State */}
            <SectionCard
              title="Execution Progress"
              actions={<StatusBadge status={job.status} />}
            >
              <Stack spacing={2}>
                <ProgressDisplay
                  stage={job.currentStage}
                  progress={job.progress}
                  timestamp={latestEvent?.createdAt || job.updatedAt}
                  message={job.error || latestEvent?.message || "Orchestration active."}
                />

                <Divider />

                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      STARTED
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "Pending"}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      COMPLETED
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : "In Progress"}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      DURATION
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formatDuration(job.startedAt, job.completedAt)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      LAST UPDATE
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {new Date(job.updatedAt).toLocaleTimeString()}
                    </Typography>
                  </Grid>
                </Grid>

                {job.error && (
                  <Alert severity="error" icon={<ErrorIcon />} sx={{ mt: 1 }}>
                    <Typography fontWeight={700}>Job Execution Error:</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{job.error}</Typography>
                  </Alert>
                )}
              </Stack>
            </SectionCard>

            {/* 2. Ready Video Card (When Ready) */}
            {job.status === "ready" && videoId && (
              <SectionCard
                title="Rendered Video Output"
                actions={<Chip size="small" color="success" icon={<CheckCircleIcon />} label="Ready" />}
              >
                <Stack spacing={2}>
                  <Box
                    sx={{
                      position: "relative",
                      borderRadius: 2,
                      overflow: "hidden",
                      bgcolor: "#000000",
                      maxHeight: 420,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <video
                      src={`/api/short-video/${videoId}`}
                      poster={`/api/videos/${videoId}/thumbnail`}
                      controls
                      style={{
                        maxHeight: 400,
                        width: "100%",
                        objectFit: "contain",
                        borderRadius: 8,
                      }}
                    />
                  </Box>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">
                      MP4 video generated and stored in local media library.
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<MovieIcon />}
                        onClick={() => navigate(`/video/${videoId}`)}
                      >
                        Full Details
                      </Button>
                      <Button
                        component="a"
                        href={`/api/videos/${videoId}/download`}
                        variant="outlined"
                        size="small"
                        startIcon={<DownloadIcon />}
                      >
                        Download
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </SectionCard>
            )}

            {/* 3. Original Creative Prompt / Script */}
            {(job.originalPrompt || job.productionSpec?.userPrompt) && (
              <SectionCard
                title="Creative Script & Prompt"
                actions={<Chip size="small" label={isPromptMode ? "Prompt Studio" : "Template"} color="primary" variant="outlined" />}
              >
                <Box
                  {...bidiProps(job.originalPrompt || job.productionSpec?.userPrompt)}
                  sx={{
                    p: 2,
                    borderRadius: 1.5,
                    bgcolor: "rgba(36, 84, 90, 0.04)",
                    border: "1px solid rgba(36, 84, 90, 0.12)",
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                    fontSize: "0.95rem",
                  }}
                >
                  "{job.originalPrompt || job.productionSpec?.userPrompt}"
                </Box>

                {/* Scene breakdown if available in productionSpec */}
                {job.productionSpec?.scenes && job.productionSpec.scenes.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                      Timeline Scenes ({job.productionSpec.scenes.length} Scenes)
                    </Typography>
                    <Stack spacing={1}>
                      {job.productionSpec.scenes.map((scene: any, idx: number) => {
                        const isArabicNarration = isArabicText(scene.narration);
                        return (
                          <Card key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                            <Stack spacing={0.5}>
                              <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" fontWeight={800} color="primary.main">
                                  Scene {idx + 1} · {scene.purpose?.toUpperCase() || "CONTENT"} ({scene.durationSeconds || 6}s)
                                </Typography>
                                <Chip size="small" label={scene.transition || "cut"} variant="outlined" sx={{ fontSize: 10, height: 18 }} />
                              </Stack>
                              <Typography
                                variant="body2"
                                dir={isArabicNarration ? "rtl" : "ltr"}
                                sx={{ textAlign: isArabicNarration ? "right" : "left", fontWeight: 500 }}
                              >
                                {scene.narration}
                              </Typography>
                              {scene.onScreenText && (
                                <Typography variant="caption" color="text.secondary">
                                  Text Overlay: <strong>{scene.onScreenText}</strong>
                                </Typography>
                              )}
                            </Stack>
                          </Card>
                        );
                      })}
                    </Stack>
                  </Box>
                )}
              </SectionCard>
            )}

            {/* 4. Live Progress Timeline */}
            <SectionCard
              title="Orchestration Timeline"
              description="Historical and real-time execution events."
            >
              <Stack spacing={1}>
                {events.map((event) => {
                  const isArabicMsg = isArabicText(event.message);
                  return (
                    <Card key={event.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
                        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography fontWeight={800} variant="body2">{getStageLabel(event.stage)}</Typography>
                            <StatusBadge status={event.status} />
                          </Stack>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            dir={isArabicMsg ? "rtl" : "ltr"}
                            sx={{ textAlign: isArabicMsg ? "right" : "left" }}
                          >
                            {event.message}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                          {event.progress}% · {new Date(event.createdAt).toLocaleTimeString()}
                        </Typography>
                      </Stack>
                    </Card>
                  );
                })}
                {events.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No timeline events recorded yet.
                  </Typography>
                )}
              </Stack>
            </SectionCard>
          </Stack>
        </Grid>

        {/* =========================================================================
            RIGHT COLUMN: Production Specs, Providers, Technical Accordion
            ========================================================================= */}
        <Grid item xs={12} lg={5}>
          <Stack spacing={2.5}>
            {/* 1. Production Overview */}
            <SectionCard title="Production Specs">
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Creation Mode</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {isPromptMode ? "Prompt Studio" : (job.templateId || "Template Mode")}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Language / Dialect</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {job.language?.toUpperCase() || "AR"}{job.dialect && job.dialect !== "none" ? ` (${job.dialect})` : ""}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Aspect Ratio</Typography>
                  <Typography variant="body2" fontWeight={700}>{job.aspectRatio || "9:16 (Vertical)"}</Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Target Duration</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {job.productionSpec?.durationSeconds ? `${job.productionSpec.durationSeconds}s` : "30s"}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Quality Profile</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {job.qualityProfile || "Standard"} · {job.resolution || "1080p"}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Visual Provider</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {job.visualMode || "Stock Footage (Pexels)"}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Voice Synthesizer</Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {job.voiceProvider || "Kokoro Neural TTS (Local/Free)"}
                  </Typography>
                </Stack>
                <Divider />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">Estimated Cost</Typography>
                  <Chip
                    size="small"
                    color={cost?.isFree || cost?.estimatedCost === 0 ? "success" : "warning"}
                    label={cost?.isFree || cost?.estimatedCost === 0 ? "Free ($0.00)" : `$${cost?.estimatedCost} USD`}
                    sx={{ fontWeight: 700 }}
                  />
                </Stack>
              </Stack>
            </SectionCard>

            {/* 2. Brand Profile (if present) */}
            {job.brandName && (
              <SectionCard title="Brand Kit">
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">Brand Name</Typography>
                    <Typography variant="body2" fontWeight={700}>{job.brandName}</Typography>
                  </Stack>
                </Stack>
              </SectionCard>
            )}

            {/* 3. Technical Details Accordion */}
            <Accordion variant="outlined" sx={{ borderRadius: 2, bgcolor: "#ffffff" }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" fontWeight={800}>
                  Technical Specification & Raw Payloads
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      Internal Job ID: <code>{job.id}</code>
                    </Typography>
                    <Button size="small" variant="text" startIcon={<ContentCopyIcon fontSize="small" />} onClick={copyId}>
                      {copied ? "Copied!" : "Copy ID"}
                    </Button>
                  </Stack>

                  {job.technicalError && (
                    <Alert severity="warning" sx={{ fontSize: "0.8rem" }}>
                      <AlertTitle fontWeight={700}>Technical Error Details</AlertTitle>
                      {job.technicalError}
                    </Alert>
                  )}

                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Production Spec JSON:
                  </Typography>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 11,
                      background: "#0f172a",
                      color: "#38bdf8",
                      padding: 12,
                      borderRadius: 6,
                      maxHeight: 280,
                      overflowY: "auto",
                    }}
                  >
                    {JSON.stringify(job.productionSpec || { input: job.input, output: job.output }, null, 2)}
                  </pre>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </Grid>
      </Grid>
    </>
  );
};

export const JobDetails: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Job Details Error">
      <JobDetailsContent />
    </ErrorBoundary>
  );
};

export default JobDetails;
