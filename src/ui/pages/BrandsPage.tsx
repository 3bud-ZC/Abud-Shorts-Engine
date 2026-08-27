import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MovieCreationIcon from "@mui/icons-material/MovieCreation";
import RestoreIcon from "@mui/icons-material/Restore";
import SaveIcon from "@mui/icons-material/Save";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog, EmptyState, LoadingState, PageHeader, SearchInput, SectionCard, StatusBadge } from "../components/v2";
import { useI18n } from "../i18n";
import type { V2Brand } from "./v2Types";
import { CAPTION_STYLE_LABELS } from "./videoTypes";
import { withMediaAccessToken } from "../utils/auth";

type LogoAsset = {
  id: string;
  displayName?: string;
  originalName?: string;
  filename: string;
  previewUrl?: string;
  usability?: { usableForLogo?: boolean };
};

const copy = {
  en: {
    title: "Brands",
    description: "Professional Brand Kits for colors, logo, typography, captions, voice defaults and reusable video settings.",
    newBrand: "Create Brand",
    editBrand: "Edit Brand",
    search: "Search brands",
    empty: "Create a Brand Kit to reuse your colors, logo, typography and video defaults.",
    saved: "Brand Kit saved.",
    created: "Brand Kit created.",
    duplicated: "Brand Kit duplicated.",
    archived: "Brand Kit archived.",
    restored: "Brand Kit restored.",
    defaultSet: "Default Brand updated.",
    identity: "Identity",
    visuals: "Visual Identity",
    typography: "Typography",
    content: "Content Defaults",
    video: "Video Defaults",
    preview: "Brand Kit Preview",
    logoAsset: "Logo from Media Library",
    noLogo: "No logo",
    defaultBadge: "Default",
    archivedBadge: "Archived",
    use: "Use in Video",
    duplicate: "Duplicate",
    archive: "Archive",
    restore: "Restore",
    setDefault: "Set Default",
    confirmArchive: "Archive Brand Kit?",
    confirmBody: "Existing productions keep their saved Brand snapshot. New videos will not use this Brand while it is archived.",
  },
  ar: {
    title: "العلامات التجارية",
    description: "حِزم علامة تجارية احترافية للألوان والشعار والخطوط والتعليقات والصوت وإعدادات الفيديو المتكررة.",
    newBrand: "إنشاء علامة",
    editBrand: "تعديل العلامة",
    search: "بحث في العلامات",
    empty: "أنشئ حزمة علامة تجارية لإعادة استخدام الألوان والشعار والخطوط وإعدادات الفيديو.",
    saved: "تم حفظ حزمة العلامة.",
    created: "تم إنشاء حزمة العلامة.",
    duplicated: "تم نسخ حزمة العلامة.",
    archived: "تم أرشفة حزمة العلامة.",
    restored: "تم استرجاع حزمة العلامة.",
    defaultSet: "تم تحديث العلامة الافتراضية.",
    identity: "الهوية",
    visuals: "الهوية البصرية",
    typography: "الخطوط",
    content: "إعدادات المحتوى",
    video: "إعدادات الفيديو",
    preview: "معاينة حزمة العلامة",
    logoAsset: "الشعار من مكتبة الوسائط",
    noLogo: "بدون شعار",
    defaultBadge: "افتراضية",
    archivedBadge: "مؤرشفة",
    use: "استخدام في فيديو",
    duplicate: "نسخ",
    archive: "أرشفة",
    restore: "استرجاع",
    setDefault: "تعيين كافتراضية",
    confirmArchive: "أرشفة حزمة العلامة؟",
    confirmBody: "الإنتاجات السابقة تحتفظ بلقطة العلامة المحفوظة. الفيديوهات الجديدة لن تستخدم هذه العلامة وهي مؤرشفة.",
  },
};

