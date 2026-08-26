import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import UploadIcon from "@mui/icons-material/CloudUploadOutlined";
import BrokenImageIcon from "@mui/icons-material/BrokenImageOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/EditOutlined";
import PersonIcon from "@mui/icons-material/PersonOutline";
import ArchiveIcon from "@mui/icons-material/ArchiveOutlined";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBoundary,
  LoadingState,
  PageHeader,
  SectionCard,
} from "../components/v2";
import { withMediaAccessToken } from "../utils/auth";
import { useI18n } from "../i18n";

type Asset = {
  id: string;
  filename: string;
  originalName: string;
  displayName: string;
  mediaType: "image" | "video" | "audio";
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  codec?: string;
  previewUrl: string;
  folderId?: string;
  tags: string[];
  status: "ready" | "unusable" | "archived";
  usable: boolean;
  usableReason?: string;
  duplicateOf?: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  usability: {
    usableForVideo: boolean;
    usableForProduct: boolean;
    usableForLogo: boolean;
    usableForCharacterReference: boolean;
    reasons: Record<string, string>;
  };
};

type Folder = { id: string; name: string };
type CharacterProfile = {
  id: string;
  name: string;
  referenceAssetIds: string[];
  primaryReferenceAssetId?: string;
  description?: string;
  visualTraits?: string;
  promptAnchor: string;
  negativeNotes?: string;
  status: string;
  revision: number;
  readinessLabel?: string;
};

