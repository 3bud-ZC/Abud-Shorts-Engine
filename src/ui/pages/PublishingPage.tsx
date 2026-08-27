import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
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
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
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
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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
import { useT } from "../i18n";
import { AccountConnectModal } from "../components/publishing/AccountConnectModal";
import { withMediaAccessToken } from "../utils/auth";
import type {
  Publication,
  PublishingPlatform,
  PublishingStatus,
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
      return <span style={{ fontWeight: 900, color: "#000" }}>TT</span>;
    default:
      return <SendIcon />;
  }
}

export const PublishingPage: React.FC = () => {
  const navigate = useNavigate();
  const tr = useT();
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
    } catch (err: any) {
      setFeedback({ type: "error", message: "Failed to load publishing data." });
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
      setFeedback({ type: "error", message: "Failed to test account connection." });
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Are you sure you want to disconnect this social account?")) return;
    try {
      await axios.delete(`/api/v2/publishing/accounts/${id}`);
      setFeedback({ type: "success", message: "Account disconnected." });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: "Failed to disconnect account." });
    }
  };

  const handleRetry = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/retry`);
      setFeedback({ type: "success", message: "Retry initiated." });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: "Retry request failed." });
    }
  };

  const handleCancel = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/cancel`);
      setFeedback({ type: "info", message: "Publication canceled." });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: "Failed to cancel publication." });
    }
  };

  const handlePublishNow = async (pubId: string) => {
    try {
      await axios.post(`/api/v2/publishing/publications/${pubId}/publish`);
      setFeedback({ type: "success", message: "Immediate publish dispatched." });
      fetchData();
    } catch {
      setFeedback({ type: "error", message: "Publish request failed." });
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

  if (loading) return <LoadingState label="Loading distribution engine..." />;

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
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setConnectModalOpen(true)}
            >
              Connect Account
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
                  Scheduled Posts
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
                  Publishing Now
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
                  Published Today
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
                  Failed Publications
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

      {/* Tabs */}
      {/* Five tab labels need about 560px. Left as the default fixed variant
          they pushed the whole page to 450px wide inside a 390px phone frame,
          which is the one horizontal overflow in the client. Every other Tabs
          in the app is already scrollable. */}
      <Tabs
        value={tab}
        onChange={(_, val) => setTab(val)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="overview" label="Overview" />
        <Tab value="scheduled" label={`Scheduled (${summary?.scheduledCount || 0})`} />
        <Tab value="published" label="Published" />
        <Tab value="failed" label={`Failed (${summary?.failedCount || 0})`} />
        <Tab value="accounts" label={`Social Accounts (${accounts.length})`} />
      </Tabs>

      {/* Filter Bar. A 280px search box beside a platform select cannot sit on
          one row in a 390px phone frame; as a nowrap row it pushed the page 60px
          wide. It stacks on small screens and sits side by side from `sm` up. */}
      {tab !== "accounts" && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ mb: 2, flexWrap: "wrap" }}
        >
          <TextField
            size="small"
            placeholder="Search by title, prompt, or video ID..."
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
            <MenuItem value="">All Platforms</MenuItem>
            <MenuItem value="youtube">YouTube</MenuItem>
            <MenuItem value="tiktok">TikTok</MenuItem>
            <MenuItem value="instagram">Instagram</MenuItem>
            <MenuItem value="facebook">Facebook</MenuItem>
            <MenuItem value="telegram">Telegram</MenuItem>
            <MenuItem value="twitter">X / Twitter</MenuItem>
          </Select>
        </Stack>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW                                                           */}
      {/* ========================================================================= */}
      {tab === "overview" && (
        <Stack spacing={3}>
          <SectionCard
            title="Recent Publications & Dispatches"
            description="Live distribution activity across connected channels."
          >
            {publications.length === 0 ? (
              <EmptyState
                title="Nothing published yet"
                description="Open a finished video and choose Publish to send it to your connected accounts."
                action={
                  <Button variant="contained" onClick={() => navigate("/videos")}>
                    Go to Video Library
                  </Button>
                }
              />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Platform</TableCell>
                      <TableCell>Title / Video</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Time / Schedule</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPublications.slice(0, 15).map((pub) => (
                      <TableRow key={pub.id}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {getPlatformIcon(pub.platform)}
                            <Typography variant="body2" fontWeight={700} sx={{ textTransform: "capitalize" }}>
                              {pub.platform}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 260 }}>
                            {pub.title || pub.caption || pub.videoId}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ID: {pub.videoId.slice(0, 12)}...
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{pub.accountName || "Default"}</Typography>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={pub.status} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {pub.publishedAt
                              ? `Published: ${new Date(pub.publishedAt).toLocaleTimeString()}`
                              : pub.scheduledAt
                                ? `Due: ${new Date(pub.scheduledAt).toLocaleString()} (${pub.sourceTimezone})`
                                : new Date(pub.createdAt).toLocaleDateString()}
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
                                View Post
                              </Button>
                            )}
                            {pub.status === "failed" && (
                              <Button size="small" variant="outlined" onClick={() => handleRetry(pub.id)}>
                                Retry
                              </Button>
                            )}
                            {pub.status === "scheduled" && (
                              <Button size="small" onClick={() => handlePublishNow(pub.id)}>
                                Publish Now
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

      {/* ========================================================================= */}
      {/* TAB 2: SCHEDULED                                                          */}
      {/* ========================================================================= */}
      {tab === "scheduled" && (
        <SectionCard
          title="Scheduled Publications"
          description="Scheduled posts are saved safely and continue after application restarts."
        >
          {scheduledList.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="Schedule a post from any finished video and it will appear here until it goes out."
              action={
                <Button variant="contained" onClick={() => navigate("/videos")}>
                  Go to Video Library
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
                          Target: {pub.platform.toUpperCase()} · Account: {pub.accountName || "Default"} · Timezone: {pub.sourceTimezone}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={2} alignItems="center">
                      <Chip
                        icon={<ScheduleIcon />}
                        label={`Scheduled: ${new Date(pub.scheduledAt || pub.createdAt).toLocaleString()}`}
                        color="primary"
                        variant="outlined"
                      />
                      <Button size="small" variant="contained" onClick={() => handlePublishNow(pub.id)}>
                        Publish Now
                      </Button>
                      <Button size="small" color="error" onClick={() => handleCancel(pub.id)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </SectionCard>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: PUBLISHED                                                          */}
      {/* ========================================================================= */}
      {tab === "published" && (
        <SectionCard
          title="Published Posts Feed"
          description="Videos successfully distributed to social platforms."
        >
          {publishedList.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              No published posts recorded yet.
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
                          <Typography variant="subtitle2" fontWeight={800} sx={{ textTransform: "capitalize" }}>
                            {pub.platform}
                          </Typography>
                        </Stack>
                        <StatusBadge status="ready" label="Published" />
                      </Stack>

                      <Typography variant="body2" fontWeight={700}>
                        {pub.title || pub.caption || "Social Short"}
                      </Typography>

                      <Typography variant="caption" color="text.secondary">
                        Published at: {new Date(pub.publishedAt || pub.updatedAt).toLocaleString()}
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
                          Open Published Post
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

      {/* ========================================================================= */}
      {/* TAB 4: FAILED                                                             */}
      {/* ========================================================================= */}
      {tab === "failed" && (
        <SectionCard
          title="Failed Publications"
          description="Publications that encountered errors. Isolated per platform."
        >
          {failedList.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
              Zero failed publications. Everything is healthy!
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
                          {pub.platform.toUpperCase()} Publication Failed
                        </Typography>
                      </Stack>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleRetry(pub.id)}
                      >
                        Retry Now
                      </Button>
                    </Stack>

                    <Alert severity="error">
                      <strong>Reason:</strong> {pub.lastError || "Unknown publish error."}
                    </Alert>

                    {pub.technicalError && (
                      <Accordion variant="outlined">
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="caption" fontWeight={700}>
                            Technical Error Diagnostics
                          </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>
                            {pub.technicalError}
                          </pre>
                        </AccordionDetails>
                      </Accordion>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </SectionCard>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: SOCIAL ACCOUNTS                                                    */}
      {/* ========================================================================= */}
      {tab === "accounts" && (
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1" fontWeight={800}>
              Connected Publishing Accounts ({accounts.length})
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setConnectModalOpen(true)}
            >
              Connect New Account
            </Button>
          </Stack>

          {accounts.length === 0 ? (
            <Card variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="body1" color="text.secondary" gutterBottom>
                No social accounts connected yet.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setConnectModalOpen(true)}
                sx={{ mt: 1 }}
              >
                Connect Your First Social Channel
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
                          <Typography variant="subtitle2" fontWeight={800} sx={{ textTransform: "capitalize" }}>
                            {acc.platform}
                          </Typography>
                        </Stack>
                        <Chip
                          size="small"
                          color={acc.connectionStatus === "connected" ? "success" : "error"}
                          label={acc.connectionStatus}
                        />
                      </Stack>

                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          {acc.accountName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ID: {acc.accountId} · Provider: {acc.provider}
                        </Typography>
                      </Box>

                      <Typography variant="caption" color="text.secondary">
                        Last Checked: {new Date(acc.lastCheckedAt).toLocaleString()}
                      </Typography>

                      <Divider />

                      <Stack direction="row" spacing={1} justifyContent="space-between">
                        <Button size="small" variant="outlined" onClick={() => handleTestAccount(acc.id)}>
                          Test Connection
                        </Button>
                        <Button size="small" color="error" onClick={() => handleDeleteAccount(acc.id)}>
                          Disconnect
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
          setFeedback({ type: "success", message: "Account connected successfully!" });
          fetchData();
        }}
      />
    </>
  );
};
export default PublishingPage;
