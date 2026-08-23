import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SendIcon from "@mui/icons-material/Send";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  CaptionPositionEnum,
  MusicMoodEnum,
  MusicVolumeEnum,
  OrientationEnum,
  RenderConfig,
  SceneInput,
  VoiceEnum,
} from "../../types/shorts";
import type { BusinessTemplateId } from "../../short-creator/business-templates";
import { generateScenesForTemplate } from "../../short-creator/templateSceneFactory";
import {
  EmptyState,
  FormSection,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/v2";
import type {
  BusinessTemplateField,
  BusinessTemplateOption,
  CostEstimateData,
  PromptEnhanceResult,
  V2Brand,
} from "./v2Types";

const EXAMPLE_PROMPTS = [
  {
    title: "Egyptian Streetwear Ad (ملابس شبابي)",
    tag: "Arabic · Egyptian",
    prompt:
      "اعمل إعلان 20 ثانية باللهجة المصرية لبراند ملابس شبابي، البداية تكون Hook قوي، ركز على الخامة القطنية والشكل والراحة، وفي النهاية CTA للطلب على واتساب مع خصم خاص.",
  },
  {
    title: "Cairo Modern Café (كافيه قهوة)",
    tag: "Arabic · Egyptian",
    prompt:
      "اعمل فيديو 20 ثانية لكافيه عصري في القاهرة، ركز على ريحة وتحضير القهوة الإسبريسو والقعدة الرايقة وعرض الفطار، والختام دعوة للزيارة.",
  },
  {
    title: "Cairo Burger Restaurant (مطعم برجر)",
    tag: "Arabic · Egyptian",
    prompt:
      "اعمل فيديو 15 ثانية لمطعم برجر في القاهرة، سريع وحماسي، ركز على الجبنة والجرل والعرض الحالي، واختم بـ CTA للطلب دليفري دلوقتي.",
  },
  {
    title: "Tech Educational Short (Backups)",
    tag: "English · Educational",
    prompt:
      "Create a 30-second English educational short explaining why automated backups protect small businesses from data loss, with modern technology visuals and a strong hook.",
  },
  {
    title: "Real Estate Listing (عقارات التجمع)",
    tag: "Arabic · Egyptian",
    prompt:
      "اعمل فيديو إعلان 30 ثانية لشقة مودرن في التجمع الخامس، ركز على المساحة والتشطيب الراقي وأنظمة السداد المرنة، والختام حجز معاينة على واتساب.",
  },
];

type SceneFormData = { text: string; searchTerms: string };

const defaultConfig: RenderConfig = {
  paddingBack: 1500,
  music: MusicMoodEnum.chill,
  captionPosition: CaptionPositionEnum.bottom,
  captionBackgroundColor: "rgba(11, 27, 31, 0.84)",
  voice: VoiceEnum.af_heart,
  orientation: OrientationEnum.portrait,
  musicVolume: MusicVolumeEnum.high,
  brandKit: {
    brandName: "ABUD Demo",
    watermarkText: "ABUD",
    primaryColor: "#24545a",
    accentColor: "#d28b4c",
    captionStyle: "bold",
    includeOutro: true,
    outroText: "Message us to start",
    contactText: "WhatsApp / Instagram",
  },
};

const templateSteps = ["Template", "Content", "Brand", "Settings", "Review"];

function fieldGridSize(field: BusinessTemplateField) {
  return field.type === "textarea" ? 12 : 6;
}

const VideoCreator: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Mode Selection: "prompt" vs "template"
  const [mode, setMode] = useState<"prompt" | "template">("prompt");

  // Prompt Mode States
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("auto");
  const [dialect, setDialect] = useState("egyptian");
  const [duration, setDuration] = useState(30);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [quality, setQuality] = useState("standard");
  const [resolution, setResolution] = useState("1080p");
  const [contentStyle, setContentStyle] = useState("advertisement");
  const [visualMode, setVisualMode] = useState("auto");
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [voiceId, setVoiceId] = useState("af_heart");
  const [captionStyle, setCaptionStyle] = useState<"none" | "clean" | "bold" | "minimal">("bold");

  // Enhancement & Preview states
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceDialog, setEnhanceDialog] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<PromptEnhanceResult | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewSpec, setPreviewSpec] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimateData | null>(null);

  // Template Mode States
  const [templateStep, setTemplateStep] = useState(0);
  const [templates, setTemplates] = useState<BusinessTemplateOption[]>([]);
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [templateData, setTemplateData] = useState<Record<string, string>>({});
  const [scenes, setScenes] = useState<SceneFormData[]>([
    { text: "A concise video narration for a local business.", searchTerms: "business, retail, customer" },
  ]);
  const [config, setConfig] = useState<RenderConfig>(defaultConfig);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      axios.get("/api/v2/templates"),
      axios.get("/api/v2/brands"),
      axios.get("/api/v2/settings"),
    ])
      .then(([templateResponse, brandResponse, settingsResponse]) => {
        const nextTemplates = templateResponse.data.templates || [];
        const nextBrands = brandResponse.data.brands || [];
        const appSettings = settingsResponse.data.settings || {};

        setTemplates(nextTemplates);
        setBrands(nextBrands);

        // Apply settings defaults if present
        if (appSettings.defaultCreationMode === "template") {
          setMode("template");
        }
        if (appSettings.defaultLanguage) setLanguage(appSettings.defaultLanguage);
        if (appSettings.defaultArabicDialect) setDialect(appSettings.defaultArabicDialect);
        if (appSettings.defaultDuration) setDuration(appSettings.defaultDuration);
        if (appSettings.defaultAspectRatio) setAspectRatio(appSettings.defaultAspectRatio);
        if (appSettings.defaultQuality) setQuality(appSettings.defaultQuality);
        if (appSettings.defaultVisualMode) setVisualMode(appSettings.defaultVisualMode);

        const queryTemplate = params.get("template");
        if (queryTemplate) {
          setMode("template");
          setSelectedTemplateId(queryTemplate);
        } else {
          setSelectedTemplateId(appSettings.defaultTemplateId || nextTemplates[0]?.id || "");
        }

        const defaultBrand =
          nextBrands.find((b: V2Brand) => b.id === appSettings.defaultBrandId) ||
          nextBrands.find((b: V2Brand) => b.isDefault) ||
          nextBrands[0];

        if (defaultBrand) applyBrand(defaultBrand);
      })
      .catch(() => setError("Failed to load V2 templates or configuration."))
      .finally(() => setLoading(false));
  }, [params]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const generatedScenes = useMemo(() => {
    if (!selectedTemplate) return [];
    return generateScenesForTemplate(selectedTemplate.id as BusinessTemplateId, templateData);
  }, [selectedTemplate, templateData]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const searchHints = selectedTemplate.pexelsSearchHints.join(", ");
    const nextScenes = (generatedScenes.length
      ? generatedScenes
      : [{ text: "Complete the required fields to generate template narration.", searchTerms: selectedTemplate.pexelsSearchHints }]
    ).map((scene) => ({
      text: scene.text,
      searchTerms: (scene.searchTerms?.length ? scene.searchTerms : selectedTemplate.pexelsSearchHints).join(", ") || searchHints,
    }));
    setScenes(nextScenes);
  }, [selectedTemplate, generatedScenes]);

  function applyBrand(brand: V2Brand) {
    setSelectedBrandId(brand.id);
    setConfig((prev) => ({
      ...prev,
      brandKit: {
        brandName: brand.name,
        watermarkText: brand.watermarkText || brand.name,
        primaryColor: brand.primaryColor || "#24545a",
        accentColor: brand.accentColor || "#d28b4c",
        captionStyle: brand.captionStyle || "bold",
        includeOutro: brand.includeOutro ?? true,
        outroText: brand.outroText || "",
        contactText: brand.contactText || "",
      },
    }));
  }

  function updateBrandKit(field: keyof NonNullable<RenderConfig["brandKit"]>, value: string | boolean) {
    setConfig((prev) => ({
      ...prev,
      brandKit: { ...prev.brandKit, [field]: value },
    }));
  }

  async function handleEnhancePrompt() {
    if (!prompt.trim()) return;
    setEnhancing(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/prompt/enhance", {
        prompt,
        language: language !== "auto" ? language : undefined,
        dialect: dialect !== "none" ? dialect : undefined,
        contentStyle,
      });
      setEnhanceResult(response.data);
      setEnhanceDialog(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Prompt enhancement failed.");
    } finally {
      setEnhancing(false);
    }
  }

  function acceptEnhancedPrompt() {
    if (enhanceResult?.enhancedPrompt) {
      setPrompt(enhanceResult.enhancedPrompt);
    }
    setEnhanceDialog(false);
  }

  async function handlePreviewSpec() {
    if (!prompt.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/production-spec/preview", {
        prompt,
        language,
        dialect: language === "ar" || language === "auto" ? dialect : "none",
        durationSeconds: duration,
        aspectRatio,
        quality,
        resolution,
        contentStyle,
        visualMode,
        voiceProvider,
        voiceId,
        brandId: selectedBrandId || undefined,
        brandName: config.brandKit?.brandName,
      });
      setPreviewSpec(response.data.spec);
      setCostEstimate(response.data.costEstimate);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Production spec preview failed.");
    } finally {
      setPreviewing(false);
    }
  }

  async function submitPromptJob() {
    if (!prompt.trim()) {
      setError("Please write a video prompt.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await axios.post("/api/v2/jobs", {
        creationMode: "prompt",
        prompt,
        language,
        dialect: language === "ar" || language === "auto" ? dialect : "none",
        durationSeconds: duration,
        aspectRatio,
        quality,
        resolution,
        contentStyle,
        visualMode,
        voiceProvider,
        voiceId,
        brandId: selectedBrandId || undefined,
        brandName: config.brandKit?.brandName,
        productionSpec: previewSpec || undefined,
      });
      navigate(`/jobs/${response.data.job.id}`);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Failed to create Prompt Mode video job.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTemplateJob() {
    setSubmitting(true);
    setError(null);
    try {
      const apiScenes: SceneInput[] = scenes.map((scene) => ({
        text: scene.text,
        searchTerms: scene.searchTerms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
      }));
      const businessTemplateData = Object.fromEntries(
        Object.entries(templateData).filter(([, value]) => value.trim().length > 0),
      );
      const title = `${config.brandKit?.brandName || "Video"} · ${selectedTemplate?.displayName || "Manual"}`;
      const response = await axios.post("/api/v2/jobs", {
        type: "video",
        creationMode: "template",
        title,
        scenes: apiScenes,
        config,
        businessTemplateId: selectedTemplateId || undefined,
        businessTemplateData: selectedTemplateId ? businessTemplateData : undefined,
      });
      navigate(`/jobs/${response.data.job.id}`);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Video job could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading Video Studio..." />;

  return (
    <>
      <PageHeader
        title="Create Video"
        eyebrow="AI Production Studio"
        description="Write a natural-language creative prompt or choose a business template. Both modes resolve into one canonical Production Spec."
        actions={
          <ButtonGroup variant="contained">
            <Button
              color={mode === "prompt" ? "primary" : "inherit"}
              variant={mode === "prompt" ? "contained" : "outlined"}
              onClick={() => setMode("prompt")}
            >
              Prompt Mode
            </Button>
            <Button
              color={mode === "template" ? "primary" : "inherit"}
              variant={mode === "template" ? "contained" : "outlined"}
              onClick={() => setMode("template")}
            >
              Template Mode
            </Button>
          </ButtonGroup>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ========================================================================= */}
      {/* PROMPT MODE (DEFAULT & FIRST-CLASS EXPERIENCE)                           */}
      {/* ========================================================================= */}
      {mode === "prompt" && (
        <Stack spacing={3}>
          <SectionCard
            title="AI Creative Director Prompt"
            description="Describe the video you want to produce. Include audience, style, goal, offer, language, and any key details."
            actions={
              <Stack direction="row" spacing={1}>
                {prompt.length > 0 && (
                  <Button
                    size="small"
                    startIcon={<ClearIcon />}
                    onClick={() => setPrompt("")}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AutoAwesomeIcon />}
                  disabled={enhancing || !prompt.trim()}
                  onClick={handleEnhancePrompt}
                >
                  {enhancing ? "Enhancing..." : "Improve Prompt"}
                </Button>
              </Stack>
            }
          >
            <Stack spacing={1.5}>
              <TextField
                fullWidth
                multiline
                minRows={4}
                maxRows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to create. Include the subject, audience, style, goal, offer, language, and anything important."
                helperText={`${prompt.length} / 4000 characters`}
              />

              {/* Example Prompts */}
              <Typography variant="caption" color="text.secondary" fontWeight={700}>
                Example Ideas (click to populate):
              </Typography>
              <Grid container spacing={1.5}>
                {EXAMPLE_PROMPTS.map((ex, idx) => (
                  <Grid item xs={12} sm={6} md={4} key={idx}>
                    <Card
                      variant="outlined"
                      sx={{
                        height: "100%",
                        bgcolor: "background.paper",
                        "&:hover": { borderColor: "primary.main" },
                      }}
                    >
                      <CardActionArea
                        sx={{ p: 1.5, height: "100%", alignItems: "flex-start" }}
                        onClick={() => setPrompt(ex.prompt)}
                      >
                        <Stack spacing={0.5}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle2" fontWeight={800} noWrap>
                              {ex.title}
                            </Typography>
                            <Chip size="small" label={ex.tag} sx={{ fontSize: 10 }} />
                          </Stack>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              fontSize: 12,
                            }}
                          >
                            {ex.prompt}
                          </Typography>
                        </Stack>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Stack>
          </SectionCard>

          {/* Progressive Disclosure: Production Options */}
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6" fontWeight={800}>
                Production Options & Settings
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {/* Language */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Language</InputLabel>
                    <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <MenuItem value="auto">Auto Detect</MenuItem>
                      <MenuItem value="ar">Arabic (العربية)</MenuItem>
                      <MenuItem value="en">English</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Arabic Dialect */}
                {(language === "ar" || language === "auto") && (
                  <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth>
                      <InputLabel>Arabic Dialect</InputLabel>
                      <Select label="Arabic Dialect" value={dialect} onChange={(e) => setDialect(e.target.value)}>
                        <MenuItem value="egyptian">Egyptian Arabic (المصرية)</MenuItem>
                        <MenuItem value="msa">Modern Standard Arabic (الفصحى)</MenuItem>
                        <MenuItem value="saudi">Saudi Arabic (السعودية)</MenuItem>
                        <MenuItem value="gulf">Gulf Arabic (الخليجية)</MenuItem>
                        <MenuItem value="levantine">Levantine Arabic (الشامية)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                )}

                {/* Duration */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Duration</InputLabel>
                    <Select label="Duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      <MenuItem value={15}>15 Seconds</MenuItem>
                      <MenuItem value={20}>20 Seconds</MenuItem>
                      <MenuItem value={30}>30 Seconds (Default)</MenuItem>
                      <MenuItem value={45}>45 Seconds</MenuItem>
                      <MenuItem value={60}>60 Seconds</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Aspect Ratio */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Aspect Ratio</InputLabel>
                    <Select label="Aspect Ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                      <MenuItem value="9:16">9:16 (Vertical Short · Canonical)</MenuItem>
                      <MenuItem value="16:9">16:9 (Landscape · YouTube/Desktop)</MenuItem>
                      <MenuItem value="1:1">1:1 (Square · Instagram/Feed)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Quality Profile */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Quality Profile</InputLabel>
                    <Select label="Quality Profile" value={quality} onChange={(e) => setQuality(e.target.value)}>
                      <MenuItem value="draft">Draft (Fastest / Local)</MenuItem>
                      <MenuItem value="standard">Standard (1080p Balanced)</MenuItem>
                      <MenuItem value="high">High (Multi-Asset / Fast Paced)</MenuItem>
                      <MenuItem value="premium">Premium (AI Video + Voice)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Resolution */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Resolution</InputLabel>
                    <Select label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      <MenuItem value="1080p">1080p (Full HD)</MenuItem>
                      <MenuItem value="720p">720p (HD)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Content Style */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Content Style</InputLabel>
                    <Select label="Content Style" value={contentStyle} onChange={(e) => setContentStyle(e.target.value)}>
                      <MenuItem value="advertisement">Advertisement</MenuItem>
                      <MenuItem value="ugc">UGC (User Generated)</MenuItem>
                      <MenuItem value="cinematic">Cinematic</MenuItem>
                      <MenuItem value="educational">Educational</MenuItem>
                      <MenuItem value="explainer">Explainer</MenuItem>
                      <MenuItem value="viral_curiosity">Viral / Curiosity</MenuItem>
                      <MenuItem value="product_showcase">Product Showcase</MenuItem>
                      <MenuItem value="social_short">Social Short</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Visual Mode */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Visual Mode</InputLabel>
                    <Select label="Visual Mode" value={visualMode} onChange={(e) => setVisualMode(e.target.value)}>
                      <MenuItem value="auto">Auto (Smart Stock / AI)</MenuItem>
                      <MenuItem value="stock">Stock Only (Pexels - Free)</MenuItem>
                      <MenuItem value="ai">AI Video (Veo / Fal)</MenuItem>
                      <MenuItem value="hybrid">Hybrid (Mixed Stock + AI)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Voice Provider */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Voice Provider</InputLabel>
                    <Select label="Voice Provider" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value)}>
                      <MenuItem value="auto">Auto (Local / Free)</MenuItem>
                      <MenuItem value="kokoro">Kokoro TTS (Local / Free)</MenuItem>
                      <MenuItem value="elevenlabs">ElevenLabs (Premium Multilingual)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Captions Style */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Captions Style</InputLabel>
                    <Select label="Captions Style" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as any)}>
                      <MenuItem value="bold">Bold (Cyan Pop · Active Scale)</MenuItem>
                      <MenuItem value="viral">Viral (Kinetic Yellow Glow)</MenuItem>
                      <MenuItem value="clean">Clean (Dark Box / Subtitle)</MenuItem>
                      <MenuItem value="minimal">Minimal (Clean Text)</MenuItem>
                      <MenuItem value="brand">Brand Palette (Dynamic)</MenuItem>
                      <MenuItem value="none">None</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Saved Brand */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Brand Profile</InputLabel>
                    <Select
                      label="Brand Profile"
                      value={selectedBrandId}
                      onChange={(e) => {
                        const b = brands.find((item) => item.id === e.target.value);
                        if (b) applyBrand(b);
                      }}
                    >
                      <MenuItem value="">Custom / None</MenuItem>
                      {brands.map((b) => (
                        <MenuItem key={b.id} value={b.id}>
                          {b.name} {b.isDefault ? "(Default)" : ""}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>

          {/* Cost Estimate & Live Spec Preview */}
          <SectionCard
            title="Production Spec & Cost Breakdown"
            description="Review the planned scenes and external API cost estimate before launching generation."
            actions={
              <Button
                variant="outlined"
                startIcon={<VisibilityIcon />}
                disabled={previewing || !prompt.trim()}
                onClick={handlePreviewSpec}
              >
                {previewing ? "Planning..." : "Preview Production Spec"}
              </Button>
            }
          >
            {previewSpec ? (
              <Stack spacing={2}>
                {/* Duration Diagnostics Breakdown */}
                <Card variant="outlined" sx={{ p: 2, bgcolor: "background.paper" }}>
                  <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                    Timeline & Duration Breakdown
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Requested Duration</Typography>
                      <Typography variant="body1" fontWeight={700}>{previewSpec.durationSeconds}s</Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Scene Count</Typography>
                      <Typography variant="body1" fontWeight={700}>{previewSpec.scenes?.length || 0}</Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Scenes Total</Typography>
                      <Typography variant="body1" fontWeight={700}>
                        {Math.round((previewSpec.scenes?.reduce((acc: number, s: any) => acc + (s.durationSeconds || 0), 0) || 0) * 10) / 10}s
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary">Branded Outro</Typography>
                      <Typography variant="body1" fontWeight={700}>
                        {config.brandKit?.includeOutro ? "2.0s (Budgeted)" : "None (0s)"}
                      </Typography>
                    </Grid>
                  </Grid>
                </Card>

                <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
                  <StatusBadge status="ready" label={`Target: ${previewSpec.durationSeconds}s`} />
                  <StatusBadge status="ready" label={`Dialect: ${previewSpec.dialect || "none"}`} />
                  <Chip
                    color={costEstimate?.isFree ? "success" : "warning"}
                    label={
                      costEstimate?.isFree
                        ? "Estimated External API Cost: $0 (Free Local Pipeline)"
                        : `Estimated External Cost: $${costEstimate?.estimatedCost} USD`
                    }
                  />
                </Stack>

                <Grid container spacing={1.5}>
                  {previewSpec.scenes?.map((scene: any, idx: number) => (
                    <Grid item xs={12} md={6} key={idx}>
                      <Card variant="outlined" sx={{ p: 1.5 }}>
                        <Stack spacing={0.5}>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="subtitle2" fontWeight={800}>
                              Scene {idx + 1} ({scene.purpose?.toUpperCase()})
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {scene.durationSeconds}s
                            </Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                            "{scene.narration}"
                          </Typography>
                          {scene.onScreenText && (
                            <Typography variant="caption" color="primary">
                              On Screen: {scene.onScreenText}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            Footage: {scene.stockSearchTerms?.join(", ")}
                          </Typography>
                        </Stack>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Click "Preview Production Spec" to inspect the scene breakdown and narration before generating, or click "Create Video Job" to submit directly.
              </Typography>
            )}
          </SectionCard>

          {/* Submit Action */}
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<SendIcon />}
              disabled={submitting || !prompt.trim()}
              onClick={submitPromptJob}
            >
              {submitting ? "Starting Production..." : "Create Video Job"}
            </Button>
          </Stack>
        </Stack>
      )}

      {/* ========================================================================= */}
      {/* PROMPT ENHANCEMENT COMPARISON DIALOG                                      */}
      {/* ========================================================================= */}
      <Dialog open={enhanceDialog} onClose={() => setEnhanceDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>AI Prompt Enhancement</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {enhanceResult?.changesSummary && (
              <Alert severity="info">{enhanceResult.changesSummary}</Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight={800} color="text.secondary">
                  Original Prompt
                </Typography>
                <Card variant="outlined" sx={{ p: 1.5, mt: 1, minHeight: 120, bgcolor: "action.hover" }}>
                  <Typography variant="body2">{enhanceResult?.originalPrompt}</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" fontWeight={800} color="primary">
                  Enhanced Prompt
                </Typography>
                <Card variant="outlined" sx={{ p: 1.5, mt: 1, minHeight: 120, borderColor: "primary.main" }}>
                  <Typography variant="body2">{enhanceResult?.enhancedPrompt}</Typography>
                </Card>
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnhanceDialog(false)}>Keep Original</Button>
          <Button variant="contained" onClick={acceptEnhancedPrompt}>
            Use Enhanced Prompt
          </Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* TEMPLATE MODE (PRESERVED BUSINESS TEMPLATES)                              */}
      {/* ========================================================================= */}
      {mode === "template" && (
        <Stack spacing={2.25}>
          <SectionCard>
            <Stepper activeStep={templateStep} alternativeLabel sx={{ mb: 3 }}>
              {templateSteps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {templateSteps.map((step, index) => (
                <Button
                  key={step}
                  size="small"
                  variant={templateStep === index ? "contained" : "outlined"}
                  onClick={() => setTemplateStep(index)}
                >
                  {step}
                </Button>
              ))}
            </Stack>
          </SectionCard>

          {templateStep === 0 && (
            <FormSection title="Template Selection" description="Choose a validated business template.">
              <Grid container spacing={2}>
                {templates.map((template) => (
                  <Grid item xs={12} md={6} xl={4} key={template.id}>
                    <SectionCard>
                      <Stack spacing={1.25}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="h6">{template.displayName}</Typography>
                          {selectedTemplateId === template.id && <StatusBadge status="ready" label="Selected" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{template.description}</Typography>
                        <Typography variant="caption" color="text.secondary">{template.targetUseCase}</Typography>
                        <Button
                          variant={selectedTemplateId === template.id ? "contained" : "outlined"}
                          onClick={() => setSelectedTemplateId(template.id)}
                        >
                          Use Template
                        </Button>
                      </Stack>
                    </SectionCard>
                  </Grid>
                ))}
              </Grid>
            </FormSection>
          )}

          {templateStep === 1 && (
            <FormSection title="Content" description="Required fields drive generated narration and Pexels search terms.">
              {selectedTemplate && (
                <Grid container spacing={2}>
                  {selectedTemplate.fields.map((field) => (
                    <Grid item xs={12} md={fieldGridSize(field)} key={field.key}>
                      {field.type === "select" ? (
                        <FormControl fullWidth>
                          <InputLabel>{field.label}</InputLabel>
                          <Select
                            label={field.label}
                            required={field.required}
                            value={templateData[field.key] || ""}
                            onChange={(e) => setTemplateData({ ...templateData, [field.key]: e.target.value })}
                          >
                            <MenuItem value="">Select</MenuItem>
                            {(field.options || []).map((opt) => (
                              <MenuItem value={opt} key={opt}>{opt}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <TextField
                          fullWidth
                          required={field.required}
                          type={field.type === "number" ? "number" : "text"}
                          multiline={field.type === "textarea"}
                          minRows={field.type === "textarea" ? 3 : undefined}
                          label={field.label}
                          placeholder={field.placeholder}
                          helperText={field.helperText}
                          value={templateData[field.key] || ""}
                          onChange={(e) => setTemplateData({ ...templateData, [field.key]: e.target.value })}
                        />
                      )}
                    </Grid>
                  ))}
                </Grid>
              )}
              <SectionCard title="Narration Preview" description="Generated from the selected template and field values.">
                <Stack spacing={1.5}>
                  {scenes.map((scene, index) => (
                    <TextField
                      key={index}
                      label={`Scene ${index + 1}`}
                      value={scene.text}
                      multiline
                      minRows={2}
                      fullWidth
                      onChange={(event) => {
                        const next = [...scenes];
                        next[index] = { ...next[index], text: event.target.value };
                        setScenes(next);
                      }}
                    />
                  ))}
                </Stack>
              </SectionCard>
            </FormSection>
          )}

          {templateStep === 2 && (
            <FormSection title="Brand Kit" description="Select a saved brand or customize Brand Kit for this video.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Saved Brand</InputLabel>
                    <Select
                      label="Saved Brand"
                      value={selectedBrandId}
                      onChange={(event) => {
                        const brand = brands.find((item) => item.id === event.target.value);
                        if (brand) applyBrand(brand);
                      }}
                    >
                      <MenuItem value="">Custom</MenuItem>
                      {brands.map((brand) => (
                        <MenuItem key={brand.id} value={brand.id}>{brand.name}{brand.isDefault ? " (default)" : ""}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Brand Name" value={config.brandKit?.brandName || ""} onChange={(e) => updateBrandKit("brandName", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Watermark" value={config.brandKit?.watermarkText || ""} onChange={(e) => updateBrandKit("watermarkText", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField fullWidth type="color" label="Primary Color" value={config.brandKit?.primaryColor || "#24545a"} onChange={(e) => updateBrandKit("primaryColor", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField fullWidth type="color" label="Accent Color" value={config.brandKit?.accentColor || "#d28b4c"} onChange={(e) => updateBrandKit("accentColor", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControl fullWidth>
                    <InputLabel>Caption Style</InputLabel>
                    <Select label="Caption Style" value={config.brandKit?.captionStyle || "bold"} onChange={(e) => updateBrandKit("captionStyle", e.target.value)}>
                      <MenuItem value="clean">Clean</MenuItem>
                      <MenuItem value="bold">Bold</MenuItem>
                      <MenuItem value="minimal">Minimal</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <FormControlLabel
                    control={<Checkbox checked={config.brandKit?.includeOutro === true} onChange={(event) => updateBrandKit("includeOutro", event.target.checked)} />}
                    label="Outro"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Outro Text" value={config.brandKit?.outroText || ""} onChange={(e) => updateBrandKit("outroText", e.target.value)} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField fullWidth label="Contact" value={config.brandKit?.contactText || ""} onChange={(e) => updateBrandKit("contactText", e.target.value)} />
                </Grid>
              </Grid>
            </FormSection>
          )}

          {templateStep === 3 && (
            <FormSection title="Video Settings" description="Render settings for template mode.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Voice</InputLabel>
                    <Select label="Voice" value={config.voice} onChange={(e) => setConfig({ ...config, voice: e.target.value as any })}>
                      {Object.values(VoiceEnum).map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Music</InputLabel>
                    <Select label="Music" value={config.music} onChange={(e) => setConfig({ ...config, music: e.target.value as any })}>
                      {Object.values(MusicMoodEnum).map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Orientation</InputLabel>
                    <Select label="Orientation" value={config.orientation} onChange={(e) => setConfig({ ...config, orientation: e.target.value as any })}>
                      {Object.values(OrientationEnum).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </FormSection>
          )}

          {templateStep === 4 && (
            <FormSection title="Review & Submit" description="Submitting creates a Production Spec job persisted in PostgreSQL.">
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <SectionCard title="Request Overview">
                    <Stack spacing={1}>
                      <Typography>Template: {selectedTemplate?.displayName}</Typography>
                      <Typography>Brand: {config.brandKit?.brandName || "Custom"}</Typography>
                      <Typography>Scenes: {scenes.length}</Typography>
                    </Stack>
                  </SectionCard>
                </Grid>
                <Grid item xs={12} md={6}>
                  <SectionCard title="Pipeline Components">
                    <Stack spacing={1}>
                      {["Pexels Stock", "Kokoro TTS", "Whisper Captions", "Remotion / FFmpeg"].map((item) => (
                        <Stack key={item} direction="row" justifyContent="space-between">
                          <Typography>{item}</Typography>
                          <StatusBadge status="ready" label="Included" />
                        </Stack>
                      ))}
                    </Stack>
                  </SectionCard>
                </Grid>
              </Grid>
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                <Button variant="contained" size="large" startIcon={<SendIcon />} disabled={submitting} onClick={submitTemplateJob}>
                  {submitting ? "Creating..." : "Create Video Job"}
                </Button>
              </Stack>
            </FormSection>
          )}

          <Stack direction="row" justifyContent="space-between">
            <Button disabled={templateStep === 0} onClick={() => setTemplateStep((s) => Math.max(s - 1, 0))}>
              Back
            </Button>
            <Button disabled={templateStep === templateSteps.length - 1} variant="outlined" onClick={() => setTemplateStep((s) => Math.min(s + 1, templateSteps.length - 1))}>
              Next
            </Button>
          </Stack>
        </Stack>
      )}
    </>
  );
};

export default VideoCreator;