const copy = {
  en: {
    title: "Media",
    eyebrow: "Asset Library",
    description: "Upload images, clips, logos, audio, and references to reuse across productions.",
    upload: "Upload assets",
    uploading: "Uploading...",
    assets: "Assets",
    characters: "Characters",
    all: "All",
    images: "Images",
    videos: "Videos",
    logos: "Logos",
    audio: "Audio",
    references: "References",
    search: "Search assets",
    sort: "Sort",
    newest: "Newest",
    name: "Name",
    folder: "Folder",
    tags: "Tags",
    purpose: "Purpose",
    status: "Status",
    usable: "Usable",
    invalid: "Invalid media",
    duplicate: "Duplicate",
    preview: "Preview",
    details: "Details",
    use: "Use in Video",
    edit: "Edit",
    archive: "Archive",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    createFolder: "Create folder",
    folderName: "Folder name",
    newFolder: "New folder",
    noAssets: "No assets yet",
    noAssetsBody: "Upload images, clips, logos, audio, or references to reuse them in your videos.",
    drop: "Drop files here to upload them.",
    characterEmpty: "No characters yet",
    characterEmptyBody: "Create a reusable Character Profile from reference images.",
    createCharacter: "Create Character",
    characterName: "Character name",
    promptAnchor: "Identity description",
    negativeNotes: "Avoid notes",
    referenceImages: "Reference images",
    primaryReference: "Primary reference",
    providerUnavailable: "Saved - compatible AI provider not configured",
    noFake: "Character consistency is only available when a configured provider supports references.",
    metadata: "Metadata",
    suitability: "Production suitability",
    move: "Move",
    duplicateAction: "Duplicate",
    archiveCharacter: "Archive",
    editCharacter: "Edit Character",
    useCharacter: "Use in Video",
    refs: "refs",
    revision: "rev",
    folderNone: "No folder",
    uploadComplete: "uploaded",
    loadError: "Media library could not be loaded.",
    uploadFailed: "Upload failed.",
    assetUpdateFailed: "Asset update failed.",
    folderCreationFailed: "Folder creation failed.",
    characterCreationFailed: "Character save failed.",
    assetDeleteFailed: "Asset could not be deleted.",
    assetArchiveFailed: "Asset could not be archived.",
    deleteDescription: "This deletes the stored file and writes a deletion audit record. Produced videos are not changed.",
    general: "General",
    product: "Product",
    brandLogo: "Logo",
    characterReference: "Character reference",
    backgroundMedia: "Background media",
    music: "Music",
    reference: "Reference",
    image: "Image",
    video: "Video",
    audioType: "Audio",
    videoSuitability: "Video",
    productSuitability: "Product",
    logoSuitability: "Logo",
    characterSuitability: "Character",
    primaryHint: "The primary reference is the first image a provider should follow.",
  },
  ar: {
    title: "الوسائط",
    eyebrow: "مكتبة الأصول",
    description: "ارفع الصور والمقاطع والشعارات والصوت والمراجع لإعادة استخدامها في الإنتاج.",
    upload: "رفع أصول",
    uploading: "جارٍ الرفع...",
    assets: "الأصول",
    characters: "الشخصيات",
    all: "الكل",
    images: "الصور",
    videos: "الفيديو",
    logos: "الشعارات",
    audio: "الصوت",
    references: "المراجع",
    search: "بحث في الأصول",
    sort: "ترتيب",
    newest: "الأحدث",
    name: "الاسم",
    folder: "المجلد",
    tags: "الوسوم",
    purpose: "الغرض",
    status: "الحالة",
    usable: "قابل للاستخدام",
    invalid: "وسيط غير صالح",
    duplicate: "نسخة مكررة",
    preview: "معاينة",
    details: "التفاصيل",
    use: "استخدام في فيديو",
    edit: "تعديل",
    archive: "أرشفة",
    delete: "حذف",
    save: "حفظ",
    cancel: "إلغاء",
    createFolder: "إنشاء مجلد",
    folderName: "اسم المجلد",
    newFolder: "مجلد جديد",
    noAssets: "لا توجد أصول بعد",
    noAssetsBody: "ارفع صورًا أو مقاطع أو شعارات أو صوتًا أو مراجع لاستخدامها في مقاطعك.",
    drop: "أفلت الملفات هنا لرفعها.",
    characterEmpty: "لا توجد شخصيات بعد",
    characterEmptyBody: "أنشئ ملف شخصية قابلًا لإعادة الاستخدام من صور مرجعية.",
    createCharacter: "إنشاء شخصية",
    characterName: "اسم الشخصية",
    promptAnchor: "وصف الهوية",
    negativeNotes: "ملاحظات التجنب",
    referenceImages: "الصور المرجعية",
    primaryReference: "المرجع الأساسي",
    providerUnavailable: "محفوظة - لا يوجد مزوّد ذكاء اصطناعي متوافق",
    noFake: "اتساق الشخصية متاح فقط عند إعداد مزوّد يدعم المراجع.",
    metadata: "البيانات",
    suitability: "ملاءمة الإنتاج",
    move: "نقل",
    duplicateAction: "نسخ",
    archiveCharacter: "أرشفة",
    editCharacter: "تعديل الشخصية",
    useCharacter: "استخدام في فيديو",
    refs: "مراجع",
    revision: "إصدار",
    folderNone: "بدون مجلد",
    uploadComplete: "تم رفعها",
    loadError: "تعذر تحميل مكتبة الوسائط.",
    uploadFailed: "فشل الرفع.",
    assetUpdateFailed: "فشل تحديث الأصل.",
    folderCreationFailed: "فشل إنشاء المجلد.",
    characterCreationFailed: "فشل حفظ الشخصية.",
    assetDeleteFailed: "تعذر حذف الأصل.",
    assetArchiveFailed: "تعذر أرشفة الأصل.",
    deleteDescription: "سيتم حذف الملف المخزن وتسجيل ذلك في سجل الحذف. الفيديوهات المنتجة لا تتغير.",
    general: "عام",
    product: "منتج",
    brandLogo: "شعار",
    characterReference: "مرجع شخصية",
    backgroundMedia: "وسائط خلفية",
    music: "موسيقى",
    reference: "مرجع",
    image: "صورة",
    video: "فيديو",
    audioType: "صوت",
    videoSuitability: "الفيديو",
    productSuitability: "المنتج",
    logoSuitability: "الشعار",
    characterSuitability: "الشخصية",
    primaryHint: "المرجع الأساسي هو أول صورة يجب أن يتبعها المزوّد.",
  },
};

