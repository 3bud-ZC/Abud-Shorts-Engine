import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  IconButton,
  Divider,
  InputAdornment,
  FormControlLabel,
  Checkbox,
  Chip,
  Tooltip,
  Stack,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import {
  readBrandKit,
  writeBrandKit,
  resetBrandKit,
  readBrandProfiles,
  saveProfile,
  deleteProfile,
  createProfile,
  readLastTemplateId,
  writeLastTemplateId,
  readTemplateFields,
  writeTemplateFields,
  clearTemplateFields,
  type BrandProfile,
} from "../utils/persistence";
import {
  SceneInput,
  RenderConfig,
  MusicMoodEnum,
  CaptionPositionEnum,
  VoiceEnum,
  OrientationEnum,
  MusicVolumeEnum,
  BrandKit,
} from "../../types/shorts";
import type { BusinessTemplateId } from "../../short-creator/business-templates";
import { generateScenesForTemplate } from "../../short-creator/templateSceneFactory";

interface SceneFormData {
  text: string;
  searchTerms: string; // Changed to string
}

type BusinessTemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

interface BusinessTemplateOption {
  id: string;
  displayName: string;
  description: string;
  targetUseCase: string;
  hookStyle: string;
  ctaStyle: string;
  examplePrompt: string;
  pexelsSearchHints: string[];
  fields: BusinessTemplateField[];
}

