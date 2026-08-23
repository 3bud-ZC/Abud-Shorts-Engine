import { logger } from "../../../logger";
import type { CredentialType } from "./providerCredentialsVault";

export type ProviderSecretResolver = (
  providerId: string,
  credentialType: CredentialType,
) => Promise<string | null>;

type CacheEntry = {
  value: string | null;
  fetchedAt: number;
};

const CACHE_TTL_MS = 60_000;

/**
 * Process-wide bridge between the encrypted ProviderCredentialsVault and the
 * synchronous provider classes (VoiceRegistry.route() must stay synchronous).
 *
 * The resolver is registered once per process when a database is reachable.
 * Values are cached in memory only, are never logged, and are never returned
 * through any HTTP response.
 */
class ProviderSecrets {
  private resolver?: ProviderSecretResolver;
  private cache = new Map<string, CacheEntry>();

  private cacheKey(providerId: string, credentialType: CredentialType): string {
    return `${providerId}:${credentialType}`;
  }

  public registerResolver(resolver: ProviderSecretResolver): void {
    this.resolver = resolver;
    this.cache.clear();
  }

  public hasResolver(): boolean {
    return Boolean(this.resolver);
  }

  public invalidate(providerId?: string): void {
    if (!providerId) {
      this.cache.clear();
      return;
    }
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${providerId}:`)) this.cache.delete(key);
    }
  }

  /** Synchronous read of the last successfully resolved value. */
  public peek(providerId: string, credentialType: CredentialType): string | undefined {
    return this.cache.get(this.cacheKey(providerId, credentialType))?.value || undefined;
  }

  public async refresh(
    providerId: string,
    credentialType: CredentialType,
  ): Promise<string | undefined> {
    if (!this.resolver) return undefined;
    const key = this.cacheKey(providerId, credentialType);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.value || undefined;
    }
    try {
      const value = await this.resolver(providerId, credentialType);
      this.cache.set(key, { value: value || null, fetchedAt: Date.now() });
      return value || undefined;
    } catch (error) {
      // Never log the credential itself, only that resolution failed.
      logger.warn({ providerId, credentialType }, "Provider credential resolution failed");
      return cached?.value || undefined;
    }
  }

  public peekElevenLabsApiKey(): string | undefined {
    return this.peek("elevenlabs", "api_key");
  }

  public async refreshElevenLabsApiKey(): Promise<string | undefined> {
    return this.refresh("elevenlabs", "api_key");
  }
}

export const providerSecrets = new ProviderSecrets();
