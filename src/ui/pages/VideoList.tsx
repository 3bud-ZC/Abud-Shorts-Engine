import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
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
  StatCard,
  StatusBadge,
} from "../components/v2";
import { ReviewPublishModal } from "../components/publishing/ReviewPublishModal";
import { BatchPublishModal } from "../components/publishing/BatchPublishModal";
import type { VideoItem } from "./v2Types";
import { useI18n } from "../i18n";
import { withMediaAccessToken } from "../utils/auth";

function videoTitle(video: VideoItem): string {
  return (
    (video as any).title ||
    video.templateName ||
    video.brandName ||
    (video.originalPrompt ? video.originalPrompt.slice(0, 60) : "") ||
    `Video ${video.videoId.slice(0, 8)}`
  );
}

const VideoList: React.FC = () => {
  const navigate = useNavigate();
  const { t, format } = useI18n();

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [counts, setCounts] = useState<{ total: number; ready: number; createdThisWeek: number } | null>(null);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; displayName?: string; name?: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [brandName, setBrandName] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "longest" | "shortest">("newest");

  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [deleteTarget, setDeleteTarget] = useState<VideoItem | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [reviewVideo, setReviewVideo] = useState<VideoItem | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    Promise.allSettled([axios.get("/api/v2/brands"), axios.get("/api/v2/templates")]).then(
      ([brandRes, templateRes]) => {
        if (brandRes.status === "fulfilled") setBrands(brandRes.value.data.brands || []);
        if (templateRes.status === "fulfilled") setTemplates(templateRes.value.data.templates || []);
      },
    );
  }, []);

  const params = useMemo(
    () => ({
      search: debouncedQuery || undefined,
      language: language || undefined,
      aspectRatio: aspectRatio || undefined,
      brandName: brandName || undefined,
      sort,
      limit: 24,
    }),
    [debouncedQuery, language, aspectRatio, brandName, sort],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const id = ++requestId.current;
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const response = await axios.get("/api/videos", { params: { ...params, cursor } });
        if (id !== requestId.current) return;
        const incoming: VideoItem[] = response.data.videos || [];
        setVideos((prev) => (cursor ? [...prev, ...incoming] : incoming));
        setNextCursor(response.data.page?.nextCursor);
        setHasMore(Boolean(response.data.page?.hasMore));
        if (response.data.counts) setCounts(response.data.counts);
        setError(null);
      } catch {
        if (id === requestId.current) setError(t("errors.loadFailed", { resource: t("errors.sourceVideos") }));
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [params, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtersActive =
    Boolean(debouncedQuery) || Boolean(language) || Boolean(aspectRatio) || Boolean(brandName) || sort !== "newest";

  const resetFilters = () => {
    setQuery("");
    setLanguage("");
    setAspectRatio("");
    setBrandName("");
    setSort("newest");
  };

  const toggleSelected = (videoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(videoId) ? next.delete(videoId) : next.add(videoId);
      return next;
    });
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
      await load();
    } catch {
      setError(t("errors.loadFailed", { resource: t("errors.sourceVideos") }));
    }
  };

  if (loading && videos.length === 0) return <LoadingState label={t("common.loading")} />;

  const selectedCount = selected.size;
  const trulyEmpty = videos.length === 0 && !filtersActive && (counts?.total ?? 0) === 0;

  return (
    <>
      <PageHeader
        title={t("videos.title")}
        eyebrow={t("videos.eyebrow")}
        description={t("videos.description")}
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
            {t("create.title")}
          </Button>
        }
      />
      {feedback && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {counts && (
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={4}>
            <StatCard label={t("videos.count.total")} value={String(counts.total)} />
          </Grid>
          <Grid item xs={4}>
            <StatCard label={t("videos.count.ready")} value={String(counts.ready)} />
          </Grid>
          <Grid item xs={4}>
            <StatCard label={t("videos.count.thisWeek")} value={String(counts.createdThisWeek)} />
          </Grid>
        </Grid>
      )}

      {trulyEmpty ? (
        <EmptyState
          title={t("videos.emptyTitle")}
          description={t("videos.emptyHint")}
          action={
            <Button variant="contained" onClick={() => navigate("/create")}>
              {t("create.title")}
            </Button>
          }
        />
      ) : (
        <Stack spacing={2}>
          <SectionCard>
            <Stack spacing={1.5}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
                <SearchInput value={query} onChange={setQuery} placeholder={t("videos.searchPlaceholder")} />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={view}
                  onChange={(_, next) => next && setView(next)}
                >
                  <ToggleButton value="grid" aria-label={t("common.viewAll")}>
                    <GridViewIcon />
                  </ToggleButton>
                  <ToggleButton value="list" aria-label={t("common.viewDetails")}>
                    <ListIcon />
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Grid container spacing={1.5}>
                <Grid item xs={6} md={3}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("videos.language")}</InputLabel>
                    <Select label={t("videos.language")} value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <MenuItem value="">{t("common.all")}</MenuItem>
                      <MenuItem value="en">EN</MenuItem>
                      <MenuItem value="ar">AR</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("videos.aspect")}</InputLabel>
                    <Select label={t("videos.aspect")} value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                      <MenuItem value="">{t("common.all")}</MenuItem>
                      <MenuItem value="9:16">9:16</MenuItem>
                      <MenuItem value="16:9">16:9</MenuItem>
                      <MenuItem value="1:1">1:1</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("brands.title")}</InputLabel>
                    <Select label={t("brands.title")} value={brandName} onChange={(e) => setBrandName(e.target.value)}>
                      <MenuItem value="">{t("common.all")}</MenuItem>
                      {brands.map((brand) => (
                        <MenuItem key={brand.id} value={brand.name}>
                          {brand.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} md={3}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("videos.sort")}</InputLabel>
                    <Select label={t("videos.sort")} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                      <MenuItem value="newest">{t("videos.sortNewest")}</MenuItem>
                      <MenuItem value="oldest">{t("videos.sortOldest")}</MenuItem>
                      <MenuItem value="longest">{t("videos.sortLongest")}</MenuItem>
                      <MenuItem value="shortest">{t("videos.sortShortest")}</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {filtersActive && (
                  <Grid item xs={12}>
                    <Button onClick={resetFilters}>{t("videos.resetFilters")}</Button>
                  </Grid>
                )}
              </Grid>
            </Stack>
          </SectionCard>

          {selectedCount > 0 && (
            <SectionCard>
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                <Typography variant="body2" fontWeight={800}>
                  {selectedCount}
                </Typography>
                <Button size="small" variant="contained" startIcon={<SendIcon />} onClick={() => setBatchModalOpen(true)}>
                  {t("videos.publish")}
                </Button>
                <Button size="small" onClick={() => setSelected(new Set())}>
                  {t("common.cancel")}
                </Button>
              </Stack>
            </SectionCard>
          )}

          <Grid container spacing={2}>
            {videos.map((video) => {
              const isReady = video.status === "ready";
              const checked = selected.has(video.videoId);
              return (
                <Grid
                  item
                  xs={12}
                  md={view === "list" ? 12 : 6}
                  xl={view === "list" ? 12 : 4}
                  key={video.videoId}
                >
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
                            src={withMediaAccessToken(video.thumbnailUrl || `/api/videos/${video.videoId}/thumbnail`)}
                            alt={t("videos.thumbnailAlt", { title: videoTitle(video) })}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", color: "white" }}>
                            <StatusBadge status={video.status} />
                          </Stack>
                        )}
                      </Box>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Stack minWidth={0}>
                          <Typography variant="h6" noWrap>
                            {videoTitle(video)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {[
                              video.brandName,
                              video.durationSeconds ? format.duration(video.durationSeconds) : null,
                              video.language ? video.language.toUpperCase() : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Typography>
                        </Stack>
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleSelected(video.videoId)}
                          inputProps={{ "aria-label": videoTitle(video) }}
                        />
                      </Stack>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        <StatusBadge status={video.status} />
                        {video.aspectRatio && <StatusBadge status="default" label={video.aspectRatio} />}
                        {(video as any).hasTechnicalQuality && video.technicalScore !== undefined && (
                          <StatusBadge status="success" label={`${video.technicalScore}/100`} />
                        )}
                        <StatusBadge status="default" label={format.date(video.createdAt)} />
                      </Stack>
                      <Stack direction="row" spacing={1} justifyContent="space-between">
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            startIcon={<OpenInNewIcon />}
                            disabled={!isReady}
                            onClick={() => navigate(`/video/${video.videoId}`)}
                          >
                            {t("common.preview")}
                          </Button>
                          <Button
                            size="small"
                            startIcon={<SendIcon />}
                            disabled={!isReady}
                            onClick={() => setReviewVideo(video)}
                          >
                            {t("videos.publish")}
                          </Button>
                          <Button
                            size="small"
                            startIcon={<DownloadIcon />}
                            component="a"
                            href={withMediaAccessToken(video.downloadUrl)}
                            disabled={!isReady}
                          >
                            {t("videos.download")}
                          </Button>
                        </Stack>
                        <ActionMenu
                          items={[
                            {
                              label: t("videos.viewProduction"),
                              onClick: () => navigate(`/jobs/${video.videoId}`),
                            },
                            { label: t("common.delete"), onClick: () => setDeleteTarget(video) },
                          ]}
                        />
                      </Stack>
                    </Stack>
                  </SectionCard>
                </Grid>
              );
            })}
          </Grid>

          {videos.length === 0 && (
            <EmptyState
              title={t("videos.emptyFiltered")}
              description={t("videos.emptyFilteredHint")}
              action={
                <Button variant="outlined" onClick={resetFilters}>
                  {t("videos.resetFilters")}
                </Button>
              }
            />
          )}

          {hasMore && (
            <Button
              variant="outlined"
              disabled={loadingMore}
              onClick={() => load(nextCursor)}
              sx={{ alignSelf: "center" }}
            >
              {loadingMore ? t("common.loading") : t("videos.loadMore")}
            </Button>
          )}
          {!hasMore && videos.length > 0 && (
            <Chip label={t("videos.endOfList")} variant="outlined" sx={{ alignSelf: "center" }} />
          )}
        </Stack>
      )}

      {reviewVideo && (
        <ReviewPublishModal
          open={Boolean(reviewVideo)}
          video={reviewVideo}
          onClose={() => setReviewVideo(null)}
          onSuccess={load}
        />
      )}

      <BatchPublishModal
        open={batchModalOpen}
        videoIds={Array.from(selected)}
        onClose={() => setBatchModalOpen(false)}
        onSuccess={() => {
          setSelected(new Set());
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("videos.deleteConfirm")}
        description={t("videos.deleteConfirmBody")}
        confirmLabel={t("common.delete")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteVideo}
      />
    </>
  );
};

export default VideoList;
