/**
 * MULTI-SOURCE STOCK LAYER
 * ------------------------
 * A single provider produced the visually repetitive V2.2 output. The router
 * now asks every configured source for candidates and scores them together, so
 * "best available clip" is decided across providers rather than inside one.
 */

export type StockProviderId = "pexels" | "pixabay";

export type StockOrientation = "portrait" | "landscape" | "square";

export type StockMediaKind = "video" | "image";

export type StockSearchRequest = {
  /** English search phrase. Providers are queried in English regardless of narration language. */
  query: string;
  orientation: StockOrientation;
  kind: StockMediaKind;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  perPage?: number;
  /** Provider-scoped ids already used in this production. */
  excludeIds?: string[];
};

export type StockCandidate = {
  provider: StockProviderId;
  /** Provider-scoped asset id. Globally unique when paired with `provider`. */
  id: string;
  kind: StockMediaKind;
  downloadUrl: string;
  previewImageUrl?: string;
  width: number;
  height: number;
  durationSeconds?: number;
  /** Contributor / uploader, kept for attribution and de-duplication. */
  contributor?: string;
  contributorUrl?: string;
  /** Provider page for the asset, required by several attribution policies. */
  sourcePageUrl?: string;
  tags?: string[];
  /** Set by the router, not the provider. */
  qualityScore?: number;
  semanticScore?: number;
};

export type StockAttribution = {
  provider: StockProviderId;
  assetId: string;
  contributor?: string;
  contributorUrl?: string;
  sourcePageUrl?: string;
  /** Human-readable line suitable for credits. */
  credit: string;
  license: string;
};

export interface StockProvider {
  readonly id: StockProviderId;
  readonly displayName: string;
  readonly license: string;
  isConfigured(): boolean;
  search(request: StockSearchRequest): Promise<StockCandidate[]>;
  attributionFor(candidate: StockCandidate): StockAttribution;
}

/** Pixabay requires cached results to be refreshed no more often than 24h. */
export const PIXABAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PEXELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
