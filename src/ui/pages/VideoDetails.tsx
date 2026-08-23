import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import YouTubeIcon from "@mui/icons-material/YouTube";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TelegramIcon from "@mui/icons-material/Telegram";
import TwitterIcon from "@mui/icons-material/Twitter";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBoundary,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import { ReviewPublishModal } from "../components/publishing/ReviewPublishModal";
import type { V2Job, VideoItem, VideoPublishingStatus } from "./v2Types";

function formatFileSize(bytes?: number): string {
  if (!bytes) return "Unknown";
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

const VideoDetailsContent: React.FC = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [job, setJob] = useState<V2Job | null>(null);
  const [pubStatus, setPubStatus] = useState<VideoPublishingStatus | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchDetails = () => {
    if (!videoId) return;
    Promise.allSettled([
      axios.get(`/api/videos/${videoId}`),
      axios.get(`/api/v2/jobs/${videoId}`),
      axios.get(`/api/v2/videos/${videoId}/publishing`),
    ]).then(([videoResult, jobResult, pubResult]) => {
      if (videoResult.status === "fulfilled") {
        setVideo(videoResult.value.data);
      } else {
        setError("Video metadata could not be loaded.");
      }
      if (jobResult.status === "fulfilled") setJob(jobResult.value.data.job);
      if (pubResult.status === "fulfilled") setPubStatus(pubResult.value.data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchDetails();
  }, [videoId]);

  const copy = (path: string, label: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${path}`).then(() => {
      setFeedback(`${label} copied to clipboard.`);
      setTimeout(() => setFeedback(null), 2200);
    });
  };

  const deleteVideo = async () => {
    if (!videoId) return;
    setConfirmDelete(false);
    try {
      await axios.delete(`/api/short-video/${videoId}`);
      navigate("/videos");
    } catch {
      setError("Failed to delete video.");
    }
  };

  if (loading) return <LoadingState label="Loading video details..." />;

  if (!video && !loading) {
    return (
      <Box sx={{ py: 4 }}>
        <EmptyState
          title="Video Not Found"
          description={`The requested video ID "${videoId || "unknown"}" could not be found or has been deleted.`}
          action={
            <Button variant="contained" onClick={() => navigate("/videos")}>
              Back to Videos
            </Button>
          }
        />
      </Box>
    );
  }

  const title =
    video?.templateName ||
    video?.templateId ||
    (video?.creationMode === "prompt" ? "AI Prompt Video" : video?.filename) ||
    "Video details";

  const previewUrl = video?.previewUrl || `/api/short-video/${videoId}`;
  const downloadUrl = video?.downloadUrl || `/api/videos/${videoId}/download`;
  const cost = video?.costEstimate;

  return (
    <>
      <PageHeader
        title={title}
        eyebrow={video?.creationMode === "prompt" ? "Prompt Studio" : "Template Production"}
        description={
          video?.brandName
            ? `Brand: ${video.brandName}`
            : "Generated MP4 details and delivery links."
        }
        actions={
          <>
            <Button onClick={() => navigate("/videos")}>Back to Videos</Button>
            {job && <Button onClick={() => navigate(`/jobs/${job.id}`)}>View Job</Button>}
            <Button
              variant="contained"
              color="primary"
              startIcon={<SendIcon />}
              onClick={() => setReviewModalOpen(true)}
            >
              Publish / Schedule
            </Button>
            <Button
              component="a"
              href={downloadUrl}
              variant="outlined"
              startIcon={<DownloadIcon />}
            >
              Download MP4
            </Button>
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          </>
        }
      />

      {feedback && <Alert severity="info" sx={{ mb: 2 }}>{feedback}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {video && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={8}>
            <SectionCard title="Video Preview">
              <video
                controls
                src={previewUrl}
                style={{
                  width: "100%",
                  aspectRatio: video.aspectRatio === "16:9" ? "16 / 9" : "9 / 16",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  background: "#0f172a",
                  borderRadius: 8,
                }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>
                <Button
                  startIcon={<ContentCopyIcon />}
                  onClick={() => copy(previewUrl, "Preview link")}
                >
                  Copy Preview Link
                </Button>
                <Button
                  startIcon={<ContentCopyIcon />}
                  onClick={() => copy(downloadUrl, "Download link")}
                >
                  Copy Download Link
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SendIcon />}
                  onClick={() => setReviewModalOpen(true)}
                  sx={{ ml: "auto" }}
                >
                  Publish / Distribute
                </Button>
              </Stack>
            </SectionCard>

            {/* Publishing & Distribution Section */}
            <SectionCard
              title="Social Publishing & Distribution"
              description="Multi-platform distribution state, live URLs, and scheduling."
              actions={
                <Stack direction="row" spacing={1} alignItems="center">
                  <StatusBadge
                    status={
                      pubStatus?.status === "published"
                        ? "ready"
                        : pubStatus?.status === "partially_published"
                          ? "ready"
                          : pubStatus?.status === "publishing"
                            ? "rendering"
                            : pubStatus?.status === "scheduled"
                              ? "queued"
                              : pubStatus?.status === "failed"
                                ? "failed"
                                : "unknown"
                    }
                    label={
                      pubStatus?.status === "published"
                        ? "Published"
                        : pubStatus?.status === "partially_published"
                          ? "Partially Published"
                          : pubStatus?.status === "publishing"
                            ? "Publishing Now"
                            : pubStatus?.status === "scheduled"
                              ? "Scheduled"
                              : pubStatus?.status === "failed"
                                ? "Failed"
                                : "Not Published"
                    }
                  />
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SendIcon />}
                    onClick={() => setReviewModalOpen(true)}
                  >
                    Publish / Schedule
                  </Button>
                </Stack>
              }
            >
              {pubStatus?.publications && pubStatus.publications.length > 0 ? (
                <Stack spacing={1.5}>
                  {pubStatus.publications.map((pub) => (
                    <Card key={pub.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          {pub.platform === "youtube" && <YouTubeIcon sx={{ color: "#ff0000" }} />}
                          {pub.platform === "tiktok" && <span style={{ fontWeight: 900 }}>TT</span>}
                          {pub.platform === "instagram" && <InstagramIcon sx={{ color: "#e1306c" }} />}
                          {pub.platform === "facebook" && <FacebookIcon sx={{ color: "#1877f2" }} />}
                          {pub.platform === "telegram" && <TelegramIcon sx={{ color: "#229ed9" }} />}
                          {pub.platform === "twitter" && <TwitterIcon sx={{ color: "#1da1f2" }} />}
                          <Box>
                            <Typography variant="body2" fontWeight={800} sx={{ textTransform: "capitalize" }}>
                              {pub.platform}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {pub.publishedAt
                                ? `Published: ${new Date(pub.publishedAt).toLocaleString()}`
                                : pub.scheduledAt
                                  ? `Scheduled for: ${new Date(pub.scheduledAt).toLocaleString()} (${pub.sourceTimezone})`
                                  : `Status: ${pub.status}`}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack direction="row" spacing={1} alignItems="center">
                          <StatusBadge status={pub.status} />
                          {pub.providerUrl && (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={pub.providerUrl}
                              target="_blank"
                              rel="noreferrer"
                              startIcon={<OpenInNewIcon />}
                            >
                              View Post
                            </Button>
                          )}
                          {pub.status === "failed" && (
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={async () => {
                                await axios.post(`/api/v2/publishing/publications/${pub.id}/retry`);
                                fetchDetails();
                              }}
                            >
                              Retry
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  This video has not been distributed to any social platforms yet. Click "Publish / Schedule" to distribute it to YouTube, TikTok, Instagram, Facebook, or Telegram.
                </Typography>
              )}
            </SectionCard>

            {/* Original Prompt */}
            {video.originalPrompt && (
              <SectionCard title="Creative Prompt">
                <Typography variant="body1" sx={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                  "{video.originalPrompt}"
                </Typography>
              </SectionCard>
            )}

            {/* Narration Lines */}
            {video.narrationLines && video.narrationLines.length > 0 && (
              <SectionCard title="Narration Script">
                <Stack spacing={1}>
                  {video.narrationLines.map((line, index) => (
                    <Typography key={`${line}-${index}`}>
                      <strong>Scene {index + 1}:</strong> {line}
                    </Typography>
                  ))}
                </Stack>
              </SectionCard>
            )}
          </Grid>

          <Grid item xs={12} lg={4}>
            <Stack spacing={2}>
              {/* Metadata */}
              <SectionCard title="Video Metadata" actions={<StatusBadge status={video.status} />}>
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Mode</Typography>
                    <Typography fontWeight={700}>
                      {video.creationMode === "prompt" ? "Prompt Studio" : "Template"}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Language / Dialect</Typography>
                    <Typography fontWeight={700}>
                      {video.language?.toUpperCase() || "AUTO"}{" "}
                      {video.dialect && video.dialect !== "none" ? `(${video.dialect})` : ""}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Quality & Resolution</Typography>
                    <Typography fontWeight={700}>
                      {video.quality || "Standard"} · {video.resolution || "1080p"}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Technical Score</Typography>
                    <Chip
                      size="small"
                      color={
                        (video.technicalScore ?? video.qualityScore ?? 100) >= 90
                          ? "success"
                          : (video.technicalScore ?? video.qualityScore ?? 100) >= 70
                            ? "warning"
                            : "error"
                      }
                      label={`${video.technicalScore ?? video.qualityScore ?? 100} / 100`}
                    />
                  </Stack>
                  {video.mediaPlanScore !== undefined && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Media Plan Score</Typography>
                      <Chip
                        size="small"
                        color={video.mediaPlanScore >= 90 ? "success" : "info"}
                        label={`${video.mediaPlanScore} / 100`}
                      />
                    </Stack>
                  )}
                  {video.overallProductionScore !== undefined && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Overall Score</Typography>
                      <Typography fontWeight={800} color="primary.main">
                        {video.overallProductionScore} / 100
                      </Typography>
                    </Stack>
                  )}
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Final Duration</Typography>
                    <Typography fontWeight={700}>{formatDuration(video.durationSeconds)}</Typography>
                  </Stack>
                  {video.requestedDurationSeconds && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Requested Duration</Typography>
                      <Typography fontWeight={700}>{video.requestedDurationSeconds}s</Typography>
                    </Stack>
                  )}
                  {video.durationVarianceSeconds !== undefined && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Duration Variance</Typography>
                      <Typography
                        fontWeight={700}
                        color={video.durationVarianceSeconds <= 1.0 ? "success.main" : "warning.main"}
                      >
                        ±{video.durationVarianceSeconds}s
                        {video.durationVariancePercent !== undefined
                          ? ` (${video.durationVariancePercent}%)`
                          : ""}
                      </Typography>
                    </Stack>
                  )}
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">File Size</Typography>
                    <Typography fontWeight={700}>{formatFileSize(video.sizeBytes)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Voice Provider</Typography>
                    <Typography fontWeight={700}>{video.voiceProvider || "Kokoro TTS"}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Visual Provider</Typography>
                    <Typography fontWeight={700}>
                      {video.visualProvidersUsed?.join(", ") || "Pexels"}
                    </Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography color="text.secondary">Estimated Cost</Typography>
                    <Chip
                      size="small"
                      color={cost?.isFree || cost?.estimatedCost === 0 ? "success" : "warning"}
                      label={
                        cost?.isFree || cost?.estimatedCost === 0
                          ? "Free ($0)"
                          : `$${cost?.estimatedCost} USD`
                      }
                    />
                  </Stack>
                </Stack>
              </SectionCard>

              {/* Production Details */}
              <SectionCard title="Production Details">
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography color="text.secondary">Caption Preset</Typography>
                    <Typography fontWeight={700} sx={{ textTransform: "capitalize" }}>
                      {video.captionProfileUsed || video.captionStyle || "Bold"}
                    </Typography>
                  </Stack>
                  {video.musicTrack && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Music Track</Typography>
                      <Typography fontWeight={600} noWrap sx={{ maxWidth: "60%" }} title={video.musicTrack}>
                        {video.musicTrack.replace(".mp3", "")} {video.musicMood ? `(${video.musicMood})` : ""}
                      </Typography>
                    </Stack>
                  )}
                  {video.motionPresetsUsed && video.motionPresetsUsed.length > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Motion Presets</Typography>
                      <Typography fontWeight={700}>
                        {video.motionPresetsUsed.join(", ")}
                      </Typography>
                    </Stack>
                  )}
                  {video.transitionPresetsUsed && video.transitionPresetsUsed.length > 0 && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Transitions</Typography>
                      <Typography fontWeight={700}>
                        {video.transitionPresetsUsed.join(", ")}
                      </Typography>
                    </Stack>
                  )}
                  {video.mediaSegmentCount !== undefined && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">Media Segments</Typography>
                      <Typography fontWeight={700}>
                        {video.mediaSegmentCount} clips
                      </Typography>
                    </Stack>
                  )}
                </Stack>
              </SectionCard>

              {/* Brand Kit */}
              <SectionCard title="Brand Profile">
                <Stack spacing={1}>
                  <Typography>Brand Name: {video.brandName || "None"}</Typography>
                  <Typography>Watermark: {video.watermarkText || "None"}</Typography>
                  <Typography>Caption Style: {video.captionStyle || "Bold"}</Typography>
                </Stack>
              </SectionCard>

              {/* Pexels terms */}
              <SectionCard title="Stock Search Terms">
                <Typography color={video.pexelsTerms?.length ? "text.primary" : "text.secondary"}>
                  {video.pexelsTerms?.length
                    ? video.pexelsTerms.join(", ")
                    : "No stock search terms recorded."}
                </Typography>
              </SectionCard>

              {/* Collapsible Production Spec */}
              {video.productionSpec && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography fontWeight={800}>Production Spec JSON</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, background: "#0f172a", color: "#38bdf8", padding: 10, borderRadius: 6 }}>
                      {JSON.stringify(video.productionSpec, null, 2)}
                    </pre>
                  </AccordionDetails>
                </Accordion>
              )}
            </Stack>
          </Grid>
        </Grid>
      )}

      {video && (
        <ReviewPublishModal
          open={reviewModalOpen}
          video={video}
          onClose={() => setReviewModalOpen(false)}
          onSuccess={fetchDetails}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete video?"
        description="This will remove the generated MP4 file and its metadata sidecar. The V2 job record in PostgreSQL is preserved."
        confirmLabel="Delete"
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteVideo}
      />
    </>
  );
};

export const VideoDetails: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Video Details Error">
      <VideoDetailsContent />
    </ErrorBoundary>
  );
};

export default VideoDetails;
