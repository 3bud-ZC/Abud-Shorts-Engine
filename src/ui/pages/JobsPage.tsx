import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Alert, Button, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "react-router-dom";
import {
  ActionMenu,
  ConfirmDialog,
  EmptyState,
  FilterTabs,
  LoadingState,
  PageHeader,
  ProgressDisplay,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { V2Job } from "./v2Types";

const groups = ["all", "running", "completed", "failed", "canceled"];

function duration(job: V2Job) {
  if (!job.startedAt) return "Not started";
  const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
  return `${Math.max(0, Math.round((end - new Date(job.startedAt).getTime()) / 1000))}s`;
}

const JobsPage: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: "cancel" | "retry"; job: V2Job } | null>(null);

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/jobs");
      setJobs(response.data.jobs || []);
      setError(null);
    } catch {
      setError("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesTab =
        tab === "all" ||
        (tab === "running" && !["ready", "failed", "canceled"].includes(job.status)) ||
        (tab === "completed" && job.status === "ready") ||
        job.status === tab;
      const haystack = `${job.title} ${job.templateId} ${job.brandName} ${job.currentStage}`.toLowerCase();
      return matchesTab && haystack.includes(query.toLowerCase());
    });
  }, [jobs, tab, query]);

  const runConfirmed = async () => {
    if (!confirm) return;
    const target = confirm;
    setConfirm(null);
    try {
      if (target.type === "cancel") {
        await axios.post(`/api/v2/jobs/${target.job.id}/cancel`);
        await load();
      } else {
        const response = await axios.post(`/api/v2/jobs/${target.job.id}/retry`);
        navigate(`/jobs/${response.data.job.id}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || "Job action failed.");
    }
  };

  if (loading) return <LoadingState label="Loading jobs..." />;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Track every V2 request from queue to rendered MP4."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>Create Video</Button>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <SectionCard>
        <Stack spacing={2}>
          <FilterTabs value={tab} onChange={setTab} options={groups} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search by title, brand, template, or stage" />
        </Stack>
      </SectionCard>
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {visibleJobs.map((job) => {
          const running = !["ready", "failed", "canceled"].includes(job.status);
          return (
            <SectionCard key={job.id}>
              <Stack spacing={1.25}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
                  <Stack spacing={0.5} minWidth={0}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="h6">{job.title || job.templateId || "Video job"}</Typography>
                      <StatusBadge status={job.status} />
                      {job.brandName && <StatusBadge status="default" label={job.brandName} />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Template: {job.templateId || "Manual"} · Started: {job.startedAt ? new Date(job.startedAt).toLocaleString() : "Not started"} · Duration: {duration(job)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button size="small" variant="outlined" onClick={() => navigate(`/jobs/${job.id}`)}>View</Button>
                    <ActionMenu
                      items={[
                        { label: "Cancel", disabled: !running, onClick: () => setConfirm({ type: "cancel", job }) },
                        { label: "Retry", disabled: !["failed", "canceled"].includes(job.status), onClick: () => setConfirm({ type: "retry", job }) },
                        { label: "Open Video", disabled: !job.output?.videoId, onClick: () => navigate(`/video/${job.output.videoId}`) },
                      ]}
                    />
                  </Stack>
                </Stack>
                <ProgressDisplay stage={job.currentStage} progress={job.progress} timestamp={job.updatedAt} message={job.error || "Waiting for next update."} />
              </Stack>
            </SectionCard>
          );
        })}
        {visibleJobs.length === 0 && (
          <EmptyState title="No jobs match this view" description="Use another filter or create a new video job." />
        )}
      </Stack>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.type === "cancel" ? "Cancel job?" : "Retry job?"}
        description={
          confirm?.type === "cancel"
            ? "Cancel is only available before terminal completion. The original job record will remain visible."
            : "Retry creates a new attempt and will not overwrite an existing successful video."
        }
        confirmLabel={confirm?.type === "cancel" ? "Cancel job" : "Create retry"}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmed}
      />
    </>
  );
};

export default JobsPage;