const purposeOptions = [
  "general",
  "product",
  "brand_logo",
  "character_reference",
  "background_media",
  "music",
  "reference",
];

function labelForPurpose(strings: typeof copy.en, purpose: string) {
  const labels: Record<string, string> = {
    general: strings.general,
    product: strings.product,
    brand_logo: strings.brandLogo,
    character_reference: strings.characterReference,
    background_media: strings.backgroundMedia,
    music: strings.music,
    reference: strings.reference,
  };
  return labels[purpose] || strings.general;
}

function labelForMediaType(strings: typeof copy.en, mediaType: string) {
  if (mediaType === "image") return strings.image;
  if (mediaType === "video") return strings.video;
  if (mediaType === "audio") return strings.audioType;
  return mediaType;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mediaUrl(asset: Asset) {
  return withMediaAccessToken(asset.previewUrl || `/api/v2/media/uploads/${asset.filename}`);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.readAsDataURL(file);
  });
}

const MediaContent: React.FC = () => {
  const { locale } = useI18n();
  const strings = copy[locale === "ar" ? "ar" : "en"];
  const theme = useTheme();
  const t = theme.abud;
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<"assets" | "characters">("assets");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [uploadPurpose, setUploadPurpose] = useState("general");
  const [uploadTags, setUploadTags] = useState("");
  const [detail, setDetail] = useState<Asset | null>(null);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editPurpose, setEditPurpose] = useState("general");
  const [editFolderId, setEditFolderId] = useState("");
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);
  const [folderName, setFolderName] = useState("");
  const [characterDialog, setCharacterDialog] = useState(false);
  const [characterName, setCharacterName] = useState("");
  const [characterAnchor, setCharacterAnchor] = useState("");
  const [characterNegative, setCharacterNegative] = useState("");
  const [characterRefs, setCharacterRefs] = useState<string[]>([]);
  const [characterPrimaryRef, setCharacterPrimaryRef] = useState("");
  const [editingCharacter, setEditingCharacter] = useState<CharacterProfile | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      axios.get("/api/v2/media/assets"),
      axios.get("/api/v2/media/folders"),
      axios.get("/api/v2/media/characters"),
    ])
      .then(([assetRes, folderRes, characterRes]) => {
        setAssets(assetRes.data.assets || []);
        setFolders(folderRes.data.folders || []);
        setCharacters(characterRes.data.characters || []);
      })
      .catch(() => setError(strings.loadError))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredAssets = useMemo(() => {
    return assets
      .filter((asset) => filter === "all" || asset.mediaType === filter || asset.purpose === filter)
      .filter((asset) => !folderFilter || asset.folderId === folderFilter)
      .filter((asset) => !tagFilter || asset.tags.includes(tagFilter.toLowerCase()))
      .filter((asset) => {
        const needle = query.trim().toLowerCase();
        return !needle || [asset.displayName, asset.originalName, asset.purpose, asset.mimeType, ...asset.tags].join(" ").toLowerCase().includes(needle);
      });
  }, [assets, filter, folderFilter, query, tagFilter]);

  const characterReferenceAssets = assets.filter((asset) => asset.usability?.usableForCharacterReference);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const fileBase64 = await fileToDataUrl(file);
        await axios.post("/api/v2/media/assets", {
          fileBase64,
          filename: file.name,
          purpose: uploadPurpose,
          tags: uploadTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        });
      }
      setFeedback(`${list.length} ${strings.uploadComplete}.`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  async function saveAssetEdits() {
    if (!editAsset) return;
    try {
      await axios.patch(`/api/v2/media/assets/${editAsset.id}`, {
        displayName: editName,
        purpose: editPurpose,
        folderId: editFolderId || null,
        tags: editTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setEditAsset(null);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.assetUpdateFailed);
    }
  }

  async function archiveAsset(asset: Asset) {
    try {
      await axios.patch(`/api/v2/media/assets/${asset.id}`, { archived: true });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.assetArchiveFailed);
    }
  }

  async function createFolder() {
    if (!folderName.trim()) return;
    try {
      await axios.post("/api/v2/media/folders", { name: folderName.trim() });
      setFolderName("");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.folderCreationFailed);
    }
  }

  function openCharacterDialog(profile?: CharacterProfile) {
    setEditingCharacter(profile || null);
    setCharacterName(profile?.name || "");
    setCharacterAnchor(profile?.promptAnchor || "");
    setCharacterNegative(profile?.negativeNotes || "");
    setCharacterRefs(profile?.referenceAssetIds || []);
    setCharacterPrimaryRef(profile?.primaryReferenceAssetId || profile?.referenceAssetIds?.[0] || "");
    setCharacterDialog(true);
  }

  async function saveCharacter() {
    try {
      const payload = {
        name: characterName,
        referenceAssetIds: characterRefs,
        primaryReferenceAssetId: characterPrimaryRef || characterRefs[0],
        promptAnchor: characterAnchor,
        negativeNotes: characterNegative,
      };
      if (editingCharacter) await axios.put(`/api/v2/media/characters/${editingCharacter.id}`, payload);
      else await axios.post("/api/v2/media/characters", payload);
      setCharacterDialog(false);
      setEditingCharacter(null);
      setCharacterName("");
      setCharacterAnchor("");
      setCharacterNegative("");
      setCharacterRefs([]);
      setCharacterPrimaryRef("");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.characterCreationFailed);
    }
  }

  async function duplicateCharacter(profile: CharacterProfile) {
    try {
      await axios.post("/api/v2/media/characters", {
        name: `${profile.name} copy`,
        referenceAssetIds: profile.referenceAssetIds,
        primaryReferenceAssetId: profile.primaryReferenceAssetId,
        promptAnchor: profile.promptAnchor,
        negativeNotes: profile.negativeNotes,
      });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.characterCreationFailed);
    }
  }

  async function archiveCharacter(profile: CharacterProfile) {
    try {
      await axios.delete(`/api/v2/media/characters/${profile.id}`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.characterCreationFailed);
    }
  }

  async function removeAsset() {
    if (!deleteAsset) return;
    try {
      await axios.delete(`/api/v2/media/assets/${deleteAsset.id}`);
      setDeleteAsset(null);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || strings.assetDeleteFailed);
    }
  }

  if (loading) return <LoadingState label={locale === "ar" ? "جارٍ تحميل الوسائط..." : "Loading media..."} />;

  return (
    <>
      <PageHeader
        title={strings.title}
        eyebrow={strings.eyebrow}
        description={strings.description}
        actions={
          <Button variant="contained" startIcon={<UploadIcon />} disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? strings.uploading : strings.upload}
          </Button>
        }
      />

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
        hidden
        onChange={(event) => {
          if (event.target.files) void uploadFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {feedback && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setFeedback(null)}>{feedback}</Alert>}

      <Tabs value={tab} onChange={(_, next) => setTab(next)} sx={{ mb: 2 }}>
        <Tab value="assets" label={strings.assets} />
        <Tab value="characters" label={strings.characters} />
      </Tabs>

      {tab === "assets" && (
        <Stack spacing={2}>
          <SectionCard>
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={12} md={3}>
                <TextField fullWidth size="small" label={strings.search} value={query} onChange={(event) => setQuery(event.target.value)} />
              </Grid>
              <Grid item xs={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.purpose}</InputLabel>
                  <Select label={strings.purpose} value={filter} onChange={(event) => setFilter(event.target.value)}>
                    <MenuItem value="all">{strings.all}</MenuItem>
                    <MenuItem value="image">{strings.images}</MenuItem>
                    <MenuItem value="video">{strings.videos}</MenuItem>
                    <MenuItem value="audio">{strings.audio}</MenuItem>
                    <MenuItem value="brand_logo">{strings.logos}</MenuItem>
                    <MenuItem value="character_reference">{strings.references}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>{strings.folder}</InputLabel>
                  <Select label={strings.folder} value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
                    <MenuItem value="">{strings.all}</MenuItem>
                    {folders.map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6} md={2}>
                <TextField fullWidth size="small" label={strings.tags} value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} />
              </Grid>
              <Grid item xs={6} md={3}>
                <Stack direction="row" spacing={1}>
                  <TextField fullWidth size="small" label={strings.folderName} value={folderName} onChange={(event) => setFolderName(event.target.value)} />
                  <Button variant="outlined" onClick={createFolder}>{strings.newFolder}</Button>
                </Stack>
              </Grid>
              <Grid item xs={12}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>{strings.purpose}</InputLabel>
                    <Select label={strings.purpose} value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value)}>
                      {purposeOptions.map((purpose) => <MenuItem key={purpose} value={purpose}>{labelForPurpose(strings, purpose)}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField size="small" label={strings.tags} value={uploadTags} onChange={(event) => setUploadTags(event.target.value)} />
                </Stack>
              </Grid>
            </Grid>
          </SectionCard>

          <Box
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void uploadFiles(event.dataTransfer.files);
            }}
            sx={{ border: `1px dashed ${t.border}`, borderRadius: 2, p: 2, bgcolor: t.backgroundAlt }}
          >
            <Typography variant="body2" color="text.secondary">{strings.drop}</Typography>
          </Box>

          {filteredAssets.length === 0 ? (
            <EmptyState title={strings.noAssets} description={strings.noAssetsBody} action={<Button variant="contained" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>{strings.upload}</Button>} />
          ) : (
            <Grid container spacing={2}>
              {filteredAssets.map((asset) => {
                const invalid = asset.status === "unusable";
                return (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={asset.id}>
                    <Card sx={{ p: 1.5, height: "100%", display: "flex", flexDirection: "column" }}>
                      <Box sx={{ aspectRatio: "16 / 10", bgcolor: t.backgroundAlt, border: `1px solid ${invalid ? t.warningMuted : t.border}`, borderRadius: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {invalid ? (
                          <Stack alignItems="center" spacing={0.5}><BrokenImageIcon color="warning" /><Typography variant="caption">{strings.invalid}</Typography></Stack>
                        ) : asset.mediaType === "image" ? (
                          <Box component="img" src={mediaUrl(asset)} alt={asset.displayName} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : asset.mediaType === "video" ? (
                          <Box component="video" muted src={mediaUrl(asset)} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <Box component="audio" controls src={mediaUrl(asset)} sx={{ width: "90%" }} />
                        )}
                      </Box>
                      <Tooltip title={asset.displayName}>
                        <Typography variant="body2" fontWeight={800} noWrap sx={{ mt: 1 }}>{asset.displayName}</Typography>
                      </Tooltip>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 1 }}>
                        <Chip size="small" label={labelForMediaType(strings, asset.mediaType)} />
                        <Chip size="small" variant="outlined" label={labelForPurpose(strings, asset.purpose)} />
                        {asset.width && asset.height && <Chip size="small" variant="outlined" label={`${asset.width}x${asset.height}`} />}
                        <Chip size="small" variant="outlined" label={formatBytes(asset.sizeBytes)} />
                        {asset.duplicateOf && <Chip size="small" color="warning" icon={<ContentCopyIcon />} label={strings.duplicate} />}
                      </Stack>
                      {asset.tags.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>{asset.tags.join(", ")}</Typography>}
                      {invalid && <Typography variant="caption" color="warning.main" sx={{ mt: 0.75 }}>{asset.usableReason}</Typography>}
                      <Box sx={{ flexGrow: 1 }} />
                      <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                        <Button size="small" onClick={() => setDetail(asset)}>{strings.details}</Button>
                        <Button size="small" onClick={() => navigate("/create")}>{strings.use}</Button>
                        <Button size="small" startIcon={<EditIcon />} onClick={() => { setEditAsset(asset); setEditName(asset.displayName); setEditTags(asset.tags.join(", ")); setEditPurpose(asset.purpose); setEditFolderId(asset.folderId || ""); }}>{strings.edit}</Button>
                        <Button size="small" startIcon={<ArchiveIcon />} onClick={() => void archiveAsset(asset)}>{strings.archive}</Button>
                        <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteAsset(asset)}>{strings.delete}</Button>
                      </Stack>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Stack>
      )}

      {tab === "characters" && (
        <Stack spacing={2}>
          <Alert severity="info">{strings.noFake}</Alert>
          <Stack direction="row" justifyContent="flex-end">
            <Button variant="contained" startIcon={<PersonIcon />} disabled={characterReferenceAssets.length === 0} onClick={() => openCharacterDialog()}>
              {strings.createCharacter}
            </Button>
          </Stack>
          {characters.length === 0 ? (
            <EmptyState title={strings.characterEmpty} description={strings.characterEmptyBody} />
          ) : (
            <Grid container spacing={2}>
              {characters.map((profile) => {
                const primary = assets.find((asset) => asset.id === profile.primaryReferenceAssetId) || assets.find((asset) => profile.referenceAssetIds.includes(asset.id));
                return (
                  <Grid item xs={12} md={4} key={profile.id}>
                    <Card sx={{ p: 1.5, height: "100%" }}>
                      <Stack direction="row" spacing={1.5}>
                        <Box sx={{ width: 86, height: 86, borderRadius: 1, bgcolor: t.backgroundAlt, overflow: "hidden", flexShrink: 0 }}>
                          {primary ? <Box component="img" src={mediaUrl(primary)} alt={profile.name} sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={900} noWrap>{profile.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{profile.referenceAssetIds.length} {strings.refs} · {strings.revision} {profile.revision}</Typography>
                          <Chip size="small" sx={{ mt: 1 }} label={profile.readinessLabel || strings.providerUnavailable} />
                        </Box>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{profile.promptAnchor}</Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5} sx={{ mt: 1.5 }}>
                        <Button size="small" onClick={() => navigate(`/create?character=${profile.id}`)}>{strings.useCharacter}</Button>
                        <Button size="small" startIcon={<EditIcon />} onClick={() => openCharacterDialog(profile)}>{strings.edit}</Button>
                        <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => void duplicateCharacter(profile)}>{strings.duplicateAction}</Button>
                        <Button size="small" startIcon={<ArchiveIcon />} color="warning" onClick={() => void archiveCharacter(profile)}>{strings.archiveCharacter}</Button>
                      </Stack>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Stack>
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} fullWidth maxWidth="md">
        <DialogTitle>{detail?.displayName}</DialogTitle>
        <DialogContent>
          {detail && (
            <Stack spacing={2}>
              {detail.mediaType === "image" && <Box component="img" src={mediaUrl(detail)} alt={detail.displayName} sx={{ maxHeight: 420, objectFit: "contain", bgcolor: t.backgroundAlt }} />}
              {detail.mediaType === "video" && <Box component="video" controls src={mediaUrl(detail)} sx={{ width: "100%", maxHeight: 420 }} />}
              {detail.mediaType === "audio" && <Box component="audio" controls src={mediaUrl(detail)} sx={{ width: "100%" }} />}
              <Divider />
              <Typography variant="subtitle2">{strings.metadata}</Typography>
              <Typography variant="body2">{detail.mediaType} · {detail.mimeType} · {formatBytes(detail.sizeBytes)}</Typography>
              <Typography variant="body2">{detail.width && detail.height ? `${detail.width}x${detail.height}` : ""}</Typography>
              <Typography variant="subtitle2">{strings.suitability}</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Chip label={`Video: ${detail.usability.usableForVideo ? strings.usable : strings.invalid}`} />
                <Chip label={`Product: ${detail.usability.usableForProduct ? strings.usable : strings.invalid}`} />
                <Chip label={`Logo: ${detail.usability.usableForLogo ? strings.usable : strings.invalid}`} />
                <Chip label={`Character: ${detail.usability.usableForCharacterReference ? strings.usable : strings.invalid}`} />
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setDetail(null)}>{strings.cancel}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(editAsset)} onClose={() => setEditAsset(null)} fullWidth maxWidth="xs">
        <DialogTitle>{strings.edit}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={strings.name} value={editName} onChange={(event) => setEditName(event.target.value)} fullWidth />
            <FormControl fullWidth>
              <InputLabel>{strings.purpose}</InputLabel>
              <Select label={strings.purpose} value={editPurpose} onChange={(event) => setEditPurpose(event.target.value)}>
                {purposeOptions.map((purpose) => <MenuItem key={purpose} value={purpose}>{labelForPurpose(strings, purpose)}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>{strings.folder}</InputLabel>
              <Select label={strings.folder} value={editFolderId} onChange={(event) => setEditFolderId(event.target.value)}>
                <MenuItem value="">{strings.folderNone}</MenuItem>
                {folders.map((folder) => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label={strings.tags} value={editTags} onChange={(event) => setEditTags(event.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditAsset(null)}>{strings.cancel}</Button>
          <Button variant="contained" onClick={saveAssetEdits}>{strings.save}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={characterDialog} onClose={() => setCharacterDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingCharacter ? strings.editCharacter : strings.createCharacter}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={strings.characterName} value={characterName} onChange={(event) => setCharacterName(event.target.value)} fullWidth />
            <TextField label={strings.promptAnchor} value={characterAnchor} onChange={(event) => setCharacterAnchor(event.target.value)} fullWidth multiline minRows={2} />
            <TextField label={strings.negativeNotes} value={characterNegative} onChange={(event) => setCharacterNegative(event.target.value)} fullWidth />
            <Typography variant="subtitle2">{strings.referenceImages}</Typography>
            <Grid container spacing={1}>
              {characterReferenceAssets.map((asset) => {
                const selected = characterRefs.includes(asset.id);
                return (
                  <Grid item xs={6} sm={4} key={asset.id}>
                    <Card onClick={() => setCharacterRefs((prev) => selected ? prev.filter((id) => id !== asset.id) : [...prev, asset.id])} sx={{ p: 1, cursor: "pointer", border: "1px solid", borderColor: selected ? "primary.main" : "divider" }}>
                      <Box component="img" src={mediaUrl(asset)} alt={asset.displayName} sx={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 1 }} />
                      <Typography variant="caption" noWrap>{asset.displayName}</Typography>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
            {characterRefs.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>{strings.primaryReference}</InputLabel>
                <Select label={strings.primaryReference} value={characterPrimaryRef || characterRefs[0]} onChange={(event) => setCharacterPrimaryRef(event.target.value)}>
                  {characterRefs.map((id) => {
                    const asset = assets.find((item) => item.id === id);
                    return <MenuItem key={id} value={id}>{asset?.displayName || id}</MenuItem>;
                  })}
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>{strings.primaryHint}</Typography>
              </FormControl>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCharacterDialog(false)}>{strings.cancel}</Button>
          <Button variant="contained" disabled={!characterName.trim() || !characterAnchor.trim() || characterRefs.length === 0} onClick={saveCharacter}>{strings.save}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteAsset)}
        title={strings.delete}
        description={deleteAsset ? `${deleteAsset.displayName}. ${strings.deleteDescription}` : ""}
        confirmLabel={strings.delete}
        onClose={() => setDeleteAsset(null)}
        onConfirm={removeAsset}
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
