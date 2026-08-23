import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Grid,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import GridViewIcon from "@mui/icons-material/GridView";
import ListIcon from "@mui/icons-material/List";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SendIcon from "@mui/icons-material/Send";
import {
  ActionMenu,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  PageHeader,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import { ReviewPublishModal } from "../components/publishing/ReviewPublishModal";
import { BatchPublishModal } from "../components/publishing/BatchPublishModal";
import type { VideoItem } from "./v2Types";

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function videoTitle(video: VideoItem) {
  return video.templateName || video.templateId || video.downloadFilename || video.filename || `Video ${video.videoId.slice(0, 8)}`;
}

const VideoList: React.FC = () => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<VideoItem | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [reviewVideo, setReviewVideo] = useState<VideoItem | null>(null);

  const fetchVideos = async () => {
    try {
      const response = await axios.get("/api/videos");
      setVideos(response.data.videos || []);
      setError(null);
    } catch {
      setError("Failed to fetch videos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  const filteredVideos = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return videos.filter((video) => {
      const haystack = `${videoTitle(video)} ${video.brandName} ${video.watermarkText} ${video.status}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [videos, searchQuery]);

  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const copyLinks = (type: "preview" | "download") => {
    const lines = videos
      .filter((video) => selected.has(video.videoId))
      .map((video) => `${window.location.origin}${type === "preview" ? video.previewUrl : video.downloadUrl}`);
    navigator.clipboard.writeText(lines.join("\n")).then(() => setFeedback(`Copied ${lines.length} ${type} link(s).`));
  };

  const deleteVideo = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await axios.delete(`/api/short-video/${target.videoId}`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(target.videoId);
        return next;
      });
      await fetchVideos();
    } catch {
      setError("Failed to delete video.");
    }
  };

  if (loading) return <LoadingState label="Loading videos..." />;

  const selectedCount = selected.size;

  return (
    <>
      <PageHeader
        title="Videos"
        description="Preview, download, search, distribute, and manage generated MP4s."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>Create Video</Button>}
      />
      {feedback && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setFeedback(null)}>{feedback}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {videos.length === 0 ? (
        <EmptyState title="No generated videos" description="Create the first V2 video to populate the library." action={<Button onClick={() => navigate("/create")}>Create Video</Button>} />
      ) : (
        <Stack spacing={2}>
          <SectionCard>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
              <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search videos by title, brand, template, or status" />
              <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next) => next && setView(next)}>
                <ToggleButton value="grid" aria-label="Grid view"><GridViewIcon /></ToggleButton>
                <ToggleButton value="list" aria-label="List view"><ListIcon /></ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </SectionCard>

          {selectedCount > 0 && (
            <SectionCard>
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                <Typography variant="body2" fontWeight={800}>{selectedCount} selected</Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={() => setBatchModalOpen(true)}
                >
                  Distribute {selectedCount} Videos
                </Button>
                <Button size="small" onClick={() => copyLinks("preview")}>Copy Preview Links</Button>
                <Button size="small" onClick={() => copyLinks("download")}>Copy Download Links</Button>
                <Button size="small" onClick={() => setSelected(new Set())}>Clear</Button>
              </Stack>
            </SectionCard>
          )}

          <Grid container spacing={2}>
            {filteredVideos.map((video) => {
              const isReady = video.status === "ready";
              const checked = selected.has(video.videoId);
              const card = (
                <SectionCard>
                  <Stack spacing={1.25}>
                    <Box
                      sx={{
                        aspectRatio: video.aspectRatio === "16:9" ? "16 / 9" : "9 / 16",
                        bgcolor: "#0f172a",
                        borderRadius: 1,
                        overflow: "hidden",
                        maxHeight: view === "list" ? 180 : 360,
                        position: "relative",
                      }}
                    >
                      {isReady ? (
                        <img
                          src={video.thumbnailUrl || `/api/videos/${video.videoId}/thumbnail`}
                          alt={videoTitle(video)}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", color: "white" }}>
                          <Typography>{video.status}</Typography>
                        </Stack>
                      )}
                    </Box>
                    <Stack direction="row" justifyContent="space-between" spacing={1}>
                      <Stack minWidth={0}>
                        <Typography variant="h6" noWrap>{videoTitle(video)}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {video.brandName || "No brand"} · {formatDuration(video.durationSeconds)}
                        </Typography>
                      </Stack>
                      <Checkbox checked={checked} onChange={() => toggleSelected(video.videoId)} inputProps={{ "aria-label": `Select ${videoTitle(video)}` }} />
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <StatusBadge status={video.status} />
                      {video.qualityScore !== undefined && (
                        <StatusBadge
                          status="success"
                          label={`Quality: ${video.qualityScore}/100`}
                        />
                      )}
                      {video.aspectRatio && (
                        <StatusBadge status="default" label={video.aspectRatio} />
                      )}
                      <StatusBadge status="default" label={formatFileSize(video.sizeBytes)} />
                      <StatusBadge status="default" label={new Date(video.createdAt).toLocaleDateString()} />
                    </Stack>
                    {video.error && <Alert severity="error">{video.error}</Alert>}
                    <Stack direction="row" spacing={1} justifyContent="space-between">
                      <Stack direction="row" spacing={1}>
                        <Button size="small" startIcon={<OpenInNewIcon />} disabled={!isReady} onClick={() => navigate(`/video/${video.videoId}`)}>Preview</Button>
                        <Button size="small" startIcon={<SendIcon />} disabled={!isReady} onClick={() => setReviewVideo(video)}>Publish</Button>
                        <Button size="small" startIcon={<DownloadIcon />} component="a" href={video.downloadUrl} disabled={!isReady}>Download</Button>
                      </Stack>
                      <ActionMenu
                        items={[
                          { label: "Publish / Schedule", disabled: !isReady, onClick: () => setReviewVideo(video) },
                          { label: "Copy preview link", disabled: !isReady, onClick: () => navigator.clipboard.writeText(`${window.location.origin}${video.previewUrl}`) },
                          { label: "Copy download link", disabled: !isReady, onClick: () => navigator.clipboard.writeText(`${window.location.origin}${video.downloadUrl}`) },
                          { label: "Delete", onClick: () => setDeleteTarget(video) },
                        ]}
                      />
                    </Stack>
                  </Stack>
                </SectionCard>
              );
              return (
                <Grid item xs={12} md={view === "list" ? 12 : 6} xl={view === "list" ? 12 : 4} key={video.videoId}>
                  {card}
                </Grid>
              );
            })}
          </Grid>
          {filteredVideos.length === 0 && <EmptyState title="No videos match your search" />}
        </Stack>
      )}

      {reviewVideo && (
        <ReviewPublishModal
          open={Boolean(reviewVideo)}
          video={reviewVideo}
          onClose={() => setReviewVideo(null)}
          onSuccess={fetchVideos}
        />
      )}

      <BatchPublishModal
        open={batchModalOpen}
        videoIds={Array.from(selected)}
        onClose={() => setBatchModalOpen(false)}
        onSuccess={() => {
          setSelected(new Set());
          fetchVideos();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete video?"
        description="This removes the generated MP4 and its metadata sidecar from the video library. Existing data outside this video is untouched."
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteVideo}
      />
    </>
  );
};

export default VideoList;
