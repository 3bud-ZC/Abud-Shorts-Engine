import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Alert, Box, Button, Card, Chip, Grid, Stack, Typography, useTheme } from "@mui/material";
import UploadIcon from "@mui/icons-material/CloudUploadOutlined";
import PermMediaIcon from "@mui/icons-material/PermMediaOutlined";

import { EmptyState, ErrorBoundary, LoadingState, PageHeader, SectionCard } from "../components/v2";
import { withMediaAccessToken } from "../utils/auth";

type MediaItem = {
  id: string;
  filename: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  uploadedAt?: string;
  relativePath?: string;
};

function formatSize(bytes?: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MediaContent: React.FC = () => {
  const theme = useTheme();
  const t = theme.abud;
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = () => {
    axios
      .get("/api/v2/media/products")
      .then((res) => setItems(res.data.products || []))
      .catch(() => setError("Media library could not be loaded."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const upload = (file: File) => {
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await axios.post("/api/v2/media/product-upload", {
          imageBase64: String(reader.result),
          filename: file.name,
          removeBackground: false,
        });
        setFeedback(`${file.name} added to your media library.`);
        load();
      } catch (err: any) {
        setError(err?.response?.data?.error || "Upload failed.");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setError("That file could not be read.");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (loading) return <LoadingState label="Loading media..." />;

  return (
    <>
      <PageHeader
        title="Media"
        eyebrow="Content"
        description="Images you upload here can be used in product and website productions."
        actions={
          <Button
            variant="contained"
            startIcon={<UploadIcon />}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Uploading..." : "Upload image"}
          </Button>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="Upload an image to your media library"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = "";
        }}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {feedback && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No media yet"
          description="Upload a product photo or logo and it becomes available when you create a video."
          action={
            <Button variant="contained" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
              Upload your first image
            </Button>
          }
        />
      ) : (
        <SectionCard title={`${items.length} item${items.length === 1 ? "" : "s"}`}>
          <Grid container spacing={2}>
            {items.map((item) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={item.id}>
                <Card sx={{ p: 1.5, height: "100%" }}>
                  <Box
                    sx={{
                      aspectRatio: "1 / 1",
                      borderRadius: 2,
                      bgcolor: t.backgroundAlt,
                      border: `1px solid ${t.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      mb: 1.25,
                    }}
                  >
                    {item.relativePath ? (
                      <Box
                        component="img"
                        src={withMediaAccessToken(`/api/v2/media/uploads/${item.filename}`)}
                        alt={item.originalName || item.filename}
                        sx={{ width: "100%", height: "100%", objectFit: "contain" }}
                        onError={(event: React.SyntheticEvent<HTMLImageElement>) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <PermMediaIcon sx={{ color: t.muted, fontSize: 36 }} />
                    )}
                  </Box>
                  <Typography variant="body2" fontWeight={600} noWrap title={item.originalName}>
                    {item.originalName || item.filename}
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: "wrap", gap: 0.5 }}>
                    <Chip size="small" variant="outlined" label={formatSize(item.sizeBytes)} />
                    {item.width && item.height ? (
                      <Chip size="small" variant="outlined" label={`${item.width}×${item.height}`} />
                    ) : null}
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>
        </SectionCard>
      )}
    </>
  );
};

const MediaPage: React.FC = () => (
  <ErrorBoundary>
    <MediaContent />
  </ErrorBoundary>
);

export default MediaPage;
