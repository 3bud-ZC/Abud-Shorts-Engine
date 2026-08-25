import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import UploadIcon from "@mui/icons-material/CloudUploadOutlined";
import BrokenImageIcon from "@mui/icons-material/BrokenImageOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";

import {
  ConfirmDialog,
  EmptyState,
  ErrorBoundary,
  LoadingState,
  PageHeader,
  SectionCard,
} from "../components/v2";
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
  /** False when the stored bytes are not a usable image. */
  usable?: boolean;
  unusableReason?: string;
  /** Set when an earlier item holds byte-identical content. */
  duplicateOf?: string;
};

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function fileTypeLabel(mime?: string): string {
  if (!mime) return "Image";
  return mime.replace("image/", "").toUpperCase();
}

const MediaContent: React.FC = () => {
  const theme = useTheme();
  const t = theme.abud;
  const navigate = useNavigate();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [renameItem, setRenameItem] = useState<MediaItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteItem, setDeleteItem] = useState<MediaItem | null>(null);
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
        const res = await axios.post("/api/v2/media/product-upload", {
          imageBase64: String(reader.result),
          filename: file.name,
          removeBackground: false,
        });
        // The server returns the existing record when these bytes already exist.
        setFeedback(
          res.data?.media?.duplicateOf
            ? `${file.name} is already in your library — the existing copy was kept.`
            : `${file.name} added to your media library.`,
        );
        load();
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : "That file could not be uploaded.";
        setError(message);
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

  const rename = async () => {
    if (!renameItem || !renameValue.trim()) return;
    try {
      await axios.patch(`/api/v2/media/products/${renameItem.id}`, {
        originalName: renameValue.trim(),
      });
      setFeedback("Renamed.");
      load();
    } catch {
      setError("Could not rename this item.");
    } finally {
      setRenameItem(null);
    }
  };

  const remove = async () => {
    if (!deleteItem) return;
    try {
      await axios.delete(`/api/v2/media/products/${deleteItem.id}`);
      setFeedback("Removed from your media library.");
      load();
    } catch {
      setError("Could not remove this item.");
    } finally {
      setDeleteItem(null);
    }
  };

  if (loading) return <LoadingState label="Loading media..." />;

  const unusableCount = items.filter((item) => item.usable === false).length;

  return (
    <>
      <PageHeader
        title="Media"
        eyebrow="Content"
        description="Images you upload here can be used in product and website videos."
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
        accept="image/png,image/jpeg,image/webp"
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
      {unusableCount > 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {unusableCount} older item{unusableCount === 1 ? " is" : "s are"} not a usable image. They are
          kept and marked below so you can replace or remove them.
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
            {items.map((item) => {
              const invalid = item.usable === false;
              return (
                <Grid item xs={12} sm={6} md={4} lg={3} key={item.id}>
                  <Card sx={{ p: 1.5, height: "100%", display: "flex", flexDirection: "column" }}>
                    <Box
                      sx={{
                        aspectRatio: "1 / 1",
                        borderRadius: 2,
                        bgcolor: t.backgroundAlt,
                        border: `1px solid ${invalid ? t.warningMuted : t.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        mb: 1.25,
                      }}
                    >
                      {invalid ? (
                        <Stack alignItems="center" spacing={0.5} sx={{ p: 1.5, textAlign: "center" }}>
                          <BrokenImageIcon sx={{ color: t.warning, fontSize: 30 }} />
                          <Typography variant="caption" sx={{ color: t.textSecondary }}>
                            Invalid Media
                          </Typography>
                        </Stack>
                      ) : (
                        <Box
                          component="img"
                          src={withMediaAccessToken(`/api/v2/media/uploads/${item.filename}`)}
                          alt={item.originalName || item.filename}
                          loading="lazy"
                          sx={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      )}
                    </Box>

                    <Tooltip title={item.originalName || item.filename}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {item.originalName || item.filename}
                      </Typography>
                    </Tooltip>

                    <Stack direction="row" sx={{ mt: 0.75, flexWrap: "wrap", gap: 0.5 }}>
                      <Chip size="small" variant="outlined" label={fileTypeLabel(item.mimeType)} />
                      {item.width && item.height ? (
                        <Chip size="small" variant="outlined" label={`${item.width}×${item.height}`} />
                      ) : null}
                      <Chip size="small" variant="outlined" label={formatSize(item.sizeBytes)} />
                      {item.duplicateOf && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<ContentCopyIcon />}
                          label="Duplicate"
                          color="warning"
                        />
                      )}
                    </Stack>

                    {formatDate(item.uploadedAt) && (
                      <Typography variant="caption" sx={{ color: t.muted, mt: 0.75 }}>
                        Added {formatDate(item.uploadedAt)}
                      </Typography>
                    )}

                    {invalid && item.unusableReason && (
                      <Typography variant="caption" sx={{ color: t.warning, mt: 0.5 }}>
                        {item.unusableReason}
                      </Typography>
                    )}

                    <Box sx={{ flexGrow: 1 }} />
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                      {invalid ? (
                        <>
                          <Button size="small" variant="outlined" onClick={() => fileInput.current?.click()}>
                            Replace
                          </Button>
                          <Button size="small" color="error" onClick={() => setDeleteItem(item)}>
                            Remove
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="small" variant="outlined" onClick={() => setPreviewItem(item)}>
                            Preview
                          </Button>
                          <Button size="small" variant="text" onClick={() => navigate("/create")}>
                            Use in video
                          </Button>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => {
                              setRenameItem(item);
                              setRenameValue(item.originalName || item.filename);
                            }}
                          >
                            Rename
                          </Button>
                          <Button size="small" color="error" variant="text" onClick={() => setDeleteItem(item)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </Stack>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </SectionCard>
      )}

      <Dialog open={Boolean(previewItem)} onClose={() => setPreviewItem(null)} fullWidth maxWidth="sm">
        <DialogTitle>{previewItem?.originalName || previewItem?.filename}</DialogTitle>
        <DialogContent>
          {previewItem && (
            <Box
              component="img"
              src={withMediaAccessToken(`/api/v2/media/uploads/${previewItem.filename}`)}
              alt={previewItem.originalName || previewItem.filename}
              sx={{ width: "100%", borderRadius: 2, bgcolor: t.backgroundAlt }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewItem(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(renameItem)} onClose={() => setRenameItem(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rename media</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            autoFocus
            label="Name"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameItem(null)}>Cancel</Button>
          <Button variant="contained" onClick={rename} disabled={!renameValue.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteItem)}
        title="Remove this item?"
        description="It will be deleted from your media library. Videos already produced are unaffected."
        confirmLabel="Remove"
        onClose={() => setDeleteItem(null)}
        onConfirm={remove}
      />
    </>
  );
};

const MediaPage: React.FC = () => (
  <ErrorBoundary>
    <MediaContent />
  </ErrorBoundary>
);

export default MediaPage;
