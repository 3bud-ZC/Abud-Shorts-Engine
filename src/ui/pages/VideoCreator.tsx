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
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
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
  ProviderItem,
  V2Brand,
} from "./v2Types";
import { withMediaAccessToken } from "../utils/auth";

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
type VoiceOption = {
  id: string;
  name: string;
  provider: string;
  tier?: string;
  language: string;
  dialect?: string;
  gender?: string;
  voiceFamily?: string;
  sampleRate?: number;
};

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

/**
 * A usage-based provider such as ElevenLabs must never be presented as a $0
 * external cost, and the engine does not invent a dollar figure it cannot
 * calculate reliably.
 */
function costLabel(costEstimate: CostEstimateData | null): string {
  if (!costEstimate) return "External API Cost: $0";
  const voice = costEstimate.breakdown?.voice;
  const usageBased =
    costEstimate.usageBased ||
    voice?.usageBased ||
    voice?.estimatedCostTier === "premium" ||
    voice?.estimatedCostTier === "cloud_free_tier";
  if (usageBased) {
    const providerLabel = voice?.provider === "elevenlabs" ? "ElevenLabs" : voice?.provider || "Cloud provider";
    return `External API Cost: ${providerLabel} · Cloud / Usage Based`;
  }
  if (costEstimate.isFree || costEstimate.estimatedCost === 0) {
    return "External API Cost: $0";
  }
  return `External API Cost: ${costEstimate.estimatedCost} USD`;
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
  const [productionMode, setProductionMode] = useState("auto_hybrid");
  const [visualMode, setVisualMode] = useState("auto");
  const [voiceProvider, setVoiceProvider] = useState("auto");
  const [voiceId, setVoiceId] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [resolvedVoiceProvider, setResolvedVoiceProvider] = useState<string>("auto");
  const [voiceWarnings, setVoiceWarnings] = useState<string[]>([]);
  const [arabicVoiceBlocked, setArabicVoiceBlocked] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<"none" | "cinematic" | "viral_bold" | "clean" | "minimal" | "product_ad" | "educational" | "bold" | "viral" | "brand">("viral_bold");

  // Enhancement & Preview states
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceDialog, setEnhanceDialog] = useState(false);
  const [enhanceResult, setEnhanceResult] = useState<PromptEnhanceResult | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewSpec, setPreviewSpec] = useState<any>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimateData | null>(null);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const [voicePreview, setVoicePreview] = useState<any>(null);
  const [providers, setProviders] = useState<ProviderItem[]>([]);

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

  // Product Media & Readiness states
  const [selectedProductMediaId, setSelectedProductMediaId] = useState<string>("");
  const [uploadedProducts, setUploadedProducts] = useState<any[]>([]);
  const [productHeadline, setProductHeadline] = useState("عرض حصري لفترة محدودة");
  const [productOffer, setProductOffer] = useState("خصم 25%");
  const [productPrice, setProductPrice] = useState("");
  const [productCta, setProductCta] = useState("اطلب الآن عبر واتساب");
  const [productPlacement, setProductPlacement] = useState<"center" | "left" | "right">("center");
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [modeReadiness, setModeReadiness] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      axios.get("/api/v2/templates"),
      axios.get("/api/v2/brands"),
      axios.get("/api/v2/settings"),
      axios.get("/api/v2/providers").catch(() => ({ data: { providers: [] } })),
    ])
      .then(([templateResponse, brandResponse, settingsResponse, providerResponse]) => {
        const nextTemplates = templateResponse.data.templates || [];
        const nextBrands = brandResponse.data.brands || [];
        const appSettings = settingsResponse.data.settings || {};

        setTemplates(nextTemplates);
        setBrands(nextBrands);
        setProviders(providerResponse.data.providers || []);

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

    axios.get("/api/v2/media/products").then((res) => {
      const prods = res.data.products || [];
      setUploadedProducts(prods);
      if (prods.length > 0 && !selectedProductMediaId) {
        setSelectedProductMediaId(prods[0].id);
      }
    }).catch(() => {});
  }, [params]);

  useEffect(() => {
    axios
      .get("/api/v2/system/readiness", {
        params: { mode: productionMode, visualMode },
      })
      .then((res) => {
        setModeReadiness(res.data);
      })
      .catch(() => {});
  }, [productionMode, visualMode]);

  async function handleProductFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProduct(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const res = await axios.post("/api/v2/media/product-upload", {
            imageBase64: base64,
            filename: file.name,
            removeBackground: true,
          });
          const newMedia = res.data.media;
          setSelectedProductMediaId(newMedia.id);
          setUploadedProducts((prev) => [newMedia, ...prev.filter((p) => p.id !== newMedia.id)]);
        } catch (uploadErr: any) {
          setError(uploadErr?.response?.data?.error || "Product image upload failed.");
        } finally {
          setUploadingProduct(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingProduct(false);
    }
  }

  useEffect(() => {
    axios
      .get("/api/v2/voices", {
        params: {
          provider: voiceProvider,
          language,
          dialect: language === "ar" || language === "auto" ? dialect : "none",
        },
      })
      .then((response) => {
        const nextVoices: VoiceOption[] = response.data.voices || [];
        setVoiceOptions(nextVoices);
        setResolvedVoiceProvider(response.data.resolvedProvider || voiceProvider);
        setVoiceWarnings(response.data.warnings || []);
        setArabicVoiceBlocked(Boolean(response.data.blocked));
        if (nextVoices.length > 0 && !nextVoices.some((voice) => voice.id === voiceId)) {
          setVoiceId(nextVoices[0].id);
        } else if (nextVoices.length === 0) {
          setVoiceId("");
        }
      })
      .catch(() => {
        setVoiceOptions([]);
        setVoiceWarnings(["Voice compatibility lookup failed."]);
      });
  }, [language, dialect, voiceProvider, voiceId]);

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

  const selectedVoiceProvider = useMemo(() => {
    if (voiceProvider === "auto") return null;
    return providers.find(
      (provider) =>
        provider.id === voiceProvider ||
        provider.name.toLowerCase().includes(voiceProvider.replaceAll("_", " ")),
    );
  }, [providers, voiceProvider]);

  const selectedProviderUnavailable = Boolean(
    voiceProvider !== "auto" &&
      selectedVoiceProvider &&
      selectedVoiceProvider.configured === false,
  );

  const isArabicMode = language === "ar" || (language === "auto" && dialect !== "none");
  const selectedVoice = voiceOptions.find((voice) => voice.id === voiceId);

  const elevenLabsProvider = useMemo(
    () => providers.find((provider) => provider.id === "elevenlabs" || provider.name === "ElevenLabs"),
    [providers],
  );
  const elevenLabsConfigured = elevenLabsProvider?.configured !== false;

  // Arabic / Egyptian / MSA narration is served by ElevenLabs only. Without a
  // configured credential the job would fail during render, so the form blocks
  // submission up front and offers the configure action instead.
  const arabicBlocked = Boolean(isArabicMode && (arabicVoiceBlocked || !elevenLabsConfigured));

  function voiceProviderGuidance(): string {
    if (isArabicMode) {
      return "Arabic, Egyptian Arabic and MSA narration is produced with ElevenLabs. Voice quality is judged by you in Providers - Voice Lab; the engine does not label any voice as Egyptian on its own.";
    }
    if (voiceProvider === "piper") return "Piper is legacy only. It stays available so historical videos remain readable and is not used for new production.";
    if (voiceProvider === "edge_tts") return "Edge TTS is experimental, online, and disabled by default. It is never a production Arabic route.";
    if (voiceProvider === "google_cloud_tts") return "Google Cloud TTS remains integrated for manual use. It is not part of the standard Arabic production path.";
    if (voiceProvider === "kokoro") return "Kokoro is the local/free English path and remains the default for English production.";
    if (voiceProvider === "elevenlabs") return "ElevenLabs runs when credentials are configured. Cost is usage based on your ElevenLabs plan.";
    return `Auto resolves to ${resolvedVoiceProvider === "kokoro" ? "Kokoro English" : resolvedVoiceProvider} for the chosen language.`;
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
        captionStyle,
        productionMode,
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

  async function handleVoicePreview() {
    const sampleText = (previewSpec?.scenes?.[0]?.narration || prompt).trim().slice(0, 360);
    if (!sampleText) return;
    setVoicePreviewing(true);
    setVoicePreview(null);
    setError(null);
    try {
      const response = await axios.post("/api/voice-preview", {
        text: sampleText,
        language,
        dialect: language === "ar" || language === "auto" ? dialect : "none",
        qualityProfile: quality === "premium" || quality === "high" ? "premium" : quality === "draft" ? "fast" : "balanced",
        provider: voiceProvider,
        voiceId: voiceId || undefined,
      });
      setVoicePreview(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Voice preview failed.");
    } finally {
      setVoicePreviewing(false);
    }
  }

  async function submitPromptJob() {
    if (!prompt.trim()) {
      setError("Please write a video prompt.");
      return;
    }
    if (arabicBlocked) {
      setError("ElevenLabs is required for Arabic narration. Configure ElevenLabs in Providers before creating an Arabic video.");
      return;
    }
    if (selectedProviderUnavailable) {
      setError("The selected voice provider is not configured. Choose a local provider or configure it in Providers first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await axios.post(
        "/api/v2/jobs",
        {
          creationMode: "prompt",
          prompt,
          language,
          dialect: language === "ar" || language === "auto" ? dialect : "none",
          durationSeconds: duration,
          aspectRatio,
          quality,
          resolution,
          contentStyle,
          productionMode,
          visualMode,
          voiceProvider,
          voiceId,
          captionStyle,
          brandId: selectedBrandId || undefined,
          brandName: config.brandKit?.brandName,
          productionSpec: previewSpec || undefined,
          metadata: {
            productImageId: selectedProductMediaId || undefined,
            productHeadline,
            productOffer,
            productPrice,
            productCta,
            productPlacement,
          },
        },
        {
          headers: {
            "Idempotency-Key": `create-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
          },
        },
      );
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
        eyebrow="Production Studio"
        description="Start with a prompt, choose the essential video settings, preview the voice, then create a production job."
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
                Video settings
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                {/* Language */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="language-select-label">Language</InputLabel>
                    <Select labelId="language-select-label" id="language-select" label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
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
                      <InputLabel id="dialect-select-label">Arabic Dialect</InputLabel>
                      <Select labelId="dialect-select-label" id="dialect-select" label="Arabic Dialect" value={dialect} onChange={(e) => setDialect(e.target.value)}>
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
                    <InputLabel id="duration-select-label">Duration</InputLabel>
                    <Select labelId="duration-select-label" id="duration-select" label="Duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                      <MenuItem value={15}>15s</MenuItem>
                      <MenuItem value={20}>20s</MenuItem>
                      <MenuItem value={30}>30s</MenuItem>
                      <MenuItem value={45}>45s</MenuItem>
                      <MenuItem value={60}>60s</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Aspect Ratio */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="aspect-ratio-select-label">Aspect Ratio</InputLabel>
                    <Select labelId="aspect-ratio-select-label" id="aspect-ratio-select" label="Aspect Ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                      <MenuItem value="9:16">9:16 - Shorts / Reels / TikTok</MenuItem>
                      <MenuItem value="16:9">16:9 - YouTube / Landscape</MenuItem>
                      <MenuItem value="1:1">1:1 - Square feed</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Production Mode */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="production-mode-select-label">Production Mode</InputLabel>
                    <Select labelId="production-mode-select-label" id="production-mode-select" label="Production Mode" value={productionMode} onChange={(e) => setProductionMode(e.target.value)}>
                      <MenuItem value="auto_hybrid">AUTO HYBRID - smart mixed source</MenuItem>
                      <MenuItem value="stock_cinematic">STOCK CINEMATIC - polished stock edit</MenuItem>
                      <MenuItem value="product_ad">PRODUCT AD - product composition</MenuItem>
                      <MenuItem value="motion_graphics">MOTION GRAPHICS - animated graphics</MenuItem>
                      <MenuItem value="animated_explainer">ANIMATED EXPLAINER - Motion Canvas</MenuItem>
                      <MenuItem value="ai_generated">AI GENERATED - optional GPU/cloud only</MenuItem>
                      <MenuItem value="social_viral">SOCIAL VIRAL - fast hooks and pacing</MenuItem>
                      <MenuItem value="educational">EDUCATIONAL - clear teaching flow</MenuItem>
                      <MenuItem value="custom_media">CUSTOM MEDIA - uploaded-media first</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Quality Profile */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="quality-select-label">Quality Profile</InputLabel>
                    <Select labelId="quality-select-label" id="quality-select" label="Quality Profile" value={quality} onChange={(e) => setQuality(e.target.value)}>
                      <MenuItem value="draft">FAST - quick local production</MenuItem>
                      <MenuItem value="standard">BALANCED - recommended quality/time balance</MenuItem>
                      <MenuItem value="high">BALANCED+ - richer visual pacing</MenuItem>
                      <MenuItem value="max_quality_local">MAX QUALITY LOCAL - strongest free/local route</MenuItem>
                      <MenuItem value="premium">PREMIUM - configured premium services only</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Resolution */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="resolution-select-label">Resolution</InputLabel>
                    <Select labelId="resolution-select-label" id="resolution-select" label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      <MenuItem value="1080p">1080p (Full HD)</MenuItem>
                      <MenuItem value="720p">720p (HD)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Content Style */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="content-style-select-label">Content Style</InputLabel>
                    <Select labelId="content-style-select-label" id="content-style-select" label="Content Style" value={contentStyle} onChange={(e) => setContentStyle(e.target.value)}>
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
                    <InputLabel id="visual-mode-select-label">Visual Mode</InputLabel>
                    <Select labelId="visual-mode-select-label" id="visual-mode-select" label="Visual Mode" value={visualMode} onChange={(e) => setVisualMode(e.target.value)}>
                      <MenuItem value="auto">Auto source router</MenuItem>
                      <MenuItem value="stock">Stock cinematic (Pexels)</MenuItem>
                      <MenuItem value="uploaded_media">Uploaded media first</MenuItem>
                      <MenuItem value="motion_graphics">Motion graphics</MenuItem>
                      <MenuItem value="animated_explainer">Animated explainer</MenuItem>
                      <MenuItem value="product_ad">Product composition</MenuItem>
                      <MenuItem value="image_animation">Image animation</MenuItem>
                      <MenuItem value="hybrid">Mixed source</MenuItem>
                      <MenuItem value="ai">AI video (configured optional providers only)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Voice Provider */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="voice-provider-select-label">Voice Provider</InputLabel>
                    <Select
                      labelId="voice-provider-select-label"
                      id="voice-provider-select"
                      label="Voice Provider"
                      value={voiceProvider}
                      onChange={(e) => {
                        const nextProvider = e.target.value;
                        setVoiceProvider(nextProvider);
                        setVoiceId("");
                      }}
                    >
                      <MenuItem value="auto">
                        {isArabicMode ? "Auto - ElevenLabs (Arabic production)" : "Auto - safest local provider"}
                      </MenuItem>
                      <MenuItem value="elevenlabs">ElevenLabs - Arabic production / multilingual</MenuItem>
                      <MenuItem value="kokoro" disabled={isArabicMode}>Kokoro - English local / free</MenuItem>
                      <MenuItem value="piper" disabled>Piper - legacy, historical jobs only</MenuItem>
                      <MenuItem value="edge_tts" disabled={isArabicMode}>Edge TTS - experimental, not for Arabic</MenuItem>
                      <MenuItem value="google_cloud_tts" disabled={isArabicMode}>Google Cloud TTS - manual use, not the Arabic route</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="voice-select-label">Voice</InputLabel>
                    <Select labelId="voice-select-label" id="voice-select" label="Voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                      <MenuItem value="">Auto-select</MenuItem>
                      {voiceProvider === "google_cloud_tts" && voiceOptions.length === 0 && (
                        <MenuItem value="" disabled>
                          Configure Google credentials to load ar-XA voices
                        </MenuItem>
                      )}
                      {voiceOptions.map((voice) => (
                        <MenuItem key={`${voice.provider}-${voice.id}`} value={voice.id}>
                          {voice.name}
                          {voice.provider ? ` · ${voice.provider}` : ""}
                          {voice.voiceFamily ? ` · ${voice.voiceFamily}` : ""}
                          {voice.dialect ? ` · ${voice.dialect}` : ""}
                          {voice.gender ? ` · ${voice.gender}` : ""}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* Captions Style */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="captions-style-select-label">Captions Style</InputLabel>
                    <Select labelId="captions-style-select-label" id="captions-style-select" label="Captions Style" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as any)}>
                      <MenuItem value="cinematic">Cinematic</MenuItem>
                      <MenuItem value="viral_bold">Viral Bold</MenuItem>
                      <MenuItem value="clean">Clean</MenuItem>
                      <MenuItem value="minimal">Minimal</MenuItem>
                      <MenuItem value="product_ad">Product Ad</MenuItem>
                      <MenuItem value="educational">Educational</MenuItem>
                      <MenuItem value="none">None</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Saved Brand */}
                <Grid item xs={12} sm={6} md={3}>
                  <FormControl fullWidth>
                    <InputLabel id="brand-profile-select-label">Brand Profile</InputLabel>
                    <Select
                      labelId="brand-profile-select-label"
                      id="brand-profile-select"
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

              {modeReadiness && (
                <Box sx={{ mt: 2, p: 1.5, bgcolor: modeReadiness.ready ? "rgba(36,84,90,0.06)" : "rgba(220,38,38,0.08)", borderRadius: 2, border: "1px solid", borderColor: modeReadiness.ready ? "rgba(36,84,90,0.2)" : "rgba(220,38,38,0.3)" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="caption" fontWeight={800} color={modeReadiness.ready ? "primary.main" : "error.main"}>
                      {modeReadiness.ready ? "Capability Readiness: READY" : "Capability Requirements Check:"}
                    </Typography>
                    {modeReadiness.capabilities?.map((cap: any) => (
                      <Chip
                        key={cap.id}
                        size="small"
                        label={`${cap.ready ? "✓" : "✗"} ${cap.name}`}
                        color={cap.ready ? "success" : cap.required ? "error" : "default"}
                        variant={cap.ready ? "filled" : "outlined"}
                        sx={{ fontSize: 11, height: 22 }}
                      />
                    ))}
                  </Stack>
                  {!modeReadiness.ready && modeReadiness.missingRequirements?.length > 0 && (
                    <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5, fontWeight: 600 }}>
                      {modeReadiness.missingRequirements.join(" • ")}
                    </Typography>
                  )}
                </Box>
              )}
            </AccordionDetails>
          </Accordion>

          {productionMode === "product_ad" && (
            <SectionCard
              title="Product Media & Presentation"
              description="Upload your product image or select an existing asset. Background removal is automatically applied."
              actions={
                <Button
                  variant="contained"
                  component="label"
                  size="small"
                  disabled={uploadingProduct}
                >
                  {uploadingProduct ? "Uploading & Removing Background..." : "Upload Product Image"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleProductFileUpload} />
                </Button>
              }
            >
              <Stack spacing={2}>
                {uploadedProducts.length > 0 && (
                  <FormControl fullWidth size="small">
                    <InputLabel id="product-media-select-label">Select Product Asset</InputLabel>
                    <Select
                      labelId="product-media-select-label"
                      label="Select Product Asset"
                      value={selectedProductMediaId}
                      onChange={(e) => setSelectedProductMediaId(e.target.value)}
                    >
                      {uploadedProducts.map((prod) => (
                        <MenuItem key={prod.id} value={prod.id}>
                          {prod.originalName} ({prod.width}x{prod.height}) · {prod.nobgArtifactId ? "Background Removed ✓" : "Original"}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Headline Banner"
                      value={productHeadline}
                      onChange={(e) => setProductHeadline(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="عرض حصري لفترة محدودة"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Offer Badge"
                      value={productOffer}
                      onChange={(e) => setProductOffer(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="خصم 25%"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      label="Price Tag (Optional)"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="199 ج.م"
                    />
                  </Grid>
                  <Grid item xs={12} sm={8}>
                    <TextField
                      label="CTA Button Text"
                      value={productCta}
                      onChange={(e) => setProductCta(e.target.value)}
                      fullWidth
                      size="small"
                      placeholder="اطلب الآن عبر واتساب"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="placement-label">Product Placement</InputLabel>
                      <Select
                        labelId="placement-label"
                        label="Product Placement"
                        value={productPlacement}
                        onChange={(e) => setProductPlacement(e.target.value as any)}
                      >
                        <MenuItem value="center">Center</MenuItem>
                        <MenuItem value="left">Left</MenuItem>
                        <MenuItem value="right">Right</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Stack>
            </SectionCard>
          )}

          {arabicBlocked && (
            <Alert
              severity="error"
              action={
                <Button size="small" variant="contained" onClick={() => navigate("/providers")}>
                  Configure ElevenLabs
                </Button>
              }
            >
              ElevenLabs is required for Arabic narration. Arabic production is blocked until an ElevenLabs API key is configured in Providers.
            </Alert>
          )}
          <Alert severity={selectedProviderUnavailable && !arabicBlocked ? "warning" : "info"}>
            {voiceProviderGuidance()} {selectedProviderUnavailable && !arabicBlocked ? "Configure it in Providers before creating a video." : ""}
          </Alert>
          {selectedVoice && (
            <Alert severity="success">
              Resolved voice: {selectedVoice.provider} / {selectedVoice.id}
            </Alert>
          )}
          {voiceWarnings.length > 0 && (
            <Alert severity="warning">
              {voiceWarnings.join(" ")}
            </Alert>
          )}

          <SectionCard
            title="Voice Preview"
            description="Generate a short narration sample before committing to a full render."
            actions={
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={voicePreviewing || !prompt.trim() || selectedProviderUnavailable || arabicBlocked}
                onClick={handleVoicePreview}
              >
                {voicePreviewing ? "Generating..." : "Preview Voice"}
              </Button>
            }
          >
            <Stack spacing={1.5}>
              {voiceProvider === "google_cloud_tts" && (
                <Alert severity="info">
                  Google Cloud uses Arabic - Modern Standard Arabic (ar-XA). Billing may be required, and usage above Google's free monthly allowance may incur charges.
                </Alert>
              )}
              {selectedProviderUnavailable && (
                <Alert
                  severity="warning"
                  action={<Button size="small" onClick={() => navigate("/providers")}>Configure in Providers</Button>}
                >
                  This provider is not configured. Voice preview and full production will stay disabled until credentials are added.
                </Alert>
              )}
              {voicePreview ? (
                <>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label={`Provider: ${voicePreview.provider}`} />
                    <Chip label={`Voice: ${voicePreview.voiceId}`} />
                    <Chip label={`Duration: ${voicePreview.durationSeconds}s`} />
                    {voicePreview.generationMs && <Chip label={`Generated: ${voicePreview.generationMs}ms`} />}
                  </Stack>
                  <Box component="audio" controls src={withMediaAccessToken(voicePreview.audioUrl)} sx={{ width: "100%" }} />
                  <Typography variant="body2" color="text.secondary" dir={voicePreview.language === "ar" ? "rtl" : "ltr"}>
                    {voicePreview.processedText}
                  </Typography>
                  {voicePreview.warnings?.length > 0 && (
                    <Alert severity="warning">{voicePreview.warnings.join(" ")}</Alert>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  The preview uses the current language, dialect, provider, voice, and quality settings.
                </Typography>
              )}
            </Stack>
          </SectionCard>

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
                      costLabel(costEstimate)
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
                Preview the production plan before generating, or create the video directly with the choices above.
              </Typography>
            )}
          </SectionCard>

          {/* Submit Action */}
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<SendIcon />}
              disabled={submitting || !prompt.trim() || arabicBlocked || Boolean(modeReadiness && !modeReadiness.ready)}
              onClick={submitPromptJob}
            >
              {submitting ? "Creating..." : "Create Video"}
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
