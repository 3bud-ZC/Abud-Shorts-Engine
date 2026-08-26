import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import cuid from "cuid";
import { qualityEngine } from "../quality/qualityEngine";
import { inspectImage, MIN_USABLE_EDGE_PX } from "./imageInspection";

export type MediaAssetType = "image" | "video" | "audio";
export type MediaAssetPurpose =
  | "general"
  | "product"
  | "brand_logo"
  | "character_reference"
  | "background_media"
  | "music"
  | "reference";
export type MediaAssetStatus = "ready" | "unusable" | "archived";

export type MediaUsability = {
  usableForVideo: boolean;
  usableForProduct: boolean;
  usableForLogo: boolean;
  usableForCharacterReference: boolean;
  reasons: Partial<Record<"video" | "product" | "logo" | "characterReference", string>>;
};

export type MediaAsset = {
  id: string;
  filename: string;
  originalName: string;
  displayName: string;
  mediaType: MediaAssetType;
  purpose: MediaAssetPurpose;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  codec?: string;
  checksum: string;
  storagePath: string;
  relativePath: string;
  previewUrl: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  folderId?: string;
  tags: string[];
  status: MediaAssetStatus;
  usable: boolean;
  usableReason?: string;
  duplicateOf?: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string;
  archivedAt?: string;
  nobgArtifactId?: string;
  nobgRelativePath?: string;
  usability: MediaUsability;
};

export type MediaFolder = {
  id: string;
  name: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CharacterProfileStatus = "ready" | "provider_unavailable" | "archived";

export type CharacterProfileRevision = {
  revision: number;
  referenceAssetIds: string[];
  primaryReferenceAssetId?: string;
  promptAnchor: string;
  negativeNotes?: string;
  createdAt: string;
};

export type CharacterProfile = {
  id: string;
  name: string;
  referenceAssetIds: string[];
  primaryReferenceAssetId?: string;
  description?: string;
  visualTraits?: string;
  promptAnchor: string;
  negativeNotes?: string;
  status: CharacterProfileStatus;
  revision: number;
  revisions: CharacterProfileRevision[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type CharacterSnapshot = {
  profileId: string;
  profileName: string;
  revision: number;
  referenceAssetIds: string[];
  primaryReferenceAssetId?: string;
  promptAnchor: string;
  negativeNotes?: string;
  consistencyMode: "reference_guided" | "provider_native" | "unavailable";
  providerId?: string;
  capabilityMode: "reference_images" | "native_character_identity" | "none";
};

export type UploadedProductMedia = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  storagePath: string;
  relativePath: string;
  uploadedAt: string;
  nobgArtifactId?: string;
  nobgRelativePath?: string;
  usable?: boolean;
  unusableReason?: string;
  duplicateOf?: string;
};

export type MediaDeletionReason = "user_request" | "documented_retention";

export type MediaDeletionAudit = {
  id: string;
  filename: string;
  reason: MediaDeletionReason;
  note?: string;
  deletedAt: string;
  sizeBytes: number;
  checksum: string;
};

type UploadOptions = {
  purpose?: MediaAssetPurpose;
  displayName?: string;
  folderId?: string;
  tags?: string[];
  removeBackground?: boolean;
};

type StoreShape<T> = Record<string, T>;

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_ASSET_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;

function safeDisplayName(value: string): string {
  const trimmed = value.trim().slice(0, 160);
  return trimmed || "Untitled asset";
}

function safeFilenameStem(value: string): string {
  const parsed = path.parse(value);
  const stem = (parsed.name || "asset").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return stem || "asset";
}

function normalizeTags(tags?: string[]): string[] {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= 40),
    ),
  ).slice(0, 24);
}

function mimeExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "audio/mpeg": return "mp3";
    case "audio/wav": return "wav";
    case "audio/ogg": return "ogg";
    case "audio/mp4": return "m4a";
    default: return "bin";
  }
}

