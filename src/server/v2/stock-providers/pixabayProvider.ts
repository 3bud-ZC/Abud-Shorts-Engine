import axios from "axios";
import { logger } from "../../../logger";
import { providerSecrets } from "../provider-vault/providerSecrets";
import {
  PIXABAY_CACHE_TTL_MS,
  type StockAttribution,
  type StockCandidate,
  type StockProvider,
  type StockSearchRequest,
} from "./types";

/**
 * PIXABAY - OPTIONAL SECOND FREE STOCK SOURCE
 * -------------------------------------------
 * Optional by design: the engine reports ready without it, and the router
 * simply has one fewer source to consider.
 *
 * Two Pixabay API conditions are honoured explicitly:
 *  - results are cached for 24 hours rather than re-queried per render
 *  - selected assets are downloaded into ABUD storage rather than hotlinked
 *    permanently from Pixabay's CDN
 */

type PixabayVideoStream = { url?: string; width?: number; height?: number; size?: number };

type PixabayVideoHit = {
  id?: number;
  pageURL?: string;
  duration?: number;
  tags?: string;
  user?: string;
  user_id?: number;
  videos?: Record<string, PixabayVideoStream>;
};

type PixabayImageHit = {
  id?: number;
  pageURL?: string;
  tags?: string;
  user?: string;
  user_id?: number;
  largeImageURL?: string;
  webformatURL?: string;
  previewURL?: string;
  imageWidth?: number;
  imageHeight?: number;
};

type CacheEntry = { at: number; candidates: StockCandidate[] };

/** Prefers the largest stream that still fits a sane download size. */
function pickVideoStream(hit: PixabayVideoHit): PixabayVideoStream | null {
  const streams = hit.videos || {};
  const preference = ["large", "medium", "small", "tiny"];
  for (const key of preference) {
    const stream = streams[key];
    if (stream?.url && stream.width && stream.height) return stream;
  }
  return null;
}

export class PixabayProvider implements StockProvider {
  public readonly id = "pixabay" as const;
  public readonly displayName = "Pixabay";
  public readonly license = "Pixabay Content License";

  private cache = new Map<string, CacheEntry>();

  constructor(private apiKey?: string) {}

  public setApiKey(key: string): void {
    this.apiKey = key;
  }

  public getApiKey(): string | undefined {
    return this.apiKey || process.env.PIXABAY_API_KEY || providerSecrets.peek("pixabay", "api_key");
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 8 && !key.includes("your_"));
  }

  private cacheKey(request: StockSearchRequest): string {
    return [
      request.kind,
      request.query.toLowerCase().trim(),
      request.orientation,
      request.minDurationSeconds ?? "",
      request.perPage ?? "",
    ].join("|");
  }

  public async search(request: StockSearchRequest): Promise<StockCandidate[]> {
    if (!this.isConfigured()) return [];
    const key = this.cacheKey(request);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < PIXABAY_CACHE_TTL_MS) {
      return this.applyExclusions(cached.candidates, request);
    }

    const endpoint =
      request.kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
    const params: Record<string, string | number> = {
      key: this.getApiKey() as string,
      q: request.query,
      per_page: Math.min(200, Math.max(3, request.perPage ?? 30)),
      safesearch: "true",
    };
    if (request.orientation === "portrait") params.orientation = "vertical";
    if (request.orientation === "landscape") params.orientation = "horizontal";
    if (request.kind === "video") {
      // film + animation are both useful for advertising B-roll.
      params.video_type = "all";
    } else {
      params.image_type = "photo";
    }

    let data: any;
    try {
      const response = await axios.get(endpoint, { params, timeout: 15000 });
      data = response.data;
    } catch (error: any) {
      logger.warn(
        { provider: "pixabay", status: error?.response?.status, query: request.query },
        "Pixabay search failed; continuing without this source",
      );
      return [];
    }

    const hits: any[] = Array.isArray(data?.hits) ? data.hits : [];
    const candidates: StockCandidate[] = [];

    for (const hit of hits) {
      if (request.kind === "video") {
        const video = hit as PixabayVideoHit;
        const stream = pickVideoStream(video);
        if (!stream?.url || !video.id) continue;
        const width = stream.width || 0;
        const height = stream.height || 0;
        if (request.minWidth && width < request.minWidth) continue;
        if (request.minHeight && height < request.minHeight) continue;
        if (request.minDurationSeconds && (video.duration || 0) < request.minDurationSeconds) continue;
        candidates.push({
          provider: "pixabay",
          id: String(video.id),
          kind: "video",
          downloadUrl: stream.url,
          width,
          height,
          durationSeconds: video.duration,
          contributor: video.user,
          contributorUrl: video.user_id ? `https://pixabay.com/users/-${video.user_id}/` : undefined,
          sourcePageUrl: video.pageURL,
          tags: (video.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
        });
      } else {
        const image = hit as PixabayImageHit;
        const url = image.largeImageURL || image.webformatURL;
        if (!url || !image.id) continue;
        candidates.push({
          provider: "pixabay",
          id: String(image.id),
          kind: "image",
          downloadUrl: url,
          previewImageUrl: image.previewURL,
          width: image.imageWidth || 0,
          height: image.imageHeight || 0,
          contributor: image.user,
          contributorUrl: image.user_id ? `https://pixabay.com/users/-${image.user_id}/` : undefined,
          sourcePageUrl: image.pageURL,
          tags: (image.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
        });
      }
    }

    this.cache.set(key, { at: Date.now(), candidates });
    return this.applyExclusions(candidates, request);
  }

  private applyExclusions(candidates: StockCandidate[], request: StockSearchRequest): StockCandidate[] {
    const excluded = new Set(request.excludeIds || []);
    return candidates.filter((candidate) => !excluded.has(candidate.id));
  }

  public attributionFor(candidate: StockCandidate): StockAttribution {
    return {
      provider: "pixabay",
      assetId: candidate.id,
      contributor: candidate.contributor,
      contributorUrl: candidate.contributorUrl,
      sourcePageUrl: candidate.sourcePageUrl,
      credit: candidate.contributor
        ? `${candidate.contributor} via Pixabay`
        : "Pixabay",
      license: this.license,
    };
  }
}
