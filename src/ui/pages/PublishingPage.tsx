import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SendIcon from "@mui/icons-material/Send";
import YouTubeIcon from "@mui/icons-material/YouTube";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import TelegramIcon from "@mui/icons-material/Telegram";
import TwitterIcon from "@mui/icons-material/Twitter";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "../components/v2";
import { useI18n } from "../i18n";
import { AccountConnectModal } from "../components/publishing/AccountConnectModal";
import { withMediaAccessToken } from "../utils/auth";
import type {
  Publication,
  PublishingPlatform,
  PublishingSummary,
  SocialAccount,
} from "./v2Types";

function getPlatformIcon(platform: PublishingPlatform) {
  switch (platform) {
    case "youtube":
      return <YouTubeIcon sx={{ color: "#ff0000" }} />;
    case "instagram":
      return <InstagramIcon sx={{ color: "#e1306c" }} />;
    case "facebook":
      return <FacebookIcon sx={{ color: "#1877f2" }} />;
    case "telegram":
      return <TelegramIcon sx={{ color: "#229ed9" }} />;
    case "twitter":
      return <TwitterIcon sx={{ color: "#1da1f2" }} />;
    case "tiktok":
      return <span style={{ fontWeight: 900 }}>TT</span>;
    default:
      return <SendIcon />;
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X / Twitter",
};

const PROVIDER_LABEL: Record<string, string> = {
  youtube_direct: "YouTube",
  meta_direct: "Meta",
  tiktok_direct: "TikTok",
  telegram_bot: "Telegram Bot",
  upload_post: "Upload-Post",
};

export const PublishingPage: React.FC = () => {
  const navigate = useNavigate();
  const { t: tr, format } = useI18n();
  const [tab, setTab] = useState<"overview" | "scheduled" | "published" | "failed" | "accounts">("overview");
  const [summary, setSummary] = useState<PublishingSummary | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Filters
  const [filterPlatform, setFilterPlatform] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const platformName = (platform: string) => PLATFORM_LABEL[platform] || platform;
  const providerName = (provider: string) => PROVIDER_LABEL[provider] || provider;

  const fetchData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [sumRes, pubRes, accRes] = await Promise.all([
        axios.get("/api/v2/publishing/summary"),
        axios.get("/api/v2/publishing/publications?limit=100"),
        axios.get("/api/v2/publishing/accounts"),
      ]);
      setSummary(sumRes.data);
      setPublications(pubRes.data.publications || []);
      setAccounts(accRes.data.accounts || []);
    } catch {
      setFeedback({ type: "error", message: tr("publishing.loadFailed") });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();

    // SSE connection for live updates
    // EventSource cannot send an Authorization header, so the session token
    // travels as the access_token query parameter the API already accepts.
    // Without this the live publishing stream silently 401s forever.
    const eventSource = new EventSource(withMediaAccessToken("/api/v2/publishing/events"));
    eventSource.onmessage = () => {
      fetchData();
    };
    eventSource.addEventListener("publishing-event", () => {
      fetchData();
    });

    return () => {
      eventSource.close();
    };
  }, []);

  const handleTestAccount = async (id: string) => {
    try {
      const res = await axios.post(`/api/v2/publishing/accounts/${id}/test`);
      setFeedback({
        type: res.data.healthy ? "success" : "error",
        message: `${res.data.account.accountName}: ${res.data.message}`,
      });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: tr("publishing.msg.testFailed") });
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm(tr("publishing.accounts.disconnectConfirm"))) return;
    try {
      await axios.delete(`/api/v2/publishing/accounts/${id}`);
      setFeedback({ type: "success", message: tr("publishing.msg.accountDisconnected") });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: tr("publishing.msg.disconnectFailed") });
    }
  };

  const handleRetry = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/retry`);
      setFeedback({ type: "success", message: tr("publishing.msg.retryStarted") });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: tr("publishing.msg.retryFailed") });
    }
  };

  const handleCancel = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/cancel`);
      setFeedback({ type: "info", message: tr("publishing.msg.cancelled") });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: tr("publishing.msg.cancelFailed") });
    }
  };

  const handlePublishNow = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/publish`);
      setFeedback({ type: "success", message: tr("publishing.msg.publishDispatched") });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: tr("publishing.msg.publishFailed") });
    }
  };

  const filteredPublications = publications.filter((p) => {
    if (filterPlatform && p.platform !== filterPlatform) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (p.title || "").toLowerCase().includes(q);
      const matchCaption = (p.caption || "").toLowerCase().includes(q);
      const matchVideo = p.videoId.toLowerCase().includes(q);
      if (!matchTitle && !matchCaption && !matchVideo) return false;
    }
    return true;
  });

  const scheduledList = filteredPublications.filter((p) => p.status === "scheduled");
  const publishedList = filteredPublications.filter((p) => p.status === "published");
  const failedList = filteredPublications.filter((p) => p.status === "failed");

  if (loading) return <LoadingState label={tr("publishing.loading")} />;

  return (
    <>
      <PageHeader
        title={tr("publishing.title")}
        eyebrow={tr("publishing.eyebrow")}
        description={tr("publishing.description")}
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<RefreshIcon />}
              onClick={() => fetchData(true)}
              disabled={refreshing}
            >
              {refreshing ? tr("common.refreshing") : tr("common.refresh")}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setConnectModalOpen(true)}
            >
              {tr("publishing.connectAccount")}
            </Button>
          </Stack>
        }
      />

      {feedback && (
        <Alert
          severity={feedback.type}
          sx={{ mb: 2 }}
          onClose={() => setFeedback(null)}
        >
          {feedback.message}
        </Alert>
      )}

      {/* Overview Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card
            variant="outlined"
            sx={{
              p: 2,
              cursor: "pointer",
              bgcolor: tab === "scheduled" ? "action.selected" : "background.paper",
            }}
            onClick={() => setTab("scheduled")}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {tr("publishing.stat.scheduled")}
                </Typography>
                <Typography variant="h4" fontWeight={850} color="primary.main">
                  {summary?.scheduledCount || 0}
                </Typography>
              </Box>
              <ScheduleIcon color="primary" sx={{ fontSize: 32 }} />
            </Stack>
          </Card>
        </Grid>

        <Grid item xs={6} sm={3}>
          <Card variant="outlined" sx={{ p: 2, bgcolor: "background.paper" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {tr("publishing.stat.publishingNow")}
                </Typography>
                <Typography variant="h4" fontWeight={850} color="info.main">
                  {summary?.publishingCount || 0}
                </Typography>
              </Box>
              <CircularProgress size={28} sx={{ color: "info.main" }} />
            </Stack>
          </Card>
        </Grid>

        <Grid item xs={6} sm={3}>
          <Card
            variant="outlined"
            sx={{
              p: 2,
              cursor: "pointer",
              bgcolor: tab === "published" ? "action.selected" : "background.paper",
            }}
            onClick={() => setTab("published")}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {tr("publishing.stat.publishedToday")}
                </Typography>
                <Typography variant="h4" fontWeight={850} color="success.main">
                  {summary?.publishedTodayCount || 0}
                </Typography>
              </Box>
              <CheckCircleIcon color="success" sx={{ fontSize: 32 }} />
            </Stack>
          </Card>
        </Grid>

        <Grid item xs={6} sm={3}>
          <Card
            variant="outlined"
            sx={{
              p: 2,
              cursor: "pointer",
              bgcolor: tab === "failed" ? "action.selected" : "background.paper",
            }}
            onClick={() => setTab("failed")}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {tr("publishing.stat.failed")}
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight={850}
                  color={(summary?.failedCount || 0) > 0 ? "error.main" : "text.secondary"}
                >
                  {summary?.failedCount || 0}
                </Typography>
              </Box>
              <ErrorIcon color={(summary?.failedCount || 0) > 0 ? "error" : "disabled"} sx={{ fontSize: 32 }} />
            </Stack>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs — scrollable so five labels never force horizontal page overflow. */}
      <Tabs
        value={tab}
        onChange={(_, val) => setTab(val)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="overview" label={tr("publishing.tab.overview")} />
        <Tab value="scheduled" label={tr("publishing.tab.scheduled", { count: summary?.scheduledCount || 0 })} />
        <Tab value="published" label={tr("publishing.tab.published")} />
        <Tab value="failed" label={tr("publishing.tab.failed", { count: summary?.failedCount || 0 })} />
        <Tab value="accounts" label={tr("publishing.tab.accounts", { count: accounts.length })} />
      </Tabs>

      {/* Filter bar — stacks on a phone, sits side by side from `sm` up. */}
      {tab !== "accounts" && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ mb: 2, flexWrap: "wrap" }}
        >
          <TextField
            size="small"
            placeholder={tr("publishing.filter.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ minWidth: { xs: 0, sm: 280 }, width: { xs: "100%", sm: "auto" } }}
          />
          <Select
            size="small"
            displayEmpty
            value={filterPlatform}
            onChange={(e) => setFilterPlatform(e.target.value)}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <MenuItem value="">{tr("publishing.filter.allPlatforms")}</MenuItem>
            <MenuItem value="youtube">YouTube</MenuItem>
            <MenuItem value="tiktok">TikTok</MenuItem>
            <MenuItem value="instagram">Instagram</MenuItem>
            <MenuItem value="facebook">Facebook</MenuItem>
            <MenuItem value="telegram">Telegram</MenuItem>
            <MenuItem value="twitter">X / Twitter</MenuItem>
          </Select>
        </Stack>
      )}

      {/* ================================ OVERVIEW ================================ */}
      {tab === "overview" && (
        <Stack spacing={3}>
          <SectionCard
            title={tr("publishing.overview.title")}
            description={tr("publishing.overview.description")}
          >
            {publications.length === 0 ? (
              <EmptyState
                title={tr("publishing.overview.empty")}
                description={tr("publishing.overview.emptyBody")}
                action={
                  <Button variant="contained" onClick={() => navigate("/videos")}>
                    {tr("publishing.goToLibrary")}
                  </Button>
                }
              />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{tr("publishing.table.platform")}</TableCell>
                      <TableCell>{tr("publishing.table.titleVideo")}</TableCell>
                      <TableCell>{tr("publishing.table.account")}</TableCell>
                      <TableCell>{tr("publishing.table.status")}</TableCell>
                      <TableCell>{tr("publishing.table.timeSchedule")}</TableCell>
                      <TableCell align="right">{tr("publishing.table.actions")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPublications.slice(0, 15).map((pub) => (
                      <TableRow key={pub.id}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {getPlatformIcon(pub.platform)}
                            <Typography variant="body2" fontWeight={700}>
                              {platformName(pub.platform)}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 260 }}>
                            {pub.title || pub.caption || pub.videoId}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ textAlign: "start", display: "block" }}>
                            {tr("publishing.idPrefix", { id: pub.videoId.slice(0, 12) })}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{pub.accountName || tr("publishing.defaultAccount")}</Typography>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={pub.status} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {pub.publishedAt
                              ? tr("publishing.publishedAtTime", { time: format.time(pub.publishedAt) })
                              : pub.scheduledAt
                                ? tr("publishing.dueAt", {
                                    time: format.dateTime(pub.scheduledAt),
                                    timezone: pub.sourceTimezone,
                                  })
                                : format.date(pub.createdAt)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            {pub.providerUrl && (
                              <Button
                                size="small"
                                component="a"
                                href={pub.providerUrl}
                                target="_blank"
                                rel="noreferrer"
                                startIcon={<OpenInNewIcon />}
                              >
                                {tr("publishing.viewPost")}
                              </Button>
                            )}
                            {pub.status === "failed" && (
                              <Button size="small" variant="outlined" onClick={() => handleRetry(pub.id)}>
                                {tr("publishing.retry")}
                              </Button>
                            )}
                            {pub.status === "scheduled" && (
                              <Button size="small" onClick={() => handlePublishNow(pub.id)}>
                                {tr("publishing.publishNow")}
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </SectionCard>
        </Stack>
      )}

      {/* ================================ SCHEDULED ================================ */}
      {tab === "scheduled" && (
        <SectionCard
          title={tr("publishing.scheduledTab.title")}
          description={tr("publishing.scheduledTab.description")}
        >
          {scheduledList.length === 0 ? (
            <EmptyState
              title={tr("publishing.scheduledTab.empty")}
              description={tr("publishing.scheduledTab.emptyBody")}
              action={
                <Button variant="contained" onClick={() => navigate("/videos")}>
                  {tr("publishing.goToLibrary")}
                </Button>
              }
            />
          ) : (
            <Stack spacing={1.5}>
              {scheduledList.map((pub) => (
                <Card key={pub.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
                    <Stack direction="row" spacing={2} alignItems="center">
                      {getPlatformIcon(pub.platform)}
                      <Box>
                        <Typography variant="subtitle2" fontWeight={800}>
                          {pub.title || pub.videoId}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {tr("publishing.scheduledTab.target", {
                            platform: platformName(pub.platform),
                            account: pub.accountName || tr("publishing.defaultAccount"),
                            timezone: pub.sourceTimezone,
                          })}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={2} alignItems="center">
                      <Chip
                        icon={<ScheduleIcon />}
                        label={tr("publishing.scheduledTab.scheduledFor", {
                          time: format.dateTime(pub.scheduledAt || pub.createdAt),
                        })}
                        color="primary"
                        variant="outlined"
                      />
                      <Button size="small" variant="contained" onClick={() => handlePublishNow(pub.id)}>
                        {tr("publishing.publishNow")}
                      </Button>
                      <Button size="small" color="error" onClick={() => handleCancel(pub.id)}>
                        {tr("common.cancel")}
                      </Button>
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </SectionCard>
      )}

      {/* ================================ PUBLISHED ================================ */}
      {tab === "published" && (
        <SectionCard
          title={tr("publishing.publishedTab.title")}
          description={tr("publishing.publishedTab.description")}
        >
          {publishedList.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              {tr("publishing.publishedTab.empty")}
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {publishedList.map((pub) => (
                <Grid item xs={12} md={6} key={pub.id}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Stack direction="row" spacing={1} alignItems="center">
                          {getPlatformIcon(pub.platform)}
                          <Typography variant="subtitle2" fontWeight={800}>
                            {platformName(pub.platform)}
                          </Typography>
                        </Stack>
                        <StatusBadge status="published" />
                      </Stack>

                      <Typography variant="body2" fontWeight={700}>
                        {pub.title || pub.caption || tr("publishing.publishedTab.untitled")}
                      </Typography>

                      <Typography variant="caption" color="text.secondary">
                        {tr("publishing.publishedTab.publishedAt", {
                          time: format.dateTime(pub.publishedAt || pub.updatedAt),
                        })}
                      </Typography>

                      {pub.providerUrl && (
                        <Button
                          component="a"
                          href={pub.providerUrl}
                          target="_blank"
                          rel="noreferrer"
                          variant="outlined"
                          size="small"
                          startIcon={<OpenInNewIcon />}
                        >
                          {tr("publishing.publishedTab.openPost")}
                        </Button>
                      )}
                    </Stack>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </SectionCard>
      )}

      {/* ================================ FAILED ================================ */}
      {tab === "failed" && (
        <SectionCard
          title={tr("publishing.failedTab.title")}
          description={tr("publishing.failedTab.description")}
        >
          {failedList.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              {tr("publishing.failedTab.empty")}
            </Typography>
          ) : (
            <Stack spacing={2}>
              {failedList.map((pub) => (
                <Card key={pub.id} variant="outlined" sx={{ p: 2, borderColor: "error.light" }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Stack direction="row" spacing={1} alignItems="center">
                        {getPlatformIcon(pub.platform)}
                        <Typography variant="subtitle2" fontWeight={800}>
                          {tr("publishing.failedTab.heading", { platform: platformName(pub.platform) })}
                        </Typography>
                      </Stack>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleRetry(pub.id)}
                      >
                        {tr("publishing.failedTab.retryNow")}
                      </Button>
                    </Stack>

                    <Alert severity="error">
                      <strong>{tr("publishing.failedTab.reason")}</strong>{" "}
                      {pub.lastError || tr("publishing.failedTab.unknownError")}
                    </Alert>

                    <Typography variant="caption" color="text.secondary">
                      {tr("publishing.failedTab.supportNote")}
                    </Typography>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </SectionCard>
      )}

      {/* ================================ ACCOUNTS ================================ */}
      {tab === "accounts" && (
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Typography variant="subtitle1" fontWeight={800}>
              {tr("publishing.accounts.title", { count: accounts.length })}
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setConnectModalOpen(true)}
            >
              {tr("publishing.connectNewAccount")}
            </Button>
          </Stack>

          {accounts.length === 0 ? (
            <Card variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                {tr("publishing.accounts.empty")}
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setConnectModalOpen(true)}
                sx={{ mt: 1 }}
              >
                {tr("publishing.connectFirstAccount")}
              </Button>
            </Card>
          ) : (
            <Grid container spacing={2}>
              {accounts.map((acc) => (
                <Grid item xs={12} sm={6} md={4} key={acc.id}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Stack direction="row" spacing={1} alignItems="center">
                          {getPlatformIcon(acc.platform)}
                          <Typography variant="subtitle2" fontWeight={800}>
                            {platformName(acc.platform)}
                          </Typography>
                        </Stack>
                        <StatusBadge status={acc.connectionStatus} />
                      </Stack>

                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          {acc.accountName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ textAlign: "start", display: "block" }}>
                          {tr("publishing.accounts.identityProvider", {
                            identity: acc.accountIdentitySafeLabel || acc.accountName || acc.accountId,
                            provider: providerName(acc.provider),
                          })}
                        </Typography>
                      </Box>

                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {acc.connectionVerified && (
                          <Chip
                            size="small"
                            color="success"
                            variant="outlined"
                            label={tr("publishing.accounts.connectionVerified")}
                          />
                        )}
                        {!acc.publicationVerified && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={tr("publishing.accounts.publicationNotVerified")}
                          />
                        )}
                      </Stack>

                      <Typography variant="caption" color="text.secondary">
                        {tr("publishing.accounts.lastChecked", { time: format.dateTime(acc.lastCheckedAt) })}
                      </Typography>

                      <Divider />

                      <Stack direction="row" spacing={1} justifyContent="space-between">
                        <Button size="small" variant="outlined" onClick={() => handleTestAccount(acc.id)}>
                          {tr("common.testConnection")}
                        </Button>
                        <Button size="small" color="error" onClick={() => handleDeleteAccount(acc.id)}>
                          {tr("common.disconnect")}
                        </Button>
                      </Stack>
                    </Stack>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Stack>
      )}

      <AccountConnectModal
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        onSuccess={() => {
          setFeedback({ type: "success", message: tr("publishing.msg.accountConnected") });
          fetchData();
        }}
      />
    </>
  );
};
export default PublishingPage;