function detectVideoOrAudio(buffer: Buffer): { mediaType: MediaAssetType; mimeType: string; codec?: string } | null {
  if (buffer.length < 12) return null;
  const head4 = buffer.subarray(0, 4).toString("ascii");
  const box = buffer.subarray(4, 8).toString("ascii");
  const brand = buffer.subarray(8, 12).toString("ascii");
  if (box === "ftyp") {
    if (brand.includes("qt")) return { mediaType: "video", mimeType: "video/quicktime", codec: "quicktime" };
    if (/M4A/i.test(brand)) return { mediaType: "audio", mimeType: "audio/mp4", codec: "m4a" };
    if (/mp4|isom|iso2|avc1/i.test(brand)) return { mediaType: "video", mimeType: "video/mp4", codec: "mp4" };
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mediaType: "video", mimeType: "video/webm", codec: "webm" };
  }
  if (head4 === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return { mediaType: "audio", mimeType: "audio/wav", codec: "wav" };
  }
  if (head4 === "OggS") return { mediaType: "audio", mimeType: "audio/ogg", codec: "ogg" };
  if (head4.startsWith("ID3") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { mediaType: "audio", mimeType: "audio/mpeg", codec: "mp3" };
  }
  return null;
}

function inspectMedia(buffer: Buffer): {
  mediaType?: MediaAssetType;
  mimeType?: string;
  width?: number;
  height?: number;
  codec?: string;
  usable: boolean;
  reason?: string;
} {
  if (buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").includes("<svg")) {
    return { usable: false, reason: "SVG files are not accepted because this renderer cannot sanitize them safely." };
  }
  const image = inspectImage(buffer);
  if (image.mime) {
    return {
      mediaType: "image",
      mimeType: image.mime,
      width: image.width,
      height: image.height,
      usable: image.usable,
      reason: image.usable ? undefined : image.reason,
    };
  }
  const av = detectVideoOrAudio(buffer);
  if (av) return { ...av, usable: true };
  return { usable: false, reason: "Unsupported file. Upload PNG, JPEG, WEBP, MP4, MOV, WEBM, MP3, WAV, OGG, or M4A." };
}

function usabilityFor(asset: {
  mediaType: MediaAssetType;
  width?: number;
  height?: number;
  usable: boolean;
  usableReason?: string;
}): MediaUsability {
  const reasons: MediaUsability["reasons"] = {};
  const image = asset.mediaType === "image";
  const width = asset.width || 0;
  const height = asset.height || 0;
  const minEdge = Math.min(width, height);
  const baseReason = asset.usableReason || "This file is not readable.";
  const usableForVideo = asset.usable;
  if (!usableForVideo) reasons.video = baseReason;
  const usableForProduct = asset.usable && image && minEdge >= MIN_USABLE_EDGE_PX;
  if (!usableForProduct) reasons.product = image ? `Product images must be at least ${MIN_USABLE_EDGE_PX}px on each edge.` : "Product media must be an image.";
  const usableForLogo = asset.usable && image && width >= 64 && height >= 64;
  if (!usableForLogo) reasons.logo = image ? "Logo assets must be at least 64px by 64px." : "Logos must be image files.";
  const usableForCharacterReference = asset.usable && image && width >= 256 && height >= 256;
  if (!usableForCharacterReference) {
    reasons.characterReference = image
      ? "Character references must be clear images at least 256px by 256px."
      : "Character references must be image files.";
  }
  return { usableForVideo, usableForProduct, usableForLogo, usableForCharacterReference, reasons };
}

export class MediaUploadService {
  private baseDataDir: string;
  private libraryDir: string;
  private legacyProductsDir: string;
  private assetStorePath: string;
  private folderStorePath: string;
  private characterStorePath: string;
  private legacyProductStorePath: string;
  private deletionAuditPath: string;

  constructor(baseDataDirOverride?: string) {
    this.baseDataDir = baseDataDirOverride
      ? path.resolve(baseDataDirOverride)
      : process.env.DATA_DIR_PATH
        ? path.resolve(process.env.DATA_DIR_PATH)
        : path.resolve(process.cwd(), "data-dev");
    const uploadsRoot = path.join(this.baseDataDir, "uploads");
    this.libraryDir = path.join(uploadsRoot, "library");
    this.legacyProductsDir = path.join(uploadsRoot, "products");
    this.assetStorePath = path.join(uploadsRoot, "media_assets.json");
    this.folderStorePath = path.join(uploadsRoot, "media_folders.json");
    this.characterStorePath = path.join(uploadsRoot, "character_profiles.json");
    this.legacyProductStorePath = path.join(uploadsRoot, "products_manifest.json");
    this.deletionAuditPath = path.join(uploadsRoot, "media_deletions.json");
    fs.ensureDirSync(this.libraryDir);
    fs.ensureDirSync(this.legacyProductsDir);
  }