const blankBrand: Partial<V2Brand> = {
  name: "",
  description: "",
  industry: "",
  tagline: "",
  watermarkText: "",
  primaryColor: "#24545a",
  secondaryColor: "",
  accentColor: "#d28b4c",
  backgroundColor: "#ffffff",
  textColor: "#0f172a",
  logoAssetId: "",
  headingFont: "ibm_plex_sans_arabic",
  bodyFont: "ibm_plex_sans_arabic",
  captionFont: "ibm_plex_sans_arabic",
  captionStyle: "social_ad",
  includeOutro: true,
  outroText: "",
  contactText: "",
  defaultCtaText: "",
  defaultLanguage: "auto",
  defaultDurationSeconds: 15,
  defaultAspectRatio: "9:16",
  defaultQuality: "standard",
  defaultVisualSource: "auto_best",
  watermark: { enabled: false, position: "bottom_right", size: "small", opacity: 0.82, respectSafeZone: true },
  intro: { type: "none", durationSeconds: 0 },
  outro: { type: "cta_card", durationSeconds: 2 },
  voiceProfile: { provider: "auto" },
  keywords: [],
  avoidPhrases: [],
  isDefault: false,
};

const fonts = [
  { id: "ibm_plex_sans_arabic", label: "IBM Plex Sans Arabic" },
  { id: "noto_sans_arabic", label: "Noto Sans Arabic" },
  { id: "noto_kufi_arabic", label: "Noto Kufi Arabic" },
  { id: "cairo", label: "Cairo" },
  { id: "system_sans", label: "System Sans" },
];

const captions = [
  { id: "clean_professional", label: CAPTION_STYLE_LABELS.clean_professional },
  { id: "karaoke", label: CAPTION_STYLE_LABELS.karaoke },
  { id: "social_ad", label: CAPTION_STYLE_LABELS.social_ad },
  { id: "minimal", label: CAPTION_STYLE_LABELS.minimal },
  { id: "cinematic", label: CAPTION_STYLE_LABELS.cinematic },
  { id: "none", label: "Off" },
];

function csv(value?: string[]) {
  return (value || []).join(", ");
}

function parseCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function assetName(asset?: LogoAsset) {
  return asset?.displayName || asset?.originalName || asset?.filename || "";
}

