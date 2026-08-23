import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MovieIcon from "@mui/icons-material/Movie";
import { useNavigate, useParams } from "react-router-dom";
import {
  LoadingState,
  PageHeader,
  ProgressDisplay,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { V2Job, V2JobEvent } from "./v2Types";

const JobDetails: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<V2Job | null>(null);
  const [events, setEvents] = useState<V2JobEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!jobId) return;
    try {
      const [jobResponse, eventsResponse] = await Promise.all([
        axios.get(`/api/v2/jobs/${jobId}`),
        axios.get(`/api/v2/jobs/${jobId}/events`),
      ]);
      setJob(jobResponse.data.job);
      setEvents(eventsResponse.data.events || []);
      setError(null);
    } catch {
      setError("Failed to load job.");
    }
  };

  useEffect(() => {
    load();
    if (!jobId) return;
    const source = new EventSource(`/api/v2/jobs/${jobId}/events`);
    source.addEventListener("job-event", (event) => {
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
      if (["ready", "failed", "canceled"].includes(parsed.status)) setTimeout(load, 500);
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [jobId]);

  const latestEvent = useMemo(() => events[events.length - 1], [events]);
  const videoId = job?.output?.videoId;

  if (!job && !error) return <LoadingState label="Loading job details..." />;

  const isPromptMode = job?.creationMode === "prompt";
  const cost = job?.costEstimate || job?.productionSpec?.costEstimate;

  return (
    <>
      <PageHeader
        title={job?.title || "Job details"}
        description={
          job
            ? `${isPromptMode ? "Prompt Mode" : job.templateId || "Template"} · ${
                job.brandName || "No brand"
              } · Created ${new Date(job.createdAt).toLocaleString()}`
            : undefined
        }
        actions={
          <>
            <Button onClick={() => navigate("/jobs")}>Back to Jobs</Button>
            {videoId && (
              <Button
                variant="contained"
                startIcon={<MovieIcon />}
                onClick={() => navigate(`/video/${videoId}`)}
              >
                Preview Video
              </Button>
            )}
            {videoId && (
              <Button
                component="a"
                href={`/api/videos/${videoId}/download`}
                startIcon={<DownloadIcon />}
              >
                Download MP4
              </Button>
            )}
          </>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {job && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={7}>
            <Stack spacing={2}>
              {/* Progress */}
              <SectionCard title="Current Progress" actions={<StatusBadge status={job.status} />}>
                <ProgressDisplay
                  stage={job.currentStage}
                  progress={job.progress}
                  timestamp={latestEvent?.createdAt || job.updatedAt}
                  message={job.error || latestEvent?.message || "Waiting for orchestration."}
                />
                {job.error && <Alert severity="error" sx={{ mt: 2 }}>{job.error}</Alert>}
              </SectionCard>

              {/* Original Prompt (If Prompt Mode) */}
              {job.originalPrompt && (
                <SectionCard
                  title="Original Creative Prompt"
                  actions={<Chip size="small" label="Prompt Mode" color="primary" />}
                >
                  <Typography variant="body1" sx={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                    "{job.originalPrompt}"
                  </Typography>
                </SectionCard>
              )}

              {/* Progress Timeline */}
              <SectionCard title="Progress Timeline" description="Live updates delivered via Server-Sent Events.">
                <Stack spacing={1.25}>
                  {events.map((event) => (
                    <SectionCard key={event.id}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                        <Stack spacing={0.25}>
                          <Typography fontWeight={800}>{event.stage}</Typography>
                          <Typography variant="body2" color="text.secondary">{event.message}</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {event.progress}% · {new Date(event.createdAt).toLocaleTimeString()}
                        </Typography>
                      </Stack>
                    </SectionCard>
                  ))}
                </Stack>
              </SectionCard>
            </Stack>
          </Grid>

          <Grid item xs={12} lg={5}>
            <Stack spacing={2}>
              {/* Production Metadata Summary */}
              <SectionCard title="Production Overview">
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Creation Mode</Typography>
                    <Typography fontWeight={700}>{isPromptMode ? "Prompt Studio" : "Template Mode"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Language / Dialect</Typography>
                    <Typography fontWeight={700}>
                      {job.language?.toUpperCase() || "AUTO"} {job.dialect && job.dialect !== "none" ? `(${job.dialect})` : ""}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Quality & Resolution</Typography>
                    <Typography fontWeight={700}>{job.qualityProfile || "Standard"} · {job.resolution || "1080p"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Aspect Ratio</Typography>
                    <Typography fontWeight={700}>{job.aspectRatio || "9:16"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Target Duration</Typography>
                    <Typography fontWeight={700}>
                      {job.productionSpec?.durationSeconds ? `${job.productionSpec.durationSeconds}s` : "Auto"}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Visual Mode</Typography>
                    <Typography fontWeight={700}>{job.visualMode || "Stock (Pexels)"}</Typography>
                  </Stack>
                  {job.visualProvidersUsed && job.visualProvidersUsed.length > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Visual Providers Used</Typography>
                      <Typography fontWeight={700}>{job.visualProvidersUsed.join(", ")}</Typography>
                    </Stack>
                  )}
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Voice Provider</Typography>
                    <Typography fontWeight={700}>{job.voiceProvider || "Kokoro TTS (Free)"}</Typography>
                  </Stack>
                  {job.aiProvider && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Creative Director AI</Typography>
                      <Typography fontWeight={700}>{job.aiProvider}</Typography>
                    </Stack>
                  )}
                  <Divider />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary">Estimated Cost</Typography>
                    <Chip
                      size="small"
                      color={cost?.isFree || cost?.estimatedCost === 0 ? "success" : "warning"}
                      label={cost?.isFree || cost?.estimatedCost === 0 ? "Free ($0)" : `$${cost?.estimatedCost} USD`}
                    />
                  </Stack>
                </Stack>
              </SectionCard>

              {/* Technical Details & Production Spec Accordion */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography fontWeight={800}>Production Spec & Technical Details</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.25}>
                    {job.technicalError && <Alert severity="warning">{job.technicalError}</Alert>}
                    <Typography variant="caption" color="text.secondary">Job ID: {job.id}</Typography>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, background: "#0f172a", color: "#38bdf8", padding: 12, borderRadius: 6 }}>
                      {JSON.stringify(job.productionSpec || { input: job.input, output: job.output }, null, 2)}
                    </pre>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Grid>
        </Grid>
      )}
    </>
  );
};

export default JobDetails;
