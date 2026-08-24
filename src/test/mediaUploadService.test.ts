import { describe, it, expect } from "vitest";
import { mediaUploadService } from "../server/v2/media/mediaUploadService";

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

describe("MediaUploadService", () => {
  it("rejects non-image buffers with invalid magic bytes", async () => {
    const invalidBuffer = Buffer.from("THIS_IS_NOT_AN_IMAGE_FILE");
    await expect(
      mediaUploadService.saveProductImage(invalidBuffer, "test.txt", { removeBackground: false }),
    ).rejects.toThrow("Invalid image file format");
  });

  it("accepts a real image and generates a server ID with the prod_ prefix", async () => {
    const pngBuffer = pngWithSize(512, 512);

    const media = await mediaUploadService.saveProductImage(pngBuffer, "sample_item.png", {
      removeBackground: false,
    });

    expect(media).toBeDefined();
    expect(media.id).toMatch(/^prod_/);
    expect(media.mimeType).toBe("image/png");
    expect(media.originalName).toBe("sample_item.png");
    // Dimensions come from the file itself, not from a default.
    expect(media.width).toBe(512);
    expect(media.height).toBe(512);

    const fetched = await mediaUploadService.getProductImage(media.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(media.id);

    const list = await mediaUploadService.listProductImages();
    expect(list.some((item) => item.id === media.id)).toBe(true);
  });

  it("rejects a 1x1 placeholder even though it is a structurally valid PNG", async () => {
    // This case used to be accepted, and is exactly why the media library
    // filled with 70-byte "product photos" that rendered as blank cards. A
    // technically-valid image with nothing in it is not usable media.
    const placeholder = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527defc0000000049454e44ae426082",
      "hex",
    );
    await expect(
      mediaUploadService.saveProductImage(placeholder, "luxury_smartwatch.png", {
        removeBackground: false,
      }),
    ).rejects.toThrow(/too small/i);
  });

  it("returns the existing record instead of storing byte-identical duplicates", async () => {
    const buffer = pngWithSize(640, 480);
    const first = await mediaUploadService.saveProductImage(buffer, "duplicate-source.png", {
      removeBackground: false,
    });
    const second = await mediaUploadService.saveProductImage(buffer, "duplicate-copy.png", {
      removeBackground: false,
    });

    expect(second.id).toBe(first.id);
    expect(second.duplicateOf).toBe(first.id);
  });
});