const BrandsPage: React.FC = () => {
  const navigate = useNavigate();
  const { locale, direction } = useI18n();
  const strings = copy[locale];
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [logoAssets, setLogoAssets] = useState<LogoAsset[]>([]);
  const [draft, setDraft] = useState<Partial<V2Brand>>(blankBrand);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<V2Brand | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const [brandResponse, assetResponse] = await Promise.all([
        axios.get("/api/v2/brands", { params: { includeArchived } }),
        axios.get("/api/v2/media/assets", { params: { type: "image", purpose: "brand_logo" } }),
      ]);
      setBrands(brandResponse.data.brands || []);
      setLogoAssets((assetResponse.data.assets || []).filter((asset: LogoAsset) => asset.usability?.usableForLogo));
      setError(null);
    } catch {
      setError(locale === "ar" ? "تعذر تحميل العلامات." : "Failed to load brands.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [includeArchived]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return brands.filter((brand) => `${brand.name} ${brand.description} ${brand.industry} ${brand.tagline}`.toLowerCase().includes(q));
  }, [brands, query]);

  const selectedLogo = logoAssets.find((asset) => asset.id === draft.logoAssetId);

  const edit = (brand: V2Brand) => {
    setEditingId(brand.id);
    setDraft({ ...blankBrand, ...brand });
  };

  const reset = () => {
    setEditingId(null);
    setDraft(blankBrand);
  };

  const save = async () => {
    try {
      if (editingId) {
        await axios.put(`/api/v2/brands/${editingId}`, draft);
        setMessage(strings.saved);
      } else {
        await axios.post("/api/v2/brands", draft);
        setMessage(strings.created);
      }
      reset();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || (locale === "ar" ? "تعذر حفظ العلامة." : "Brand could not be saved."));
    }
  };

  const duplicate = async (brand: V2Brand) => {
    await axios.post(`/api/v2/brands/${brand.id}/duplicate`);
    setMessage(strings.duplicated);
    await load();
  };

  const archive = async () => {
    if (!archiveTarget) return;
    await axios.delete(`/api/v2/brands/${archiveTarget.id}`);
    setArchiveTarget(null);
    setMessage(strings.archived);
    await load();
  };

  const restore = async (brand: V2Brand) => {
    await axios.post(`/api/v2/brands/${brand.id}/restore`);
    setMessage(strings.restored);
    await load();
  };

  const setDefault = async (brand: V2Brand) => {
    await axios.post(`/api/v2/brands/${brand.id}/default`);
    setMessage(strings.defaultSet);
    await load();
  };

  if (loading) return <LoadingState label={locale === "ar" ? "جارٍ تحميل العلامات..." : "Loading brands..."} />;

  return (
    <>
      <PageHeader title={strings.title} description={strings.description} actions={<Button startIcon={<AddIcon />} onClick={reset}>{strings.newBrand}</Button>} />
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={2} dir={direction}>
        <Grid item xs={12} lg={5}>
          <SectionCard title={editingId ? strings.editBrand : strings.newBrand}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" fontWeight={800}>{strings.identity}</Typography>
              <TextField required label={locale === "ar" ? "اسم العلامة" : "Brand name"} value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField label={locale === "ar" ? "وصف قصير" : "Short description"} value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <Grid container spacing={2}>
                <Grid item xs={6}><TextField fullWidth label={locale === "ar" ? "المجال" : "Industry"} value={draft.industry || ""} onChange={(e) => setDraft({ ...draft, industry: e.target.value })} /></Grid>
                <Grid item xs={6}><TextField fullWidth label={locale === "ar" ? "الشعار النصي" : "Tagline"} value={draft.tagline || ""} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} /></Grid>
              </Grid>

              <Divider />
              <Typography variant="subtitle2" fontWeight={800}>{strings.visuals}</Typography>
              <FormControl fullWidth>
                <InputLabel>{strings.logoAsset}</InputLabel>
                <Select label={strings.logoAsset} value={draft.logoAssetId || ""} onChange={(e) => setDraft({ ...draft, logoAssetId: e.target.value })}>
                  <MenuItem value="">{strings.noLogo}</MenuItem>
                  {logoAssets.map((asset) => <MenuItem key={asset.id} value={asset.id}>{assetName(asset)}</MenuItem>)}
                </Select>
              </FormControl>
              <Grid container spacing={2}>
                <Grid item xs={6}><TextField fullWidth type="color" label={locale === "ar" ? "الأساسي" : "Primary"} value={draft.primaryColor || "#24545a"} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} /></Grid>
                <Grid item xs={6}><TextField fullWidth type="color" label={locale === "ar" ? "الثانوي" : "Secondary"} value={draft.secondaryColor || "#1b3b47"} onChange={(e) => setDraft({ ...draft, secondaryColor: e.target.value })} /></Grid>
                <Grid item xs={6}><TextField fullWidth type="color" label={locale === "ar" ? "تمييز" : "Accent"} value={draft.accentColor || "#d28b4c"} onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })} /></Grid>
                <Grid item xs={6}><TextField fullWidth type="color" label={locale === "ar" ? "النص" : "Text"} value={draft.textColor || "#0f172a"} onChange={(e) => setDraft({ ...draft, textColor: e.target.value })} /></Grid>
              </Grid>

              <Divider />
              <Typography variant="subtitle2" fontWeight={800}>{strings.typography}</Typography>
              <Grid container spacing={2}>
                {(["headingFont", "bodyFont", "captionFont"] as const).map((field) => (
                  <Grid item xs={12} md={4} key={field}>
                    <FormControl fullWidth>
                      <InputLabel>{field === "headingFont" ? (locale === "ar" ? "العناوين" : "Heading") : field === "bodyFont" ? (locale === "ar" ? "النص" : "Body") : (locale === "ar" ? "التعليقات" : "Captions")}</InputLabel>
                      <Select label={field} value={draft[field] || "ibm_plex_sans_arabic"} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}>
                        {fonts.map((font) => <MenuItem key={font.id} value={font.id}>{font.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                ))}
              </Grid>

              <Divider />
              <Typography variant="subtitle2" fontWeight={800}>{strings.content}</Typography>
              <TextField label={locale === "ar" ? "نبرة العلامة" : "Tone of voice"} value={draft.toneOfVoice || ""} onChange={(e) => setDraft({ ...draft, toneOfVoice: e.target.value })} />
              <TextField label={locale === "ar" ? "كلمات مفضلة" : "Keywords"} value={csv(draft.keywords)} onChange={(e) => setDraft({ ...draft, keywords: parseCsv(e.target.value) })} helperText={locale === "ar" ? "افصل بينها بفواصل" : "Separate with commas"} />
              <TextField label={locale === "ar" ? "تجنب عبارات" : "Avoid phrases"} value={csv(draft.avoidPhrases)} onChange={(e) => setDraft({ ...draft, avoidPhrases: parseCsv(e.target.value) })} />
              <TextField label={locale === "ar" ? "دعوة افتراضية" : "Default CTA"} value={draft.defaultCtaText || ""} onChange={(e) => setDraft({ ...draft, defaultCtaText: e.target.value, outroText: e.target.value })} />
              <TextField label={locale === "ar" ? "الموقع" : "Website"} value={draft.websiteUrl || ""} onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })} />
              <TextField label={locale === "ar" ? "الحساب الاجتماعي" : "Social handle"} value={draft.socialHandle || ""} onChange={(e) => setDraft({ ...draft, socialHandle: e.target.value })} />

              <Divider />
              <Typography variant="subtitle2" fontWeight={800}>{strings.video}</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>{locale === "ar" ? "التعليقات" : "Captions"}</InputLabel>
                    <Select label="Captions" value={draft.captionStyle || "social_ad"} onChange={(e) => setDraft({ ...draft, captionStyle: e.target.value })}>
                      {captions.map((style) => <MenuItem key={style.id} value={style.id}>{style.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>{locale === "ar" ? "الصوت" : "Voice"}</InputLabel>
                    <Select label="Voice" value={draft.voiceProfile?.provider || "auto"} onChange={(e) => setDraft({ ...draft, voiceProfile: { ...(draft.voiceProfile || {}), provider: e.target.value as any } })}>
                      <MenuItem value="auto">Auto</MenuItem>
                      <MenuItem value="kokoro">Kokoro English</MenuItem>
                      <MenuItem value="elevenlabs">ElevenLabs Arabic</MenuItem>
                      <MenuItem value="google_cloud_tts">Google Cloud TTS</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}><TextField fullWidth type="number" label={locale === "ar" ? "المدة الافتراضية" : "Default duration"} value={draft.defaultDurationSeconds || 15} onChange={(e) => setDraft({ ...draft, defaultDurationSeconds: Number(e.target.value) })} /></Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth>
                    <InputLabel>{locale === "ar" ? "مصدر الصورة" : "Visual source"}</InputLabel>
                    <Select label="Visual source" value={draft.defaultVisualSource || "auto_best"} onChange={(e) => setDraft({ ...draft, defaultVisualSource: e.target.value })}>
                      <MenuItem value="auto_best">Auto Best</MenuItem>
                      <MenuItem value="stock">Stock Only</MenuItem>
                      <MenuItem value="uploaded_media">Uploaded Media</MenuItem>
                      <MenuItem value="ai_generated">AI Generated</MenuItem>
                      <MenuItem value="mixed">Mixed</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
              <FormControlLabel control={<Checkbox checked={draft.watermark?.enabled === true} onChange={(e) => setDraft({ ...draft, watermark: { ...(draft.watermark || {}), enabled: e.target.checked, assetId: draft.logoAssetId || draft.watermark?.assetId } })} />} label={locale === "ar" ? "تفعيل العلامة المائية" : "Enable watermark"} />
              <FormControlLabel control={<Checkbox checked={draft.includeOutro !== false} onChange={(e) => setDraft({ ...draft, includeOutro: e.target.checked, outro: { ...(draft.outro || {}), type: e.target.checked ? "cta_card" : "none" } })} />} label={locale === "ar" ? "خاتمة مختصرة" : "Short outro"} />
              <FormControlLabel control={<Checkbox checked={draft.isDefault === true} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />} label={locale === "ar" ? "العلامة الافتراضية" : "Default Brand"} />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" startIcon={<SaveIcon />} disabled={!draft.name?.trim()} onClick={save}>{locale === "ar" ? "حفظ" : "Save"}</Button>
                {editingId && <Button onClick={reset}>{locale === "ar" ? "إلغاء" : "Cancel"}</Button>}
              </Stack>
            </Stack>
          </SectionCard>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Stack spacing={2}>
            <SectionCard>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
                <SearchInput value={query} onChange={setQuery} placeholder={strings.search} />
                <FormControlLabel control={<Checkbox checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />} label={locale === "ar" ? "عرض المؤرشف" : "Show archived"} />
              </Stack>
            </SectionCard>

            <SectionCard title={strings.preview}>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ width: 64, height: 64, borderRadius: 1, border: "1px solid", borderColor: "divider", display: "grid", placeItems: "center", overflow: "hidden", bgcolor: draft.backgroundColor || "#fff" }}>
                    {selectedLogo?.previewUrl ? <Box component="img" src={withMediaAccessToken(selectedLogo.previewUrl)} alt="" sx={{ maxWidth: "100%", maxHeight: "100%" }} /> : <Typography fontWeight={900}>{(draft.name || "B").slice(0, 1)}</Typography>}
                  </Box>
                  <Box>
                    <Typography variant="h6" sx={{ color: draft.textColor || "#0f172a", fontFamily: "IBM Plex Sans Arabic" }}>{draft.name || strings.newBrand}</Typography>
                    <Typography variant="body2" color="text.secondary">{draft.tagline || draft.description || strings.description}</Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {[draft.primaryColor, draft.secondaryColor, draft.accentColor, draft.backgroundColor, draft.textColor].filter(Boolean).map((color) => (
                    <Box key={color} title={color} sx={{ width: 34, height: 24, borderRadius: 1, bgcolor: color, border: "1px solid", borderColor: "divider" }} />
                  ))}
                </Stack>
                <Chip label={`${captions.find((style) => style.id === draft.captionStyle)?.label || "Captions"} · ${draft.defaultCtaText || draft.outroText || "CTA"}`} />
                <Typography variant="body2" color="text.secondary">
                  {(draft.watermark?.enabled ? "Watermark on" : "Watermark off")} · {(draft.intro?.type || "none").replaceAll("_", " ")} / {(draft.outro?.type || "none").replaceAll("_", " ")}
                </Typography>
              </Stack>
            </SectionCard>

            {filtered.map((brand) => (
              <SectionCard key={brand.id}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                  <Stack spacing={0.75}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="h6">{brand.name}</Typography>
                      {brand.isDefault && <StatusBadge status="ready" label={strings.defaultBadge} />}
                      {brand.archived && <StatusBadge status="default" label={strings.archivedBadge} />}
                      <StatusBadge status="default" label={`r${brand.revision || 1}`} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {brand.industry || brand.description || brand.tagline || "Brand Kit"} · {captions.find((style) => style.id === brand.captionStyle)?.label || brand.captionStyle} · {brand.voiceProfile?.provider || "auto"}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {[brand.primaryColor, brand.secondaryColor, brand.accentColor].filter(Boolean).map((color) => <Box key={color} sx={{ width: 28, height: 18, bgcolor: color, border: "1px solid", borderColor: "divider", borderRadius: 0.75 }} />)}
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Button startIcon={<MovieCreationIcon />} onClick={() => navigate(`/create?brand=${brand.id}`)}>{strings.use}</Button>
                    <Button onClick={() => edit(brand)}>{locale === "ar" ? "تعديل" : "Edit"}</Button>
                    <Button startIcon={<ContentCopyIcon />} onClick={() => duplicate(brand)}>{strings.duplicate}</Button>
                    <Button disabled={brand.isDefault || brand.archived} onClick={() => setDefault(brand)}>{strings.setDefault}</Button>
                    {brand.archived
                      ? <Button startIcon={<RestoreIcon />} onClick={() => restore(brand)}>{strings.restore}</Button>
                      : <Button color="warning" startIcon={<ArchiveIcon />} onClick={() => setArchiveTarget(brand)}>{strings.archive}</Button>}
                  </Stack>
                </Stack>
              </SectionCard>
            ))}
            {filtered.length === 0 && <EmptyState title={strings.empty} />}
          </Stack>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={strings.confirmArchive}
        description={strings.confirmBody}
        confirmLabel={strings.archive}
        onClose={() => setArchiveTarget(null)}
        onConfirm={archive}
      />
    </>
  );
};

export default BrandsPage;
