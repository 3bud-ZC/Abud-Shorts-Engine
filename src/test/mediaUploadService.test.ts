import { describe, it, expect } from "vitest";
import { mediaUploadService } from "../server/v2/media/mediaUploadService";

describe("MediaUploadService", () => {
  it("rejects non-image buffers with invalid magic bytes", async () => {
    const invalidBuffer = Buffer.from("THIS_IS_NOT_AN_IMAGE_FILE");
    await expect(
      mediaUploadService.saveProductImage(invalidBuffer, "test.txt", { removeBackground: false }),
    ).rejects.toThrow("Invalid image file format");
  });

  it("accepts valid PNG buffer and generates server ID with prod_ prefix", async () => {
    // 1x1 transparent PNG buffer
    const pngHex = "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527defc0000000049454e44ae426082";
    const pngBuffer = Buffer.from(pngHex, "hex");

    const media = await mediaUploadService.saveProductImage(pngBuffer, "sample_item.png", {
      removeBackground: false,
    });

    expect(media).toBeDefined();
    expect(media.id).toMatch(/^prod_/);
    expect(media.mimeType).toBe("image/png");
    expect(media.originalName).toBe("sample_item.png");

    const fetched = await mediaUploadService.getProductImage(media.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(media.id);

    const list = await mediaUploadService.listProductImages();
    expect(list.some((item) => item.id === media.id)).toBe(true);
  });
});
