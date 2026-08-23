import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Alert, Button, Grid, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useNavigate } from "react-router-dom";
import { EmptyState, LoadingState, PageHeader, SearchInput, SectionCard, StatusBadge } from "../components/v2";
import type { BusinessTemplateOption } from "./v2Types";

const TemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<BusinessTemplateOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    axios.get("/api/v2/templates")
      .then((response) => setTemplates(response.data.templates || []))
      .catch(() => setError("Failed to load templates."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return templates.filter((template) =>
      `${template.displayName} ${template.description} ${template.targetUseCase}`.toLowerCase().includes(q),
    );
  }, [templates, query]);

  if (loading) return <LoadingState label="Loading templates..." />;

  return (
    <>
      <PageHeader
        title="Templates"
        description="Business templates are read from the shared backend definitions used by the renderer."
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <SectionCard>
        <SearchInput value={query} onChange={setQuery} placeholder="Search templates by use case or description" />
      </SectionCard>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        {filtered.map((template) => (
          <Grid item xs={12} md={6} xl={4} key={template.id}>
            <SectionCard
              title={template.displayName}
              description={template.targetUseCase}
              actions={<StatusBadge status="ready" label={`${template.fields.length} fields`} />}
            >
              <Stack spacing={1.25}>
                <Typography color="text.secondary">{template.description}</Typography>
                <Typography variant="body2">Hook: {template.hookStyle}</Typography>
                <Typography variant="body2">CTA: {template.ctaStyle}</Typography>
                <Typography variant="body2">Target: {template.targetDurationSeconds || template.suggestedDurationSeconds || "Auto"}s</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {(template.pexelsSearchHints || []).slice(0, 5).map((term) => (
                    <StatusBadge key={term} status="default" label={term} />
                  ))}
                </Stack>
                {template.qualityChecklist && (
                  <Stack spacing={0.5}>
                    {template.qualityChecklist.slice(0, 4).map((item) => (
                      <Typography key={item} variant="caption" color="text.secondary">- {item}</Typography>
                    ))}
                  </Stack>
                )}
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`/create?template=${template.id}`)}>
                  Create with Template
                </Button>
              </Stack>
            </SectionCard>
          </Grid>
        ))}
      </Grid>
      {filtered.length === 0 && <EmptyState title="No templates match your search" />}
    </>
  );
};

export default TemplatesPage;