const VideoCreator: React.FC = () => {
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<SceneFormData[]>([
    { text: "", searchTerms: "" },
  ]);
  const [config, setConfig] = useState<RenderConfig>({
    paddingBack: 1500,
    music: MusicMoodEnum.chill,
    captionPosition: CaptionPositionEnum.bottom,
    captionBackgroundColor: "blue",
    voice: VoiceEnum.af_heart,
    orientation: OrientationEnum.portrait,
    musicVolume: MusicVolumeEnum.high,
    brandKit: readBrandKit(),
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceEnum[]>([]);
  const [musicTags, setMusicTags] = useState<MusicMoodEnum[]>([]);
  const [businessTemplates, setBusinessTemplates] = useState<
    BusinessTemplateOption[]
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [templateFieldValues, setTemplateFieldValues] = useState<Record<string, string>>({});

  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [profileNameInput, setProfileNameInput] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>("");

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [voicesResponse, musicResponse, templatesResponse] =
          await Promise.all([
            axios.get("/api/voices"),
            axios.get("/api/music-tags"),
            axios.get("/api/business-templates"),
          ]);

        setVoices(voicesResponse.data);
        setMusicTags(musicResponse.data);
        setBusinessTemplates(templatesResponse.data);
      } catch (err) {
        console.error("Failed to fetch options:", err);
        setError(
          "Failed to load voices, music tags, or templates. Please refresh the page.",
        );
      } finally {
        setLoadingOptions(false);
      }
    };

    fetchOptions();
  }, []);

  useEffect(() => {
    setProfiles(readBrandProfiles());
  }, []);

  useEffect(() => {
    if (businessTemplates.length === 0) return;
    const savedTemplateId = readLastTemplateId();
    if (savedTemplateId && businessTemplates.some((t) => t.id === savedTemplateId)) {
      setSelectedTemplateId(savedTemplateId);
    }
  }, [businessTemplates]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateFieldValues({});
      return;
    }
    const template = businessTemplates.find(
      (tpl) => tpl.id === selectedTemplateId,
    );
    if (!template) {
      setTemplateFieldValues({});
      return;
    }

    const savedFields = readTemplateFields()[selectedTemplateId] || {};
    setTemplateFieldValues((prev) => {
      const next: Record<string, string> = {};
      template.fields.forEach((field) => {
        next[field.key] = savedFields[field.key] ?? prev[field.key] ?? "";
      });
      return next;
    });
  }, [selectedTemplateId, businessTemplates]);

  useEffect(() => {
    writeBrandKit(config.brandKit);
    setSaveStatus("Saved locally");
    const timer = setTimeout(() => setSaveStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [config.brandKit]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    const allFields = readTemplateFields();
    writeTemplateFields({
      ...allFields,
      [selectedTemplateId]: templateFieldValues,
    });
  }, [templateFieldValues, selectedTemplateId]);

  useEffect(() => {
    writeLastTemplateId(selectedTemplateId);
  }, [selectedTemplateId]);

  const selectedTemplate = useMemo(
    () => businessTemplates.find((tpl) => tpl.id === selectedTemplateId),
    [businessTemplates, selectedTemplateId],
  );

  const templateFieldList = useMemo(
    () => selectedTemplate?.fields ?? [],
    [selectedTemplate],
  );

  const generatedTemplateScenes = useMemo(() => {
    if (!selectedTemplate) {
      return [];
    }
    return generateScenesForTemplate(
      selectedTemplate.id as BusinessTemplateId,
      templateFieldValues,
    );
  }, [selectedTemplate, templateFieldValues]);

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    const fallbackSearchLine = selectedTemplate.pexelsSearchHints.join(", ");
    const derivedScenes = (generatedTemplateScenes.length
      ? generatedTemplateScenes
      : [
        {
          text: "Template narration pending. Please complete the required fields.",
          searchTerms: selectedTemplate.pexelsSearchHints,
        },
      ]
    ).map((scene) => ({
      text: scene.text,
      searchTerms: (scene.searchTerms?.length
        ? scene.searchTerms
        : selectedTemplate.pexelsSearchHints
      ).join(", ") || fallbackSearchLine,
    }));

    setScenes(derivedScenes);
  }, [selectedTemplate, generatedTemplateScenes]);

  const isTemplateMode = Boolean(selectedTemplate);
  const templateSearchHintLine = selectedTemplate
    ? selectedTemplate.pexelsSearchHints.join(", ")
    : "";

  const filledFieldSummaries = templateFieldList
    .map((field) => {
      const value = templateFieldValues[field.key];
      if (!value?.trim()) {
        return null;
      }
      return `${field.label}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));

  const handleAddScene = () => {
    if (isTemplateMode) {
      return;
    }
    setScenes([...scenes, { text: "", searchTerms: "" }]);
  };

  const handleRemoveScene = (index: number) => {
    if (isTemplateMode) {
      return;
    }
    if (scenes.length > 1) {
      const newScenes = [...scenes];
      newScenes.splice(index, 1);
      setScenes(newScenes);
    }
  };

  const handleSceneChange = (
    index: number,
    field: keyof SceneFormData,
    value: string,
  ) => {
    if (isTemplateMode) {
      return;
    }
    const newScenes = [...scenes];
    newScenes[index] = { ...newScenes[index], [field]: value };
    setScenes(newScenes);
  };

  const handleConfigChange = (field: keyof RenderConfig, value: any) => {
    setConfig({ ...config, [field]: value });
  };

  const handleBrandKitChange = (field: keyof BrandKit, value: any) => {
    setConfig({
      ...config,
      brandKit: {
        ...config.brandKit,
        [field]: value,
      },
    });
  };

  const handleTemplateFieldChange = (key: string, value: string) => {
    setTemplateFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetBrandKit = () => {
    const defaults = resetBrandKit();
    setConfig((prev) => ({ ...prev, brandKit: defaults }));
  };

  const handleSaveProfile = () => {
    const profile = createProfile(profileNameInput, config.brandKit || {});
    const updated = saveProfile(profile);
    setProfiles(updated);
    setProfileNameInput("");
    setSelectedProfileId(profile.id);
  };

  const handleLoadProfile = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    setConfig((prev) => ({ ...prev, brandKit: profile.brandKit }));
    setSelectedProfileId(profileId);
  };

  const handleDeleteProfile = (profileId: string) => {
    const updated = deleteProfile(profileId);
    setProfiles(updated);
    if (selectedProfileId === profileId) {
      setSelectedProfileId("");
    }
  };

  const handleClearTemplateFields = () => {
    if (!selectedTemplateId) return;
    clearTemplateFields(selectedTemplateId);
    setTemplateFieldValues({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Convert scenes to the expected API format
      const apiScenes: SceneInput[] = scenes.map((scene) => ({
        text: scene.text,
        searchTerms: scene.searchTerms
          .split(",")
          .map((term) => term.trim())
          .filter((term) => term.length > 0),
      }));

      const payload: {
        scenes: SceneInput[];
        config: RenderConfig;
        businessTemplateId?: string;
        businessTemplateData?: Record<string, string>;
      } = {
        scenes: apiScenes,
        config,
      };

      if (selectedTemplateId) {
        payload.businessTemplateId = selectedTemplateId;
        payload.businessTemplateData = Object.fromEntries(
          Object.entries(templateFieldValues).filter(
            ([, value]) => value && value.trim().length > 0,
          ),
        );
      }

      const response = await axios.post("/api/short-video", payload);

      navigate(`/video/${response.data.videoId}`);
    } catch (err) {
      setError("Failed to create video. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loadingOptions) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="80vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth="md" mx="auto" py={4}>
      <Stack spacing={1} mb={3}>
        <Typography variant="h4" component="h1">
          Create New Video
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Local-first workflow — your videos save to /app/data/videos (host: C:/abud-shorts-engine/data-dev/videos) and Brand Kit profiles stay in this browser.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          After rendering, find downloads and metadata in the Generated Videos page. Required fields are marked, and outputs land at C:/abud-shorts-engine/data-dev/videos on Windows.
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2" gutterBottom>
          Step 1: Template (اختياري)
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          اختر قالبًا لتعبئة البرومبت وكلمات البحث تلقائيًا، أو اتركه فارغًا للتأليف الحر.
        </Typography>

        <Paper sx={{ p: 3, mb: 4 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Business Template</InputLabel>
                <Select
                  value={selectedTemplateId}
                  label="Business Template"
                  onChange={(event) =>
                    setSelectedTemplateId(event.target.value as string)
                  }
                >
                  <MenuItem value="">Generic / No template</MenuItem>
                  {businessTemplates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.displayName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              {selectedTemplate ? (
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {selectedTemplate.displayName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedTemplate.description}
                  </Typography>
                  <Typography variant="body2" mt={1} color="text.secondary">
                    Hook: {selectedTemplate.hookStyle}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    CTA: {selectedTemplate.ctaStyle}
                  </Typography>
                  <Typography variant="body2" mt={1} color="text.secondary">
                    إدخال الحقول التالية يجعل البرومبت أكثر دقة واختيار اللقطات أذكى.
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Select a template to auto-fill prompts and search hints for
                  Egyptian business use cases.
                </Typography>
              )}
            </Grid>
          </Grid>
        </Paper>

        {selectedTemplate && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Step 2: Content — Template Fields
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              أدخل تفاصيل النشاط التجاري لتحسين جودة النص واللقطات المقترحة.
            </Typography>
            <Grid container spacing={3}>
              {templateFieldList.map((field) => (
                <Grid item xs={12} sm={field.type === "textarea" ? 12 : 6} key={field.key}>
                  {field.type === "select" ? (
                    <FormControl fullWidth>
                      <InputLabel>{field.label}</InputLabel>
                      <Select
                        value={templateFieldValues[field.key] ?? ""}
                        label={field.label}
                        onChange={(event) =>
                          handleTemplateFieldChange(field.key, event.target.value)
                        }
                        required={field.required}
                      >
                        <MenuItem value="">
                          اختر قيمة
                        </MenuItem>
                        {(field.options || []).map((option) => (
                          <MenuItem value={option} key={option}>
                            {option}
                          </MenuItem>
                        ))}
                      </Select>
                      {field.helperText && (
                        <Typography variant="caption" color="text.secondary">
                          {field.helperText}
                        </Typography>
                      )}
                    </FormControl>
                  ) : (
                    <TextField
                      fullWidth
                      label={field.label}
                      type={field.type === "number" ? "number" : "text"}
                      multiline={field.type === "textarea"}
                      rows={field.type === "textarea" ? 3 : undefined}
                      value={templateFieldValues[field.key] ?? ""}
                      onChange={(event) =>
                        handleTemplateFieldChange(field.key, event.target.value)
                      }
                      placeholder={field.placeholder}
                      helperText={field.helperText}
                      required={field.required}
                    />
                  )}
                </Grid>
              ))}
            </Grid>
            <Box mt={2} display="flex" gap={2}>
              <Button
                variant="outlined"
                size="small"
                onClick={handleClearTemplateFields}
              >
                Clear Template Fields
              </Button>
            </Box>
            <Box mt={3} p={2} bgcolor="grey.50" borderRadius={2}>
              <Typography variant="subtitle2" gutterBottom>
                Preview Direction
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedTemplate.hookStyle} → {selectedTemplate.ctaStyle}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Focus on: {templateFieldList.map((field) => field.label).join(", ")}
              </Typography>
              {filledFieldSummaries.length > 0 && (
                <Box mt={1}>
                  {filledFieldSummaries.map((line) => (
                    <Typography key={line} variant="caption" display="block">
                      {line}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          </Paper>
        )}

        {selectedTemplate && (
          <Paper sx={{ p: 3, mb: 4 }}>
            <Typography variant="h6" gutterBottom>
              Generated Narration Preview
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              سيتم إرسال النصوص التالية تلقائيًا عند استخدام القالب.
            </Typography>
            {generatedTemplateScenes.map((scene, index) => (
              <Box key={scene.text + index} mb={1.5}>
                <Typography variant="subtitle2">Scene {index + 1}</Typography>
                <Typography variant="body2" color="text.primary">
                  {scene.text}
                </Typography>
              </Box>
            ))}
            <Typography variant="body2" color="text.secondary">
              Search hints: {templateSearchHintLine}
            </Typography>
          </Paper>
        )}

        <Typography variant="h5" component="h2" gutterBottom>
          Step 2: Content — Scenes
        </Typography>

        {isTemplateMode && (
          <Alert severity="info" sx={{ mb: 3 }}>
            سيتم توليد النصوص و كلمات البحث تلقائيًا من القالب. عدّل الحقول أعلاه
            إذا أردت تغيير المحتوى.
          </Alert>
        )}

        {scenes.map((scene, index) => (
          <Paper key={index} sx={{ p: 3, mb: 3 }}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb={2}
            >
              <Typography variant="h6">Scene {index + 1}</Typography>
              {scenes.length > 1 && (
                <IconButton
                  onClick={() => handleRemoveScene(index)}
                  color="error"
                  size="small"
                  disabled={isTemplateMode}
                >
                  <DeleteIcon />
                </IconButton>
              )}
            </Box>

            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Text"
                  multiline
                  rows={4}
                  value={scene.text}
                  onChange={(e) =>
                    handleSceneChange(index, "text", e.target.value)
                  }
                  required
                  disabled={isTemplateMode}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Search Terms (comma-separated)"
                  value={scene.searchTerms}
                  onChange={(e) =>
                    handleSceneChange(index, "searchTerms", e.target.value)
                  }
                  helperText={
                    isTemplateMode
                      ? "يتم إرسال كلمات البحث الخاصة بالقالب تلقائيًا"
                      : "Enter keywords for background video, separated by commas"
                  }
                  required
                  disabled={isTemplateMode}
                />
              </Grid>
            </Grid>
          </Paper>
        ))}

        <Box display="flex" justifyContent="center" mb={4}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleAddScene}
            disabled={isTemplateMode}
          >
            Add Scene
          </Button>
        </Box>

        <Divider sx={{ mb: 4 }} />

        <Typography variant="h6" component="h2" gutterBottom>
          Step 3: Brand Kit (اختياري)
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          اضبط ألوان وهوية البراند. يحفظ تلقائيًا في هذا المتصفح فقط (localStorage) ويمكن حفظ ملفات تعريف متعددة.
        </Typography>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Box mb={2} display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Chip
              size="small"
              color={saveStatus ? "success" : "default"}
              label={saveStatus || "Using default Brand Kit"}
            />
            <Typography variant="caption" color="text.secondary">
              Saved on this browser only (لا يُرفع للسيرفر)
            </Typography>
          </Box>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Preview
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 1,
                  bgcolor: config.brandKit?.primaryColor || "#1976d2",
                  color: "#fff",
                  minWidth: 120,
                }}
              >
                <Typography variant="body2" fontWeight={600}>
                  {config.brandKit?.brandName || "Brand Name"}
                </Typography>
                <Typography variant="caption">
                  {config.brandKit?.watermarkText || "Watermark"}
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 1,
                  border: `1px dashed ${config.brandKit?.accentColor || "#ccc"}`,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Outro: {config.brandKit?.outroText || "Call to action"}
                </Typography>
              </Box>
            </Stack>
          </Paper>

          {profiles.length > 0 && (
            <Box mb={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Saved Brand Profile</InputLabel>
                <Select
                  value={selectedProfileId}
                  label="Saved Brand Profile"
                  onChange={(e) => handleLoadProfile(e.target.value as string)}
                >
                  <MenuItem value="">— None —</MenuItem>
                  {profiles.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {selectedProfileId && (
                <Box mt={1} display="flex" gap={1}>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => handleDeleteProfile(selectedProfileId)}
                  >
                    Delete Profile
                  </Button>
                </Box>
              )}
            </Box>
          )}

          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Brand Name"
                value={config.brandKit?.brandName ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("brandName", e.target.value)
                }
                helperText="Shown in outro"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Watermark Text"
                value={config.brandKit?.watermarkText ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("watermarkText", e.target.value)
                }
                helperText="Text overlay on the video"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Primary Color"
                value={config.brandKit?.primaryColor ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("primaryColor", e.target.value)
                }
                helperText="CSS color for watermark/outro"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Accent Color"
                value={config.brandKit?.accentColor ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("accentColor", e.target.value)
                }
                helperText="Secondary CSS color"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Caption Style</InputLabel>
                <Select
                  value={config.brandKit?.captionStyle ?? "bold"}
                  onChange={(e) =>
                    handleBrandKitChange("captionStyle", e.target.value)
                  }
                  label="Caption Style"
                >
                  <MenuItem value="clean">clean</MenuItem>
                  <MenuItem value="bold">bold</MenuItem>
                  <MenuItem value="minimal">minimal</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Outro Text"
                value={config.brandKit?.outroText ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("outroText", e.target.value)
                }
                helperText="CTA shown at the end"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Contact Text"
                value={config.brandKit?.contactText ?? ""}
                onChange={(e) =>
                  handleBrandKitChange("contactText", e.target.value)
                }
                helperText="Contact line in outro"
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={config.brandKit?.includeOutro === true}
                    onChange={(event) =>
                      handleBrandKitChange("includeOutro", event.target.checked)
                    }
                  />
                }
                label="Include Outro"
              />
            </Grid>
          </Grid>

          <Box mt={3} display="flex" gap={2} flexWrap="wrap" alignItems="center">
            <TextField
              size="small"
              label="Profile Name"
              placeholder="My Brand"
              value={profileNameInput}
              onChange={(e) => setProfileNameInput(e.target.value)}
              helperText="Save current Brand Kit as a profile"
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<SaveIcon />}
              onClick={handleSaveProfile}
              disabled={!profileNameInput.trim()}
            >
              Save Profile
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="secondary"
              onClick={handleResetBrandKit}
            >
              Reset Brand Kit
            </Button>
          </Box>
        </Paper>

        <Divider sx={{ mb: 4 }} />

        <Typography variant="h6" component="h2" gutterBottom>
          Step 4: Video Settings
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          عدّل إعدادات الفيديو والصوت والنصوص. هذه الخيارات تطبَّق على كل المشاهد.
        </Typography>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="End Screen Padding (ms)"
                value={config.paddingBack}
                onChange={(e) =>
                  handleConfigChange("paddingBack", parseInt(e.target.value))
                }
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">ms</InputAdornment>
                  ),
                }}
                helperText="Duration to keep playing after narration ends"
                required
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Music Mood</InputLabel>
                <Select
                  value={config.music}
                  onChange={(e) => handleConfigChange("music", e.target.value)}
                  label="Music Mood"
                  required
                >
                  {Object.values(MusicMoodEnum).map((tag) => (
                    <MenuItem key={tag} value={tag}>
                      {tag}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Caption Position</InputLabel>
                <Select
                  value={config.captionPosition}
                  onChange={(e) =>
                    handleConfigChange("captionPosition", e.target.value)
                  }
                  label="Caption Position"
                  required
                >
                  {Object.values(CaptionPositionEnum).map((position) => (
                    <MenuItem key={position} value={position}>
                      {position}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Caption Background Color"
                value={config.captionBackgroundColor}
                onChange={(e) =>
                  handleConfigChange("captionBackgroundColor", e.target.value)
                }
                helperText="Any valid CSS color (name, hex, rgba)"
                required
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Default Voice</InputLabel>
                <Select
                  value={config.voice}
                  onChange={(e) => handleConfigChange("voice", e.target.value)}
                  label="Default Voice"
                  required
                >
                  {Object.values(VoiceEnum).map((voice) => (
                    <MenuItem key={voice} value={voice}>
                      {voice}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Orientation</InputLabel>
                <Select
                  value={config.orientation}
                  onChange={(e) =>
                    handleConfigChange("orientation", e.target.value)
                  }
                  label="Orientation"
                  required
                >
                  {Object.values(OrientationEnum).map((orientation) => (
                    <MenuItem key={orientation} value={orientation}>
                      {orientation}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Volume of the background audio</InputLabel>
                <Select
                  value={config.musicVolume}
                  onChange={(e) =>
                    handleConfigChange("musicVolume", e.target.value)
                  }
                  label="Volume of the background audio"
                  required
                >
                  {Object.values(MusicVolumeEnum).map((voice) => (
                    <MenuItem key={voice} value={voice}>
                      {voice}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        <Divider sx={{ mb: 4 }} />

        <Typography variant="h6" component="h2" gutterBottom>
          Step 5: Review & Create
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          يرسل الطلب إلى الخادم المحلي على http://localhost:3124. الملفات تحفظ في /app/data/videos (Windows: C:/abud-shorts-engine/data-dev/videos). ستجد الفيديو في صفحة Generated Videos بعد الاكتمال.
        </Typography>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" color="text.secondary">
              Quick review
            </Typography>
            <Typography variant="body2">Template: {selectedTemplate?.displayName || "None (manual)"}</Typography>
            <Typography variant="body2">Brand: {config.brandKit?.brandName || "Not set"}</Typography>
            <Typography variant="body2">Caption Style: {config.brandKit?.captionStyle || "bold"}</Typography>
            <Typography variant="body2">Orientation: {config.orientation}</Typography>
            <Typography variant="body2">Voice: {config.voice}</Typography>
            <Typography variant="body2">Output path: /app/data/videos (Windows: C:/abud-shorts-engine/data-dev/videos)</Typography>
            <Typography variant="body2">Preview & download from: Generated Videos page</Typography>
          </Stack>
        </Paper>

        <Box display="flex" justifyContent="center" mt={1}>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            size="large"
            disabled={loading}
            sx={{ minWidth: 200 }}
          >
            {loading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              "Create Video"
            )}
          </Button>
        </Box>
      </form>
    </Box>
  );
};

export default VideoCreator;
