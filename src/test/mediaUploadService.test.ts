import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { MediaUploadService } from "../server/v2/media/mediaUploadService";

/** Builds a valid PNG of the requested size; only the IHDR is inspected. */
function pngWithSize(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/**
 * These tests used to run against the module-level singleton, which points at
 * whatever DATA_DIR_PATH resolves to - the live customer media library on a
 * developer workstation. Two placeholder assets from a test run are still sitting
 * in the shipped library because of it. Every test here now owns a throwaway
 * storage root, and the suite asserts that nothing can silently remove media.
 */
describe("MediaUploadService", () => {
  let root: string;
  let service: MediaUploadService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "abud-media-test-"));
    service = new MediaUploadService(root);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it("stores media under the supplied root and never the process-wide one", () => {
    expect(service.getStorageRoot().startsWith(path.resolve(root))).toBe(true);
  });

  it("rejects non-image buffers with invalid magic bytes", async () => {
    const invalidBuffer = Buffer.from("THIS_IS_NOT_AN_IMAGE_FILE");
    await expect(
      service.saveProductImage(invalidBuffer, "test.txt", { removeBackground: false }),
    ).rejects.toThrow("Unsupported file");
  });

  it("accepts a real image and generates a canonical asset ID", async () => {
    const media = await service.saveProductImage(pngWithSize(512, 512), "sample_item.png", {
      removeBackground: false,
    });

    expect(media.id).toMatch(/^asset_/);
    expect(media.mimeType).toBe("image/png");
    expect(media.originalName).toBe("sample_item.png");
    // Dimensions come from the file itself, not from a default.
    expect(media.width).toBe(512);
    expect(media.height).toBe(512);

    expect((await service.getProductImage(media.id))?.id).toBe(media.id);
    expect((await service.listProductImages()).some((item) => item.id === media.id)).toBe(true);
  });

  it("rejects a 1x1 placeholder even though it is a structurally valid PNG", async () => {
    // This case used to be accepted, and is exactly why the media library filled
    // with 70-byte "product photos" that rendered as blank cards.
    const placeholder = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527defc0000000049454e44ae426082",
      "hex",
    );
    await expect(
      service.saveProductImage(placeholder, "luxury_smartwatch.png", { removeBackground: false }),
    ).rejects.toThrow(/at least 32px/i);
  });

  it("returns the existing record instead of storing byte-identical duplicates", async () => {
    const buffer = pngWithSize(640, 480);
    const first = await service.saveProductImage(buffer, "duplicate-source.png", {
      removeBackground: false,
    });
    const second = await service.saveProductImage(buffer, "duplicate-copy.png", {
      removeBackground: false,
    });

    expect(second.id).toBe(first.id);
    expect(second.duplicateOf).toBe(first.id);
  });

  it("stores general images, video clips and audio with purpose-aware usability", async () => {
    const image = await service.saveAsset(pngWithSize(512, 512), "logo.png", {
      purpose: "brand_logo",
      tags: ["Brand", "Logo"],
    });
    const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(16)]);
    const video = await service.saveAsset(mp4, "clip.mp4", { purpose: "background_media" });
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(16)]);
    const audio = await service.saveAsset(wav, "music.wav", { purpose: "music" });

    expect(image.mediaType).toBe("image");
    expect(image.usability.usableForLogo).toBe(true);
    expect(image.tags).toContain("brand");
    expect(video.mediaType).toBe("video");
    expect(video.usability.usableForVideo).toBe(true);
    expect(audio.mediaType).toBe("audio");
    expect(audio.usability.usableForVideo).toBe(true);
    expect(audio.usability.usableForCharacterReference).toBe(false);
  });

  it("supports metadata folders and search filters without moving bytes", async () => {
    const folder = await service.createFolder("Campaign A");
    const asset = await service.saveAsset(pngWithSize(512, 512), "hero.png", {
      purpose: "general",
      folderId: folder.id,
      tags: ["office"],
    });

    const inFolder = await service.listAssets({ folderId: folder.id });
    const tagged = await service.listAssets({ tag: "office" });

    expect(inFolder.map((item) => item.id)).toContain(asset.id);
    expect(tagged.map((item) => item.id)).toContain(asset.id);
    await expect(service.archiveFolder(folder.id)).rejects.toThrow(/empty folders/i);
  });

  it("creates character profiles from suitable library references and snapshots revisions", async () => {
    const first = await service.saveAsset(pngWithSize(512, 512), "person-a.png", {
      purpose: "character_reference",
    });
    const second = await service.saveAsset(pngWithSize(768, 512), "person-b.png", {
      purpose: "character_reference",
    });

    const profile = await service.createCharacter({
      name: "Mona",
      referenceAssetIds: [first.id, second.id],
      primaryReferenceAssetId: first.id,
      promptAnchor: "Young Egyptian designer with short dark hair.",
    });
    const updated = await service.updateCharacter(profile.id, {
      promptAnchor: "Young Egyptian designer with short dark curly hair.",
    });
    const snapshot = await service.snapshotCharacter(profile.id, {
      id: "test_reference_visual",
      supportsReferenceImages: true,
    });

    expect(profile.revision).toBe(1);
    expect(updated?.revision).toBe(2);
    expect(updated?.revisions).toHaveLength(2);
    expect(snapshot?.revision).toBe(2);
    expect(snapshot?.referenceAssetIds).toEqual([first.id, second.id]);
    expect(snapshot?.consistencyMode).toBe("reference_guided");
  });

  it("blocks deleting assets that active character profiles reference", async () => {
    const reference = await service.saveAsset(pngWithSize(512, 512), "person.png", {
      purpose: "character_reference",
    });
    await service.createCharacter({
      name: "Safe Character",
      referenceAssetIds: [reference.id],
      promptAnchor: "Recurring character.",
    });

    await expect(service.deleteAsset(reference.id, "user_request")).rejects.toThrow(/character profile/i);
    expect(await fs.pathExists(reference.storagePath)).toBe(true);
  });

  it("blocks archiving assets that active character profiles reference", async () => {
    const reference = await service.saveAsset(pngWithSize(512, 512), "person.png", {
      purpose: "character_reference",
    });
    await service.createCharacter({
      name: "Archive Safe Character",
      referenceAssetIds: [reference.id],
      promptAnchor: "Recurring character.",
    });

    await expect(service.updateAsset(reference.id, { archived: true })).rejects.toThrow(/character profile/i);
    const stillListed = await service.getAsset(reference.id);
    expect(stillListed?.status).toBe("ready");
  });

  it("keeps historical character snapshots stable after later profile edits", async () => {
    const reference = await service.saveAsset(pngWithSize(512, 512), "person.png", {
      purpose: "character_reference",
    });
    const profile = await service.createCharacter({
      name: "Stable Character",
      referenceAssetIds: [reference.id],
      promptAnchor: "Original identity anchor.",
    });
    const firstSnapshot = await service.snapshotCharacter(profile.id, {
      id: "test_reference_visual",
      supportsReferenceImages: true,
    });

    await service.updateCharacter(profile.id, {
      promptAnchor: "Edited identity anchor.",
    });
    const secondSnapshot = await service.snapshotCharacter(profile.id, {
      id: "test_reference_visual",
      supportsReferenceImages: true,
    });

    expect(firstSnapshot?.revision).toBe(1);
    expect(firstSnapshot?.promptAnchor).toBe("Original identity anchor.");
    expect(secondSnapshot?.revision).toBe(2);
    expect(secondSnapshot?.promptAnchor).toBe("Edited identity anchor.");
  });

  describe("persistent media safety", () => {
    it("refuses a deletion that does not state a reason", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "keep-me.png", {
        removeBackground: false,
      });
      await expect(
        // A caller reaching this path without a documented reason is the exact
        // failure the invariant exists to prevent.
        service.deleteProductImage(media.id, "" as never),
      ).rejects.toThrow(/explicit reason/i);
      expect(await fs.pathExists(media.storagePath)).toBe(true);
      expect((await service.listProductImages()).length).toBe(1);
    });

    it("refuses a retention deletion with no policy recorded", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "keep-me.png", {
        removeBackground: false,
      });
      await expect(
        service.deleteProductImage(media.id, "documented_retention"),
      ).rejects.toThrow(/policy/i);
      expect(await fs.pathExists(media.storagePath)).toBe(true);
    });

    it("deletes on an explicit user request and writes an audit record", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "remove-me.png", {
        removeBackground: false,
      });
      expect(await service.deleteProductImage(media.id, "user_request")).toBe(true);
      expect(await fs.pathExists(media.storagePath)).toBe(false);

      const audit = await service.listDeletionAudit();
      expect(audit).toHaveLength(1);
      expect(audit[0].id).toBe(media.id);
      expect(audit[0].reason).toBe("user_request");
      expect(audit[0].checksum).toBe(media.checksum);
    });

    it("keeps an unusable legacy asset, marking it rather than removing it", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "legacy.png", {
        removeBackground: false,
      });
      // Simulate a legacy 1x1 placeholder already on disk from before validation.
      await fs.writeFile(
        media.storagePath,
        Buffer.from(
          "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527defc0000000049454e44ae426082",
          "hex",
        ),
      );

      const listed = await service.listProductImages();
      expect(listed).toHaveLength(1);
      expect(listed[0].usable).toBe(false);
      expect(listed[0].unusableReason).toMatch(/at least 32px/i);
      // Marked, not deleted: the bytes and the manifest entry both survive.
      expect(await fs.pathExists(media.storagePath)).toBe(true);
    });

    it("never silently empties the library when the index is unreadable", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "precious.png", {
        removeBackground: false,
      });
      const manifestPath = path.join(root, "uploads", "media_assets.json");
      await fs.writeFile(manifestPath, "{ this is not json", "utf8");

      // The old behaviour was to read the damaged index as empty and then
      // persist that emptiness on the next write, losing every record.
      await expect(
        service.saveProductImage(pngWithSize(800, 600), "next.png", { removeBackground: false }),
      ).rejects.toThrow(/could not be read/i);

      // The stored bytes are untouched and the damaged index was preserved.
      expect(await fs.pathExists(media.storagePath)).toBe(true);
      const preserved = (await fs.readdir(path.join(root, "uploads"))).filter((name) =>
        name.includes(".corrupt-"),
      );
      expect(preserved.length).toBeGreaterThan(0);
    });

    it("keeps records when a rename is applied", async () => {
      const media = await service.saveProductImage(pngWithSize(512, 512), "before.png", {
        removeBackground: false,
      });
      await service.renameProductImage(media.id, "after.png");
      const listed = await service.listProductImages();
      expect(listed).toHaveLength(1);
      expect(listed[0].originalName).toBe("after.png");
      expect(await fs.pathExists(media.storagePath)).toBe(true);
    });
  });
});
