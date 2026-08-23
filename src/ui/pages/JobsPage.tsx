import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { Alert, Box, Button, Grid, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "react-router-dom";
import {
  bidiProps,
  isArabicText,
  ActionMenu,
  ConfirmDialog,
  EmptyState,
  ErrorBoundary,
  FilterTabs,
  JobsListSkeleton,
  PageHeader,
  RecentJobCard,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type { V2Job } from "./v2Types";

const groups = ["all", "active", "ready", "failed", "canceled"];

const JobsPageContent: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<V2Job[]>([]);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: "cancel" | "retry"; job: V2Job } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await axios.get("/api/v2/jobs", { params: { limit: 1000 } });
      setJobs(response.data.jobs || []);
      setError(null);
    } catch {
      setError("Failed to load jobs from database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesTab =
        tab === "all" ||
        (tab === "active" && !["ready", "failed", "canceled"].includes(job.status)) ||
        (tab === "ready" && job.status === "ready") ||
        job.status === tab;
      const haystack = `${job.title || ""} ${job.templateId || ""} ${job.brandName || ""} ${job.currentStage || ""}`.toLowerCase();
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

  if (loading && jobs.length === 0) {
    return <JobsListSkeleton />;
  }

  return (
    <>
      <PageHeader
        title="Jobs"
        eyebrow="Pipeline Orchestration"
        description="Track, inspect, and manage every video creation request from prompt to completed video."
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate("/create")}>
              Create Video
            </Button>
          </Stack>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <SectionCard>
        <Stack spacing={2}>
          <FilterTabs value={tab} onChange={setTab} options={groups} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search by title, brand, template, or stage..." />
        </Stack>
      </SectionCard>

      <Stack spacing={1.5} sx={{ mt: 2.5 }}>
        {visibleJobs.map((job) => {
          const running = !["ready", "failed", "canceled"].includes(job.status);
          return (
            <Box key={job.id} sx={{ position: "relative" }}>
              <RecentJobCard
                job={job}
                onClick={() => navigate(`/jobs/${job.id}`)}
              />
            </Box>
          );
        })}

        {visibleJobs.length === 0 && (
          <EmptyState
            title="No jobs match this filter"
            description="Try selecting a different status tab or clearing your search term."
            action={
              <Button variant="outlined" onClick={() => { setTab("all"); setQuery(""); }}>
                Reset Filters
              </Button>
            }
          />
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

export const JobsPage: React.FC = () => {
  return (
    <ErrorBoundary fallbackTitle="Jobs Page Error">
      <JobsPageContent />
    </ErrorBoundary>
  );
};

export default JobsPage;