  public getStorageRoot(): string {
    return this.libraryDir;
  }

  public getBaseDataDir(): string {
    return this.baseDataDir;
  }

  private async readStore<T>(storePath: string, label: string): Promise<StoreShape<T>> {
    if (!(await fs.pathExists(storePath))) return {};
    const raw = await fs.readFile(storePath, "utf8");
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid shape");
      return parsed as StoreShape<T>;
    } catch {
      const quarantine = `${storePath}.corrupt-${Date.now()}`;
      await fs.copy(storePath, quarantine).catch(() => undefined);
      throw new Error(`The ${label} index could not be read and was preserved at ${quarantine}. No media was changed.`);
    }
  }

  private async saveStore<T>(
    storePath: string,
    label: string,
    store: StoreShape<T>,
    options: { allowEmptying?: boolean } = {},
  ): Promise<void> {
    if (Object.keys(store).length === 0 && !options.allowEmptying && (await fs.pathExists(storePath))) {
      const current = await this.readStore<T>(storePath, label);
      if (Object.keys(current).length > 0) {
        throw new Error(`Refused to replace the ${label} index with an empty one. Deletion requires an explicit request.`);
      }
    }
    await fs.writeJson(storePath, store, { spaces: 2 });
  }

  private async getAssetStore(): Promise<StoreShape<MediaAsset>> {
    return this.readStore<MediaAsset>(this.assetStorePath, "media library");
  }

  private async saveAssetStore(store: StoreShape<MediaAsset>, options: { allowEmptying?: boolean } = {}) {
    await this.saveStore(this.assetStorePath, "media library", store, options);
  }

  private async getFolderStore(): Promise<StoreShape<MediaFolder>> {
    return this.readStore<MediaFolder>(this.folderStorePath, "media folders");
  }

  private async getCharacterStore(): Promise<StoreShape<CharacterProfile>> {
    return this.readStore<CharacterProfile>(this.characterStorePath, "character profiles");
  }

  private async saveCharacterStore(store: StoreShape<CharacterProfile>) {
    await this.saveStore(this.characterStorePath, "character profiles", store);
  }

  private async getLegacyProductManifest(): Promise<StoreShape<UploadedProductMedia>> {
    return this.readStore<UploadedProductMedia>(this.legacyProductStorePath, "product media library");
  }

  private async saveLegacyProductManifest(store: StoreShape<UploadedProductMedia>, options: { allowEmptying?: boolean } = {}) {
    await this.saveStore(this.legacyProductStorePath, "product media library", store, options);
  }

  private async appendDeletionAudit(entry: MediaDeletionAudit): Promise<void> {
    let history: MediaDeletionAudit[] = [];
    if (await fs.pathExists(this.deletionAuditPath)) {
      try {
        const parsed = await fs.readJson(this.deletionAuditPath);
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        history = [];
      }
    }
    history.push(entry);
    await fs.writeJson(this.deletionAuditPath, history, { spaces: 2 });
  }

  public async listDeletionAudit(): Promise<MediaDeletionAudit[]> {
    if (!(await fs.pathExists(this.deletionAuditPath))) return [];
    try {
      const parsed = await fs.readJson(this.deletionAuditPath);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private legacyProductToAsset(record: UploadedProductMedia): MediaAsset {
    const usable = record.usable !== false;
    const base = {
      id: record.id,
      filename: record.filename,
      originalName: record.originalName,
      displayName: record.originalName || record.filename,
      mediaType: "image" as const,
      purpose: "product" as const,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      width: record.width,
      height: record.height,
      checksum: record.checksum,
      storagePath: record.storagePath,
      relativePath: record.relativePath,
      previewUrl: `/api/v2/media/uploads/${record.filename}`,
      tags: ["product"],
      status: usable ? "ready" as const : "unusable" as const,
      usable,
      usableReason: record.unusableReason,
      duplicateOf: record.duplicateOf,
      usageCount: 0,
      createdAt: record.uploadedAt,
      updatedAt: record.uploadedAt,
      uploadedAt: record.uploadedAt,
      nobgArtifactId: record.nobgArtifactId,
      nobgRelativePath: record.nobgRelativePath,
    };
    return { ...base, usability: usabilityFor(base) };
  }

  public async saveAsset(buffer: Buffer, originalName: string, options: UploadOptions = {}): Promise<MediaAsset> {
    if (buffer.length > MAX_ASSET_SIZE_BYTES) throw new Error("File exceeds the 200MB media-library limit.");
    const inspected = inspectMedia(buffer);
    if (!inspected.mediaType || !inspected.mimeType) throw new Error(inspected.reason || "Unsupported media file.");
    if (inspected.mediaType === "image" && buffer.length > MAX_IMAGE_SIZE_BYTES) throw new Error("Images are limited to 25MB.");

    const purpose = options.purpose || "general";
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const manifest = await this.getAssetStore();
    const duplicate = Object.values(manifest).find((candidate) => candidate.checksum === checksum);
    if (duplicate) return { ...duplicate, duplicateOf: duplicate.id };

    const id = `asset_${cuid()}`;
    const filename = `${id}_${safeFilenameStem(originalName)}.${mimeExtension(inspected.mimeType)}`;
    const storagePath = path.join(this.libraryDir, filename);
    const resolvedStoragePath = path.resolve(storagePath);
    if (!resolvedStoragePath.startsWith(path.resolve(this.libraryDir) + path.sep)) throw new Error("Unsafe upload path.");
    await fs.writeFile(storagePath, buffer);

    const now = new Date().toISOString();
    const preliminary = {
      mediaType: inspected.mediaType,
      width: inspected.width,
      height: inspected.height,
      usable: inspected.usable,
      usableReason: inspected.reason,
    };
    const usability = usabilityFor(preliminary);
    let nobgArtifactId: string | undefined;
    let nobgRelativePath: string | undefined;
    if (purpose === "product" && options.removeBackground !== false && usability.usableForProduct) {
      try {
        const rembgRes = await qualityEngine.removeBackground(storagePath);
        nobgArtifactId = rembgRes.artifactId;
        nobgRelativePath = rembgRes.relativePath;
      } catch {
        // Background removal is optional; the original asset remains usable.
      }
    }

    const asset: MediaAsset = {
      id,
      filename,
      originalName: safeFilenameStem(originalName) + path.extname(originalName).toLowerCase(),
      displayName: safeDisplayName(options.displayName || originalName),
      mediaType: inspected.mediaType,
      purpose,
      mimeType: inspected.mimeType,
      sizeBytes: buffer.length,
      width: inspected.width,
      height: inspected.height,
      codec: inspected.codec,
      checksum,
      storagePath,
      relativePath: path.relative(this.baseDataDir, storagePath).replace(/\\/g, "/"),
      previewUrl: `/api/v2/media/uploads/${filename}`,
      thumbnailUrl: inspected.mediaType === "image" ? `/api/v2/media/uploads/${filename}` : undefined,
      posterUrl: inspected.mediaType === "video" ? `/api/v2/media/uploads/${filename}` : undefined,
      tags: normalizeTags(options.tags),
      folderId: options.folderId,
      status: inspected.usable ? "ready" : "unusable",
      usable: inspected.usable,
      usableReason: inspected.reason,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      uploadedAt: now,
      nobgArtifactId,
      nobgRelativePath,
      usability,
    };
    manifest[id] = asset;
    await this.saveAssetStore(manifest);
    return asset;
  }

  public async listAssets(filters: { search?: string; type?: string; purpose?: string; folderId?: string; tag?: string; includeArchived?: boolean } = {}): Promise<MediaAsset[]> {
    const canonical = await Promise.all(Object.values(await this.getAssetStore()).map((asset) => this.inspectStoredAsset(asset)));
    const legacy = Object.values(await this.getLegacyProductManifest()).map((record) => this.legacyProductToAsset(record));
    const seen = new Set(canonical.map((asset) => asset.id));
    const all = canonical.concat(legacy.filter((asset) => !seen.has(asset.id)));
    const query = (filters.search || "").trim().toLowerCase();
    return all
      .filter((asset) => filters.includeArchived || asset.status !== "archived")
      .filter((asset) => !filters.type || asset.mediaType === filters.type)
      .filter((asset) => !filters.purpose || asset.purpose === filters.purpose)
      .filter((asset) => !filters.folderId || asset.folderId === filters.folderId)
      .filter((asset) => !filters.tag || asset.tags.includes(filters.tag.toLowerCase()))
      .filter((asset) => !query || [asset.displayName, asset.originalName, asset.mimeType, asset.purpose, ...asset.tags].join(" ").toLowerCase().includes(query))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private async inspectStoredAsset(asset: MediaAsset): Promise<MediaAsset> {
    let next = { ...asset };
    try {
      if (!(await fs.pathExists(asset.storagePath))) {
        next = { ...next, usable: false, usableReason: "The file for this item is missing from storage.", status: "unusable" };
      } else {
        const buffer = await fs.readFile(asset.storagePath);
        const inspected = inspectMedia(buffer);
        if (!inspected.mediaType || !inspected.mimeType) {
          next = { ...next, usable: false, usableReason: inspected.reason || "This file could not be read.", status: "unusable" };
        } else {
          next = {
            ...next,
            mediaType: inspected.mediaType,
            mimeType: inspected.mimeType,
            width: inspected.width,
            height: inspected.height,
            codec: inspected.codec,
            usable: inspected.usable,
            usableReason: inspected.reason,
            status: inspected.usable ? next.status === "archived" ? "archived" : "ready" : "unusable",
          };
        }
      }
    } catch {
      next = { ...next, usable: false, usableReason: "This file could not be read.", status: "unusable" };
    }
    next.usability = usabilityFor(next);
    return next;
  }

  public async getAsset(id: string): Promise<MediaAsset | null> {
    const assets = await this.listAssets({ includeArchived: true });
    return assets.find((asset) => asset.id === id) || null;
  }

  public async resolveUploadPath(filename: string): Promise<string | null> {
    const safeName = path.basename(filename);
    const assets = await this.listAssets({ includeArchived: true }).catch(() => []);
    const asset = assets.find((item) => item.filename === safeName);
    if (asset && (await fs.pathExists(asset.storagePath))) return asset.storagePath;
    const direct = path.join(this.baseDataDir, "uploads", safeName);
    if (await fs.pathExists(direct)) return direct;
    return null;
  }

  public async updateAsset(id: string, patch: { displayName?: string; purpose?: MediaAssetPurpose; folderId?: string | null; tags?: string[]; archived?: boolean }): Promise<MediaAsset | null> {
    const manifest = await this.getAssetStore();
    const record = manifest[id];
    if (!record) return null;
    if (patch.archived === true) {
      const dependentCharacter = Object.values(await this.getCharacterStore()).find((profile) => profile.status !== "archived" && profile.referenceAssetIds.includes(id));
      if (dependentCharacter) throw new Error(`This asset is used by character profile "${dependentCharacter.name}". Archive it or update the character first.`);
    }
    if (patch.displayName !== undefined) record.displayName = safeDisplayName(patch.displayName);
    if (patch.purpose) record.purpose = patch.purpose;
    if (patch.folderId !== undefined) record.folderId = patch.folderId || undefined;
    if (patch.tags) record.tags = normalizeTags(patch.tags);
    if (patch.archived !== undefined) {
      record.status = patch.archived ? "archived" : record.usable ? "ready" : "unusable";
      record.archivedAt = patch.archived ? new Date().toISOString() : undefined;
    }
    record.usability = usabilityFor(record);
    record.updatedAt = new Date().toISOString();
    manifest[id] = record;
    await this.saveAssetStore(manifest);
    return record;
  }

  public async replaceAsset(id: string, buffer: Buffer, originalName: string): Promise<MediaAsset | null> {
    const manifest = await this.getAssetStore();
    const current = manifest[id];
    if (!current) return null;
    const oldStorage = current.storagePath;
    const replacement = await this.saveAsset(buffer, originalName, {
      purpose: current.purpose,
      displayName: current.displayName,
      folderId: current.folderId,
      tags: current.tags,
      removeBackground: false,
    });
    const updated = { ...replacement, id, createdAt: current.createdAt, updatedAt: new Date().toISOString(), usageCount: current.usageCount };
    const refreshed = await this.getAssetStore();
    delete refreshed[replacement.id];
    refreshed[id] = updated;
    await this.saveAssetStore(refreshed);
    if (oldStorage !== updated.storagePath) await fs.remove(oldStorage).catch(() => undefined);
    return updated;
  }

  public async deleteAsset(id: string, reason: MediaDeletionReason, note?: string): Promise<boolean> {
    if (reason !== "user_request" && reason !== "documented_retention") throw new Error("Deleting customer media requires an explicit reason: user_request or documented_retention.");
    if (reason === "documented_retention" && !note?.trim()) throw new Error("A retention deletion must record the policy it is acting under.");
    const dependentCharacter = Object.values(await this.getCharacterStore()).find((profile) => profile.status !== "archived" && profile.referenceAssetIds.includes(id));
    if (dependentCharacter) throw new Error(`This asset is used by character profile "${dependentCharacter.name}". Archive it or update the character first.`);
    const manifest = await this.getAssetStore();
    const record = manifest[id];
    if (!record) return false;
    await this.appendDeletionAudit({ id: record.id, filename: record.filename, reason, note: note?.trim() || undefined, deletedAt: new Date().toISOString(), sizeBytes: record.sizeBytes, checksum: record.checksum });
    if (await fs.pathExists(record.storagePath)) await fs.remove(record.storagePath);
    delete manifest[id];
    await this.saveAssetStore(manifest, { allowEmptying: true });
    return true;
  }

  public async listFolders(): Promise<MediaFolder[]> {
    return Object.values(await this.getFolderStore()).filter((folder) => !folder.archived).sort((a, b) => a.name.localeCompare(b.name));
  }

  public async createFolder(name: string): Promise<MediaFolder> {
    const store = await this.getFolderStore();
    const now = new Date().toISOString();
    const folder: MediaFolder = { id: `folder_${cuid()}`, name: safeDisplayName(name), createdAt: now, updatedAt: now };
    store[folder.id] = folder;
    await this.saveStore(this.folderStorePath, "media folders", store);
    return folder;
  }

  public async renameFolder(id: string, name: string): Promise<MediaFolder | null> {
    const store = await this.getFolderStore();
    const folder = store[id];
    if (!folder) return null;
    folder.name = safeDisplayName(name);
    folder.updatedAt = new Date().toISOString();
    await this.saveStore(this.folderStorePath, "media folders", store);
    return folder;
  }

  public async archiveFolder(id: string): Promise<boolean> {
    const assets = await this.listAssets({ folderId: id, includeArchived: true });
    if (assets.some((asset) => asset.status !== "archived")) throw new Error("Only empty folders can be archived.");
    const store = await this.getFolderStore();
    if (!store[id]) return false;
    store[id].archived = true;
    store[id].updatedAt = new Date().toISOString();
    await this.saveStore(this.folderStorePath, "media folders", store);
    return true;
  }

  public async saveProductImage(buffer: Buffer, originalName: string, options: { removeBackground?: boolean } = {}): Promise<UploadedProductMedia> {
    const asset = await this.saveAsset(buffer, originalName, { purpose: "product", tags: ["product"], removeBackground: options.removeBackground });
    if (!IMAGE_MIMES.includes(asset.mimeType as any) || !asset.width || !asset.height) throw new Error("Product media must be a usable PNG, JPEG or WEBP image.");
    if (!asset.usability.usableForProduct) throw new Error(asset.usability.reasons.product || `Images must be at least ${MIN_USABLE_EDGE_PX}x${MIN_USABLE_EDGE_PX} pixels.`);
    return this.assetToProduct(asset);
  }

  private assetToProduct(asset: MediaAsset): UploadedProductMedia {
    return {
      id: asset.id,
      filename: asset.filename,
      originalName: asset.displayName || asset.originalName,
      mimeType: asset.mimeType as UploadedProductMedia["mimeType"],
      sizeBytes: asset.sizeBytes,
      width: asset.width || 0,
      height: asset.height || 0,
      checksum: asset.checksum,
      storagePath: asset.storagePath,
      relativePath: asset.relativePath,
      uploadedAt: asset.uploadedAt,
      nobgArtifactId: asset.nobgArtifactId,
      nobgRelativePath: asset.nobgRelativePath,
      usable: asset.usability.usableForProduct,
      unusableReason: asset.usability.reasons.product,
      duplicateOf: asset.duplicateOf,
    };
  }

  public async getProductImage(id: string): Promise<UploadedProductMedia | null> {
    const asset = await this.getAsset(id);
    if (asset && asset.mediaType === "image") return this.assetToProduct(asset);
    const legacy = await this.getLegacyProductManifest();
    return legacy[id] || null;
  }

  public async listProductImages(): Promise<UploadedProductMedia[]> {
    const assets = await this.listAssets({ includeArchived: false });
    return assets
      .filter((asset) => asset.mediaType === "image" && (asset.purpose === "product" || asset.purpose === "general" || asset.purpose === "brand_logo"))
      .map((asset) => this.assetToProduct(asset));
  }

  public async deleteProductImage(id: string, reason: MediaDeletionReason, note?: string): Promise<boolean> {
    const canonical = await this.getAsset(id);
    if (canonical) return this.deleteAsset(id, reason, note);
    const manifest = await this.getLegacyProductManifest();
    const record = manifest[id];
    if (!record) return false;
    await this.appendDeletionAudit({ id: record.id, filename: record.filename, reason, note, deletedAt: new Date().toISOString(), sizeBytes: record.sizeBytes, checksum: record.checksum });
    if (await fs.pathExists(record.storagePath)) await fs.remove(record.storagePath);
    delete manifest[id];
    await this.saveLegacyProductManifest(manifest, { allowEmptying: true });
    return true;
  }

  public async renameProductImage(id: string, originalName: string): Promise<UploadedProductMedia | null> {
    const updated = await this.updateAsset(id, { displayName: originalName });
    if (updated) return this.assetToProduct(updated);
    const manifest = await this.getLegacyProductManifest();
    const record = manifest[id];
    if (!record) return null;
    record.originalName = safeDisplayName(originalName);
    manifest[id] = record;
    await this.saveLegacyProductManifest(manifest);
    return record;
  }

  public async listCharacters(): Promise<CharacterProfile[]> {
    return Object.values(await this.getCharacterStore()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public async createCharacter(input: {
    name: string;
    referenceAssetIds: string[];
    primaryReferenceAssetId?: string;
    description?: string;
    visualTraits?: string;
    promptAnchor: string;
    negativeNotes?: string;
  }): Promise<CharacterProfile> {
    const references = await this.validateCharacterReferences(input.referenceAssetIds, input.primaryReferenceAssetId);
    const now = new Date().toISOString();
    const profile: CharacterProfile = {
      id: `char_${cuid()}`,
      name: safeDisplayName(input.name),
      referenceAssetIds: references.referenceAssetIds,
      primaryReferenceAssetId: references.primaryReferenceAssetId,
      description: input.description?.trim().slice(0, 1000) || undefined,
      visualTraits: input.visualTraits?.trim().slice(0, 1000) || undefined,
      promptAnchor: input.promptAnchor.trim().slice(0, 1000),
      negativeNotes: input.negativeNotes?.trim().slice(0, 1000) || undefined,
      status: "provider_unavailable",
      revision: 1,
      revisions: [{
        revision: 1,
        referenceAssetIds: references.referenceAssetIds,
        primaryReferenceAssetId: references.primaryReferenceAssetId,
        promptAnchor: input.promptAnchor.trim().slice(0, 1000),
        negativeNotes: input.negativeNotes?.trim().slice(0, 1000) || undefined,
        createdAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    };
    const store = await this.getCharacterStore();
    store[profile.id] = profile;
    await this.saveCharacterStore(store);
    return profile;
  }

  public async updateCharacter(id: string, patch: Partial<Omit<CharacterProfile, "id" | "revision" | "revisions" | "createdAt" | "updatedAt">>): Promise<CharacterProfile | null> {
    const store = await this.getCharacterStore();
    const profile = store[id];
    if (!profile) return null;
    const references = await this.validateCharacterReferences(patch.referenceAssetIds || profile.referenceAssetIds, patch.primaryReferenceAssetId || profile.primaryReferenceAssetId);
    profile.name = patch.name ? safeDisplayName(patch.name) : profile.name;
    profile.referenceAssetIds = references.referenceAssetIds;
    profile.primaryReferenceAssetId = references.primaryReferenceAssetId;
    profile.description = patch.description !== undefined ? patch.description?.trim().slice(0, 1000) : profile.description;
    profile.visualTraits = patch.visualTraits !== undefined ? patch.visualTraits?.trim().slice(0, 1000) : profile.visualTraits;
    profile.promptAnchor = patch.promptAnchor !== undefined ? patch.promptAnchor.trim().slice(0, 1000) : profile.promptAnchor;
    profile.negativeNotes = patch.negativeNotes !== undefined ? patch.negativeNotes?.trim().slice(0, 1000) : profile.negativeNotes;
    profile.status = patch.status || profile.status;
    profile.revision += 1;
    profile.updatedAt = new Date().toISOString();
    profile.revisions.push({ revision: profile.revision, referenceAssetIds: profile.referenceAssetIds, primaryReferenceAssetId: profile.primaryReferenceAssetId, promptAnchor: profile.promptAnchor, negativeNotes: profile.negativeNotes, createdAt: profile.updatedAt });
    store[id] = profile;
    await this.saveCharacterStore(store);
    return profile;
  }

  public async archiveCharacter(id: string): Promise<boolean> {
    const store = await this.getCharacterStore();
    if (!store[id]) return false;
    store[id].status = "archived";
    store[id].archivedAt = new Date().toISOString();
    store[id].updatedAt = store[id].archivedAt!;
    await this.saveCharacterStore(store);
    return true;
  }

  public async snapshotCharacter(
    id: string,
    provider: { id?: string; supportsReferenceImages?: boolean; supportsNativeCharacterIdentity?: boolean } = {},
  ): Promise<CharacterSnapshot | null> {
    const profile = (await this.getCharacterStore())[id];
    if (!profile || profile.status === "archived") return null;
    const mode = provider.supportsNativeCharacterIdentity ? "provider_native" : provider.supportsReferenceImages ? "reference_guided" : "unavailable";
    return {
      profileId: profile.id,
      profileName: profile.name,
      revision: profile.revision,
      referenceAssetIds: [...profile.referenceAssetIds],
      primaryReferenceAssetId: profile.primaryReferenceAssetId,
      promptAnchor: profile.promptAnchor,
      negativeNotes: profile.negativeNotes,
      consistencyMode: mode,
      providerId: provider.id,
      capabilityMode: mode === "provider_native" ? "native_character_identity" : mode === "reference_guided" ? "reference_images" : "none",
    };
  }

  private async validateCharacterReferences(referenceAssetIds: string[], primaryReferenceAssetId?: string) {
    const cleanIds = Array.from(new Set(referenceAssetIds.map((id) => id.trim()).filter(Boolean))).slice(0, 12);
    if (cleanIds.length === 0) throw new Error("At least one character reference image is required.");
    const assets = await this.listAssets({ includeArchived: false });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const id of cleanIds) {
      const asset = byId.get(id);
      if (!asset) throw new Error("One or more character references were not found.");
      if (!asset.usability.usableForCharacterReference) {
        throw new Error(asset.usability.reasons.characterReference || "One or more references are not suitable character images.");
      }
    }
    const primary = primaryReferenceAssetId && cleanIds.includes(primaryReferenceAssetId) ? primaryReferenceAssetId : cleanIds[0];
    return { referenceAssetIds: cleanIds, primaryReferenceAssetId: primary };
  }
}

export const mediaUploadService = new MediaUploadService();
