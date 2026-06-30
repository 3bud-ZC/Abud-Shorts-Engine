import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  Grid,
  IconButton,
  Tooltip,
  Chip,
  Stack
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { VideoStatus } from '../../types/shorts';

const VideoDetails: React.FC = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoStatus>('processing');
  const [metadata, setMetadata] = useState<{
    sizeBytes?: number;
    createdAt?: string;
    templateId?: string;
    templateName?: string;
    brandName?: string;
    watermarkText?: string;
    captionStyle?: string;
    durationSeconds?: number;
    pexelsTerms?: string[];
    narrationLines?: string[];
    downloadFilename?: string;
    downloadUrl?: string;
    previewUrl?: string;
    containerPath?: string;
    hostPathHint?: string;
    error?: string;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted = useRef(true);

  const checkVideoStatus = async () => {
    try {
      const response = await axios.get(`/api/short-video/${videoId}/status`);
      const videoStatus = response.data.status;

      if (isMounted.current) {
        setStatus(videoStatus || 'unknown');

        if (videoStatus === 'ready' && !metadata) {
          try {
            const meta = await axios.get(`/api/videos/${videoId}`);
            if (isMounted.current) {
              setMetadata({
                sizeBytes: meta.data.sizeBytes,
                createdAt: meta.data.createdAt,
                templateId: meta.data.templateId,
                templateName: meta.data.templateName,
                brandName: meta.data.brandName,
                watermarkText: meta.data.watermarkText,
                captionStyle: meta.data.captionStyle,
                durationSeconds: meta.data.durationSeconds,
                pexelsTerms: meta.data.pexelsTerms,
                narrationLines: meta.data.narrationLines,
                downloadFilename: meta.data.downloadFilename,
                downloadUrl: meta.data.downloadUrl,
                previewUrl: meta.data.previewUrl,
                containerPath: meta.data.containerPath,
                hostPathHint: meta.data.hostPathHint,
                error: meta.data.error,
              });
            }
          } catch (metaErr) {
            console.error('Error fetching video metadata:', metaErr);
          }
        }

        if (videoStatus !== 'processing') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }

        setLoading(false);
      }
    } catch (error) {
      if (isMounted.current) {
        setError('Failed to fetch video status');
        setStatus('failed');
        setLoading(false);
        console.error('Error fetching video status:', error);

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }
  };

  useEffect(() => {
    checkVideoStatus();

    intervalRef.current = setInterval(() => {
      checkVideoStatus();
    }, 5000);

    return () => {
      isMounted.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [videoId]);

  const handleBack = () => {
    navigate('/');
  };

  const renderContent = () => {
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="30vh">
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return <Alert severity="error">{error}</Alert>;
    }

    if (status === 'processing') {
      return (
        <Box textAlign="center" py={4}>
          <CircularProgress size={60} sx={{ mb: 2 }} />
          <Typography variant="h6">Your video is being created...</Typography>
          <Typography variant="body1" color="text.secondary">
            This may take a few minutes. Please wait.
          </Typography>
        </Box>
      );
    }

    if (status === 'ready') {
      const outputName = metadata?.downloadFilename || `${videoId}.mp4`;
      const containerPath = metadata?.containerPath;
      const hostPath = metadata?.hostPathHint && outputName ? `${metadata.hostPathHint}/${outputName}` : undefined;
      const downloadHref = metadata?.downloadUrl || `/api/videos/${videoId}/download`;
      const previewHref = metadata?.previewUrl || `/api/short-video/${videoId}`;

      return (
        <Box>
          <Box mb={3} textAlign="center">
            <Typography variant="h6" color="success.main" gutterBottom>
              Your video is ready!
            </Typography>
            {metadata && (
              <Typography variant="body2" color="text.secondary">
                {metadata.sizeBytes ? `${(metadata.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : ''}
                {metadata.durationSeconds ? ` • ${Math.round(metadata.durationSeconds)}s` : ''}
                {metadata.createdAt ? ` • ${new Date(metadata.createdAt).toLocaleString()}` : ''}
              </Typography>
            )}
          </Box>

          <Box sx={{
            position: 'relative',
            paddingTop: '56.25%',
            mb: 3,
            backgroundColor: '#000'
          }}>
            <video
              controls
              autoPlay
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
              }}
              src={previewHref}
            />
          </Box>

          <Box textAlign="center" display="flex" justifyContent="center" gap={2} flexWrap="wrap" mb={3}>
            <Button
              component="a"
              href={downloadHref}
              variant="contained"
              color="primary"
              startIcon={<DownloadIcon />}
              sx={{ textDecoration: 'none' }}
            >
              Download MP4
            </Button>
            <Button
              component="a"
              href={previewHref}
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              color="primary"
              startIcon={<OpenInNewIcon />}
              sx={{ textDecoration: 'none' }}
            >
              Preview Link
            </Button>
            <Tooltip title="Copy preview link">
              <IconButton
                color="secondary"
                onClick={() => {
                  const fullUrl = `${window.location.origin}${previewHref}`;
                  navigator.clipboard.writeText(fullUrl).then(() => {
                    setCopyFeedback('Preview link copied!');
                    setTimeout(() => setCopyFeedback(null), 2000);
                  }).catch(() => {
                    setCopyFeedback(fullUrl);
                    setTimeout(() => setCopyFeedback(null), 4000);
                  });
                }}
              >
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy download link">
              <IconButton
                color="secondary"
                onClick={() => {
                  const fullUrl = `${window.location.origin}${downloadHref}`;
                  navigator.clipboard.writeText(fullUrl).then(() => {
                    setCopyFeedback('Download link copied!');
                    setTimeout(() => setCopyFeedback(null), 2000);
                  }).catch(() => {
                    setCopyFeedback(fullUrl);
                    setTimeout(() => setCopyFeedback(null), 4000);
                  });
                }}
              >
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
            {containerPath && (
              <Tooltip title="Copy container path (/app/data/videos)">
                <IconButton
                  color="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(containerPath).then(() => {
                      setCopyFeedback('Container path copied');
                      setTimeout(() => setCopyFeedback(null), 2000);
                    }).catch(() => {
                      setCopyFeedback(containerPath);
                      setTimeout(() => setCopyFeedback(null), 4000);
                    });
                  }}
                >
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            )}
            {hostPath && (
              <Tooltip title="Copy Windows host path (cannot auto-open from browser)">
                <IconButton
                  color="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(hostPath).then(() => {
                      setCopyFeedback('Host path copied');
                      setTimeout(() => setCopyFeedback(null), 2000);
                    }).catch(() => {
                      setCopyFeedback(hostPath);
                      setTimeout(() => setCopyFeedback(null), 4000);
                    });
                  }}
                >
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          {copyFeedback && (
            <Box textAlign="center" mt={1}>
              <Typography variant="caption" color="text.secondary">
                {copyFeedback}
              </Typography>
            </Box>
          )}

          {metadata && (
            <Stack spacing={2} mt={2}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Output & Paths
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="text.secondary">Video ID</Typography>
                    <Typography variant="body1">{videoId}</Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="text.secondary">Filename</Typography>
                    <Typography variant="body1">{outputName}</Typography>
                  </Grid>
                  {containerPath && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">Container path (/app/data/videos)</Typography>
                      <Typography variant="body1" sx={{ wordBreak: 'break-all' }}>{containerPath}</Typography>
                    </Grid>
                  )}
                  {hostPath && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">Windows host path (copy/paste manually)</Typography>
                      <Typography variant="body1" sx={{ wordBreak: 'break-all' }}>{hostPath}</Typography>
                    </Grid>
                  )}
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Links</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                      <Chip label="Preview" component="a" href={previewHref} clickable size="small" />
                      <Chip label="Download" component="a" href={downloadHref} clickable size="small" />
                    </Stack>
                  </Grid>
                </Grid>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Render Metadata
                </Typography>
                <Grid container spacing={2}>
                  {metadata.templateId && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Template</Typography>
                      <Typography variant="body1">{metadata.templateName || metadata.templateId}</Typography>
                    </Grid>
                  )}
                  {metadata.brandName && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Brand</Typography>
                      <Typography variant="body1">{metadata.brandName}</Typography>
                    </Grid>
                  )}
                  {metadata.captionStyle && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Caption Style</Typography>
                      <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>{metadata.captionStyle}</Typography>
                    </Grid>
                  )}
                  {metadata.watermarkText && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Watermark</Typography>
                      <Typography variant="body1">{metadata.watermarkText}</Typography>
                    </Grid>
                  )}
                  {metadata.durationSeconds && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Duration</Typography>
                      <Typography variant="body1">{Math.round(metadata.durationSeconds)}s</Typography>
                    </Grid>
                  )}
                  {metadata.sizeBytes && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Size</Typography>
                      <Typography variant="body1">{(metadata.sizeBytes / (1024 * 1024)).toFixed(2)} MB</Typography>
                    </Grid>
                  )}
                  {metadata.createdAt && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="text.secondary">Created</Typography>
                      <Typography variant="body1">{new Date(metadata.createdAt).toLocaleString()}</Typography>
                    </Grid>
                  )}
                </Grid>
              </Paper>

              {metadata.pexelsTerms && metadata.pexelsTerms.length > 0 && (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Pexels Terms</Typography>
                  <Typography variant="body2" color="text.secondary">{metadata.pexelsTerms.join(', ')}</Typography>
                </Paper>
              )}

              {metadata.narrationLines && metadata.narrationLines.length > 0 && (
                <Paper sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Narration</Typography>
                  {metadata.narrationLines.map((line, i) => (
                    <Typography key={i} variant="body2" sx={{ mb: 0.5 }}>• {line}</Typography>
                  ))}
                </Paper>
              )}
            </Stack>
          )}
        </Box>
      );
    }

    if (status === 'failed') {
      return (
        <Alert severity="error" sx={{ mb: 3 }}>
          Video processing failed. Please try again with different settings.
        </Alert>
      );
    }

    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        Unknown video status. Please try refreshing the page.
      </Alert>
    );
  };

  const capitalizeFirstLetter = (str: string) => {
    if (!str || typeof str !== 'string') return 'Unknown';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  return (
    <Box maxWidth="md" mx="auto" py={4}>
      <Box display="flex" alignItems="center" mb={3}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
          sx={{ mr: 2 }}
        >
          Back to videos
        </Button>
        <Typography variant="h4" component="h1">
          Video Details
        </Typography>
      </Box>

      <Paper sx={{ p: 3 }}>
        <Grid container spacing={2} mb={3}>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              Video ID
            </Typography>
            <Typography variant="body1">
              {videoId || 'Unknown'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="body2" color="text.secondary">
              Status
            </Typography>
            <Typography
              variant="body1"
              color={
                status === 'ready' ? 'success.main' :
                  status === 'processing' ? 'info.main' :
                    status === 'failed' ? 'error.main' : 'text.primary'
              }
            >
              {capitalizeFirstLetter(status)}
            </Typography>
          </Grid>
        </Grid>

        {renderContent()}
      </Paper>
    </Box>
  );
};

export default VideoDetails; 