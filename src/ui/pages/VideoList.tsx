import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Tooltip,
  Chip,
  TextField,
  Checkbox,
  FormControlLabel,
  Stack
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface VideoItem {
  videoId: string;
  filename: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  previewUrl: string;
  templateId?: string;
  templateName?: string;
  brandName?: string;
  watermarkText?: string;
  captionStyle?: string;
  durationSeconds?: number;
  pexelsTerms?: string[];
  narrationLines?: string[];
  downloadFilename?: string;
  containerPath?: string;
  hostPathHint?: string;
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'ready': return 'success';
    case 'processing': return 'info';
    case 'failed': return 'error';
    default: return 'default';
  }
}

const VideoList: React.FC = () => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const fetchVideos = async () => {
    try {
      const response = await axios.get('/api/videos');
      setVideos(response.data.videos || []);
      setLoading(false);
    } catch (err) {
      setError('Failed to fetch videos');
      setLoading(false);
      console.error('Error fetching videos:', err);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  const filteredVideos = videos.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.videoId.toLowerCase().includes(q) ||
      (v.templateId && v.templateId.toLowerCase().includes(q)) ||
      (v.templateName && v.templateName.toLowerCase().includes(q)) ||
      (v.brandName && v.brandName.toLowerCase().includes(q)) ||
      (v.watermarkText && v.watermarkText.toLowerCase().includes(q))
    );
  });

  const handleToggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setSelectAll(next.size === filteredVideos.length && filteredVideos.length > 0);
  };

  const handleToggleSelectAll = () => {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      setSelected(new Set(filteredVideos.map((v) => v.videoId)));
      setSelectAll(true);
    }
  };

  const handleCopySelectedLinks = (type: 'preview' | 'download') => {
    const selectedVideos = videos.filter((v) => selected.has(v.videoId));
    if (selectedVideos.length === 0) return;
    const lines = selectedVideos.map((v) => {
      const url = type === 'preview' ? v.previewUrl : v.downloadUrl;
      return `${window.location.origin}${url}`;
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopyFeedback(`Copied ${selectedVideos.length} ${type} link(s)`);
      setTimeout(() => setCopyFeedback(null), 2000);
    }).catch(() => {
      setCopyFeedback(lines.join('\n'));
      setTimeout(() => setCopyFeedback(null), 4000);
    });
  };

  const handleCreateNew = () => {
    navigate('/create');
  };

  const handleVideoClick = (id: string) => {
    navigate(`/video/${id}`);
  };

  const handleDeleteVideo = async (id: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    try {
      await axios.delete(`/api/short-video/${id}`);
      fetchVideos();
    } catch (err) {
      setError('Failed to delete video');
      console.error('Error deleting video:', err);
    }
  };

  const handleCopyLink = (url: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopyFeedback('Link copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    }).catch(() => {
      setCopyFeedback(fullUrl);
      setTimeout(() => setCopyFeedback(null), 4000);
    });
  };

  const handleCopyText = (text: string, message: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(message);
      setTimeout(() => setCopyFeedback(null), 2000);
    }).catch(() => {
      setCopyFeedback(text);
      setTimeout(() => setCopyFeedback(null), 4000);
    });
  };

  const selectedCount = selected.size;

  const capitalizeFirstLetter = (str: string) => {
    if (!str || typeof str !== 'string') return 'Unknown';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="80vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth="md" mx="auto" py={4}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Typography variant="h4" component="h1">
          Your Videos
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={handleCreateNew}
        >
          Create New Video
        </Button>
      </Box>

      {copyFeedback && (
        <Alert severity="info" sx={{ mb: 3 }}>{copyFeedback}</Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>
      )}

      {videos.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary" gutterBottom>
            You haven't created any videos yet.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreateNew}
            sx={{ mt: 2 }}
          >
            Create Your First Video
          </Button>
        </Paper>
      ) : (
        <>
          <Box mb={2}>
            <TextField
              fullWidth
              variant="outlined"
              size="small"
              placeholder="Search by video ID, template, or brand..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelected(new Set());
                setSelectAll(false);
              }}
            />
          </Box>

          {selectedCount > 0 && (
            <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ mr: 1 }}>
                {selectedCount} selected
              </Typography>
              <Button size="small" variant="outlined" onClick={() => handleCopySelectedLinks('preview')}>
                Copy Preview Links
              </Button>
              <Button size="small" variant="outlined" onClick={() => handleCopySelectedLinks('download')}>
                Copy Download Links
              </Button>
              <Button size="small" color="error" variant="outlined" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </Paper>
          )}

          <Paper>
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
              <Checkbox
                checked={selectAll}
                onChange={handleToggleSelectAll}
                size="small"
              />
              <Typography variant="caption" color="text.secondary">
                Select all
              </Typography>
            </Box>
            <List>
              {filteredVideos.map((video, index) => {
                const videoId = video?.videoId || '';
                const videoStatus = video?.status || 'unknown';
                const isReady = videoStatus === 'ready';
                const isSelected = selected.has(videoId);
                const downloadName = video.downloadFilename || video.filename;
                const hostPath = video.hostPathHint ? `${video.hostPathHint}/${downloadName}` : undefined;
                const containerPath = video.containerPath;

                return (
                  <div key={videoId}>
                    {index > 0 && <Divider />}
                    <ListItem
                      button
                      onClick={() => handleVideoClick(videoId)}
                      sx={{
                        py: 2,
                        '&:hover': {
                          backgroundColor: 'rgba(0, 0, 0, 0.04)'
                        }
                      }}
                    >
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }} onClick={(e) => { e.stopPropagation(); handleToggleSelect(videoId); }}>
                        <Checkbox checked={isSelected} size="small" />
                      </Box>
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                            <Typography variant="body1" component="span" fontWeight={600}>
                              {video.templateName || video.templateId
                                ? (video.templateName || video.templateId)
                                : `Video ${videoId.substring(0, 12)}...`}
                            </Typography>
                            {video.brandName && (
                              <Chip label={video.brandName} size="small" variant="outlined" />
                            )}
                            <Chip
                              label={capitalizeFirstLetter(videoStatus)}
                              size="small"
                              color={getStatusColor(videoStatus) as any}
                            />
                          </Stack>
                        }
                        secondary={
                          <Box>
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              ID: {videoId}
                            </Typography>
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {downloadName}
                            </Typography>
                            {isReady && (
                              <Typography component="span" variant="caption" color="text.secondary">
                                {formatFileSize(video.sizeBytes)}
                                {video.durationSeconds ? ` • ${formatDuration(video.durationSeconds)}` : ''}
                                {' • '}
                                {formatDate(video.createdAt)}
                              </Typography>
                            )}
                            {hostPath && (
                              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                Host path: {hostPath}
                              </Typography>
                            )}
                            {video.error && (
                              <Typography component="span" variant="caption" color="error.main" sx={{ display: 'block' }}>
                                {video.error}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                      <ListItemSecondaryAction>
                        {isReady && (
                          <>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Tooltip title="Preview video">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<OpenInNewIcon />}
                                  onClick={() => handleVideoClick(videoId)}
                                >
                                  Preview
                                </Button>
                              </Tooltip>
                              <Tooltip title="Download MP4">
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<DownloadIcon />}
                                  href={video.downloadUrl}
                                  component="a"
                                >
                                  Download
                                </Button>
                              </Tooltip>
                              <Tooltip title="Copy preview link">
                                <IconButton
                                  edge="end"
                                  aria-label="copy preview"
                                  onClick={(e) => handleCopyLink(video.previewUrl, e)}
                                  color="secondary"
                                >
                                  <ContentCopyIcon />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Copy download link">
                                <IconButton
                                  edge="end"
                                  aria-label="copy download"
                                  onClick={(e) => handleCopyLink(video.downloadUrl, e)}
                                  color="secondary"
                                >
                                  <ContentCopyIcon />
                                </IconButton>
                              </Tooltip>
                              {hostPath && (
                                <Tooltip title="Copy host file path">
                                  <IconButton
                                    edge="end"
                                    aria-label="copy path"
                                    onClick={(e) => handleCopyText(hostPath, 'Host path copied', e)}
                                    color="secondary"
                                  >
                                    <ContentCopyIcon />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {containerPath && (
                                <Tooltip title="Copy container path">
                                  <IconButton
                                    edge="end"
                                    aria-label="copy container path"
                                    onClick={(e) => handleCopyText(containerPath, 'Container path copied', e)}
                                    color="secondary"
                                  >
                                    <ContentCopyIcon />
                                  </IconButton>
                                </Tooltip>
                              )}
                              <Tooltip title="Copy metadata JSON">
                                <IconButton
                                  edge="end"
                                  aria-label="copy metadata"
                                  onClick={(e) => handleCopyText(JSON.stringify(video, null, 2), 'Metadata copied', e)}
                                  color="secondary"
                                >
                                  <ContentCopyIcon />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </>
                        )}
                        <IconButton
                          edge="end"
                          aria-label="delete"
                          onClick={(e) => handleDeleteVideo(videoId, e)}
                          color="error"
                          sx={{ ml: 0.5 }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  </div>
                );
              })}
            </List>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default VideoList; 