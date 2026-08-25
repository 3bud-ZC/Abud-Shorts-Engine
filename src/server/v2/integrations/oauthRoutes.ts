import axios from "axios";
import express from "express";
import { logger } from "../../../logger";
import type { Config } from "../../../config";
import type { V2Database } from "../db";
import type { ProviderCredentialsVault } from "../provider-vault/providerCredentialsVault";
import { MetaDirectProvider } from "../publishing/providers/metaDirectProvider";
import { TikTokDirectProvider } from "../publishing/providers/tiktokDirectProvider";
import { YouTubeDirectProvider } from "../publishing/providers/youtubeDirectProvider";
import {
  OAUTH_CONTRACTS,
  buildAuthorizeUrl,
  buildTokenExchangeBody,
  missingScopes,
  parseTokenResponse,
} from "./oauthProviders";
import {
  OAuthStateService,
  callbackUrlFor,
  isAllowedRedirectUri,
  isOAuthProvider,
  safeReturnPath,
  type OAuthProviderId,
} from "./oauthService";
import { SocialAccountService } from "./socialAccountService";

/**
 * OAUTH ROUTES
 * ------------
 * The browser-only path from "I have a Google account" to "my channel is
 * connected". No terminal, no .env, no pasted tokens.
 *
 * Three endpoints per provider:
 *   GET  /providers/:provider/oauth/config    what to enter, and where
 *   PUT  /providers/:provider/oauth/app       save Client ID + Secret
 *   GET  /providers/:provider/oauth/start     begin authorization
 *   GET  /providers/:provider/oauth/callback  finish it
 *
 * The callback is the security-sensitive one. It redeems a single-use state,
 * exchanges the code server-side, stores the tokens encrypted, and redirects the
 * browser back into the app. The authorization code never reaches client
 * JavaScript, and no token is ever written to a URL, a log line or localStorage.
 */

export function createOAuthRouter(
  config: Config,
  db: V2Database,
  vault: ProviderCredentialsVault,
): express.Router {
  const router = express.Router();
  const states = new OAuthStateService(db);
  const accounts = new SocialAccountService(db, vault, config.providerVaultMasterKey);

  /** The address this installation serves, used for every callback URL. */
  const publicBaseUrl = (): string =>
    (process.env.V2_PUBLIC_URL || `http://localhost:${config.port}`).replace(/\/+$/, "");

  function provider(req: express.Request): OAuthProviderId | null {
    const value = String(req.params.provider || "").toLowerCase();
    return isOAuthProvider(value) ? value : null;
  }

  /**
   * What the customer needs in order to create the app on the provider's side,
   * including the exact callback URL to paste into the provider console.
   */
  router.get("/providers/:provider/oauth/config", async (req, res) => {
    const id = provider(req);
    if (!id) {
      res.status(400).json({ error: "This provider does not use OAuth." });
      return;
    }
    const contract = OAUTH_CONTRACTS[id];
    const app = await accounts.readAppConfig(id).catch(() => null);
    const stored = await vault.listForProvider(id).catch(() => []);
    const appConfig = stored.find((entry) => entry.credentialType === "app_config");

    res.status(200).json({
      provider: id,
      displayName: contract.displayName,
      consoleUrl: contract.consoleUrl,
      // The single value the customer must paste into the provider console.
      callbackUrl: callbackUrlFor(publicBaseUrl(), id),
      fields: contract.appFields,
      scopes: contract.scopes.map((scope) => ({
        scope,
        reason: contract.scopeRationale[scope] || "",
      })),
      configured: Boolean(app),
      maskedHint: appConfig?.maskedHint,
      configuredAt: appConfig?.configuredAt,
    });
  });

  /**
   * Saves the application credentials.
   *
   * Both values go into the encrypted vault as one record. The secret is never
   * returned afterwards - the response carries only a masked hint, so a customer
   * who forgets it replaces it rather than reading it back.
   */
  router.put("/providers/:provider/oauth/app", async (req, res) => {
    const id = provider(req);
    if (!id) {
      res.status(400).json({ error: "This provider does not use OAuth." });
      return;
    }
    if (!vault.isAvailable()) {
      res.status(503).json({
        error: "Secure storage is not available.",
        message: "The provider vault must be configured before credentials can be saved.",
      });
      return;
    }

    const clientId = String(req.body?.clientId || "").trim();
    const clientSecret = String(req.body?.clientSecret || "").trim();
    if (!clientId || !clientSecret) {
      res.status(400).json({ error: "Both the client identifier and the secret are required." });
      return;
    }

    try {
      const credential = await vault.put({
        providerId: id,
        credentialType: "app_config",
        plaintext: JSON.stringify({ clientId, clientSecret }),
        metadata: { clientIdHint: `${clientId.slice(0, 6)}…` },
      });
      res.status(200).json({
        credential,
        callbackUrl: callbackUrlFor(publicBaseUrl(), id),
      });
    } catch (error) {
      res.status(400).json({
        error: "Could not save these credentials.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Starts authorization.
   *
   * Returns the URL rather than redirecting, so the client can open it in a
   * popup and keep the dashboard state. The state and PKCE verifier are created
   * and stored here; nothing about them is guessable from the client.
   */
  router.get("/providers/:provider/oauth/start", async (req, res) => {
    const id = provider(req);
    if (!id) {
      res.status(400).json({ error: "This provider does not use OAuth." });
      return;
    }

    const app = await accounts.readAppConfig(id);
    if (!app) {
      res.status(409).json({
        error: "This provider is not configured yet.",
        message: `Add the ${OAUTH_CONTRACTS[id].displayName} application credentials before connecting an account.`,
        needsConfiguration: true,
      });
      return;
    }

    const redirectUri = callbackUrlFor(publicBaseUrl(), id);
    const contract = OAUTH_CONTRACTS[id];

    try {
      const state = await states.create({
        providerId: id,
        redirectUri,
        returnPath: safeReturnPath(req.query.returnTo),
      });

      res.status(200).json({
        provider: id,
        authUrl: buildAuthorizeUrl({
          contract,
          clientId: app.clientId,
          redirectUri,
          state: state.state,
          codeChallenge: contract.usesPkce ? state.codeChallenge : undefined,
        }),
        expiresAt: state.expiresAt,
        scopes: contract.scopes,
      });
    } catch (error) {
      res.status(500).json({
        error: "Could not start the connection.",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Finishes authorization.
   *
   * Always answers with a redirect back into the app rather than JSON: this URL
   * is opened by the provider in the customer's browser, and a raw JSON body
   * would be a dead end. The outcome travels as a short status word - never the
   * code, never a token.
   */
  router.get("/providers/:provider/oauth/callback", async (req, res) => {
    const id = provider(req);
    const back = (status: string, detail?: string, path = "/integrations") => {
      const target = new URL(path, publicBaseUrl());
      target.searchParams.set("connection", status);
      if (id) target.searchParams.set("provider", id);
      if (detail) target.searchParams.set("reason", detail.slice(0, 120));
      res.redirect(302, target.toString());
    };

    if (!id) return back("error", "unknown_provider");

    // The customer pressed Cancel on the provider's consent screen.
    if (req.query.error) {
      return back("cancelled", String(req.query.error_description || req.query.error));
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const stateValue = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !stateValue) return back("error", "missing_code");

    // Single-use redemption. Unknown, expired and already-used states are all
    // reported identically so the difference cannot be probed from outside.
    const consumed = await states.consume(stateValue);
    if (!consumed || consumed.providerId !== id) {
      logger.warn({ provider: id }, "OAuth callback rejected: state was invalid, expired or already used");
      return back("error", "invalid_state");
    }

    if (!isAllowedRedirectUri(consumed.redirectUri, publicBaseUrl(), id)) {
      logger.warn({ provider: id }, "OAuth callback rejected: redirect URI is not this installation");
      return back("error", "invalid_redirect");
    }

    const app = await accounts.readAppConfig(id);
    if (!app) return back("error", "app_not_configured", consumed.returnPath);

    const contract = OAUTH_CONTRACTS[id];
    try {
      const body = buildTokenExchangeBody({
        contract,
        app,
        code,
        redirectUri: consumed.redirectUri,
        codeVerifier: contract.usesPkce ? consumed.codeVerifier : undefined,
      });

      const tokenResponse = await axios.post(contract.tokenUrl, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20000,
        validateStatus: () => true,
      });

      if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
        // The provider's body can contain the code; only the status is logged.
        logger.warn({ provider: id, status: tokenResponse.status }, "OAuth token exchange rejected");
        return back("error", "token_exchange_failed", consumed.returnPath);
      }

      const tokens = parseTokenResponse(contract, tokenResponse.data || {}, contract.scopes);
      if (!tokens) return back("error", "no_access_token", consumed.returnPath);

      const stored = await storeConnection(id, tokens, accounts);
      if (!stored.ok) return back("error", stored.reason, consumed.returnPath);

      return back("connected", undefined, consumed.returnPath);
    } catch (error) {
      logger.warn({ provider: id, err: String(error) }, "OAuth callback failed");
      return back("error", "exchange_error", consumed.returnPath);
    }
  });

  /**
   * Meta needs a second step: the authorization yields a user token, and the
   * customer then picks which Page (and therefore which Instagram professional
   * account) to publish to.
   */
  router.get("/providers/meta/destinations", async (_req, res) => {
    const rows = await accounts.listAccounts();
    const pending = rows.find((row) => row.platform === "meta_pending");
    if (!pending) {
      res.status(404).json({ error: "No Meta authorization is waiting for a destination." });
      return;
    }
    const credentials = await accounts.getUsableCredentials(pending.id);
    if (!credentials.ok) {
      res.status(409).json({ error: credentials.error.userMessage });
      return;
    }
    const meta = new MetaDirectProvider();
    const discovered = await meta.discoverAccounts(String(credentials.credentials.accessToken));
    if (!discovered.ok) {
      res.status(502).json({ error: discovered.error.userMessage });
      return;
    }
    res.status(200).json({
      // Page access tokens are deliberately absent from this payload.
      pages: discovered.pages.map((page) => ({
        pageId: page.pageId,
        name: page.name,
        instagramUsername: page.instagramUsername,
        canPublishInstagram: Boolean(page.instagramUserId),
      })),
    });
  });

  /** Commits the customer's choice of Meta destination as real accounts. */
  router.post("/providers/meta/destinations", async (req, res) => {
    const pageId = String(req.body?.pageId || "").trim();
    if (!pageId) {
      res.status(400).json({ error: "Choose a Page to publish to." });
      return;
    }
    const rows = await accounts.listAccounts();
    const pending = rows.find((row) => row.platform === "meta_pending");
    if (!pending) {
      res.status(404).json({ error: "No Meta authorization is waiting for a destination." });
      return;
    }
    const credentials = await accounts.getUsableCredentials(pending.id);
    if (!credentials.ok) {
      res.status(409).json({ error: credentials.error.userMessage });
      return;
    }

    const meta = new MetaDirectProvider();
    const userToken = String(credentials.credentials.accessToken);
    const discovered = await meta.discoverAccounts(userToken);
    if (!discovered.ok) {
      res.status(502).json({ error: discovered.error.userMessage });
      return;
    }
    const page = discovered.pages.find((entry) => entry.pageId === pageId);
    if (!page) {
      res.status(404).json({ error: "That Page is no longer available to this connection." });
      return;
    }

    const granted = await meta.grantedPermissions(userToken);
    const created: string[] = [];

    // Facebook Reels publish with the Page token, not the user token.
    const facebook = await accounts.upsertAccount({
      platform: "facebook",
      provider: "meta_direct",
      oauthProvider: "meta",
      accountId: page.pageId,
      accountName: page.name,
      tokens: { accessToken: page.pageAccessToken, scopes: granted },
      capabilities: { pageId: page.pageId },
      extraCredentials: { pageAccessToken: page.pageAccessToken, userAccessToken: userToken },
    });
    created.push(facebook.id);

    if (page.instagramUserId) {
      const instagram = await accounts.upsertAccount({
        platform: "instagram",
        provider: "meta_direct",
        oauthProvider: "meta",
        accountId: page.instagramUserId,
        accountName: page.instagramUsername ? `@${page.instagramUsername}` : page.name,
        tokens: { accessToken: page.pageAccessToken, scopes: granted },
        capabilities: { instagramUserId: page.instagramUserId, pageId: page.pageId },
        extraCredentials: { pageAccessToken: page.pageAccessToken, userAccessToken: userToken },
      });
      created.push(instagram.id);
    }

    // The holding record has served its purpose.
    await accounts.disconnect(pending.id);

    res.status(200).json({
      connected: created.length,
      instagramAvailable: Boolean(page.instagramUserId),
      // Said plainly rather than as a failure: a Page with no professional
      // account is a valid Facebook-only connection.
      message: page.instagramUserId
        ? `Connected ${page.name} and its Instagram professional account.`
        : `Connected ${page.name}. No Instagram professional account is linked to this Page, so Instagram publishing stays unavailable.`,
    });
  });

  return router;
}

/**
 * Turns a fresh token set into connected accounts.
 *
 * YouTube and TikTok identify exactly one account, so the connection completes
 * here. Meta can expose many Pages, so it parks a holding record and the
 * customer picks a destination in a second step.
 */
async function storeConnection(
  providerId: OAuthProviderId,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date; scopes: string[] },
  accounts: SocialAccountService,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (providerId === "youtube") {
    const youtube = new YouTubeDirectProvider();
    const validation = await youtube.validateConnection({ accessToken: tokens.accessToken });
    if (!validation.healthy || !validation.accountDetails?.accountId) {
      return { ok: false, reason: "no_channel" };
    }
    const required = OAUTH_CONTRACTS.youtube.scopes;
    await accounts.upsertAccount({
      platform: "youtube",
      provider: "youtube_direct",
      oauthProvider: "youtube",
      accountId: validation.accountDetails.accountId,
      accountName: validation.accountDetails.channelTitle || validation.accountDetails.accountName || "YouTube channel",
      avatarUrl: validation.accountDetails.avatarUrl,
      tokens,
      capabilities: { missingScopes: missingScopes(tokens.scopes, required) },
    });
    return { ok: true };
  }

  if (providerId === "tiktok") {
    const tiktok = new TikTokDirectProvider();
    const info = await tiktok.getCreatorInfo(tokens.accessToken);
    if (!info.ok) return { ok: false, reason: "creator_info_failed" };
    await accounts.upsertAccount({
      platform: "tiktok",
      provider: "tiktok_direct",
      oauthProvider: "tiktok",
      // open_id is the stable TikTok account identifier.
      accountId: String((tokens as { meta?: { openId?: string } }).meta?.openId || info.info.nickname || "tiktok"),
      accountName: info.info.nickname || "TikTok account",
      avatarUrl: info.info.avatarUrl,
      tokens,
      capabilities: {
        // Real, per-creator values. The publish screen renders these rather than
        // a hardcoded list of privacy options.
        privacyLevelOptions: info.info.privacyLevelOptions,
        commentDisabled: info.info.commentDisabled,
        duetDisabled: info.info.duetDisabled,
        stitchDisabled: info.info.stitchDisabled,
        maxVideoPostDurationSeconds: info.info.maxVideoPostDurationSeconds,
        missingScopes: missingScopes(tokens.scopes, OAUTH_CONTRACTS.tiktok.scopes),
      },
    });
    return { ok: true };
  }

  // Meta: park the user token until a destination is chosen.
  await accounts.upsertAccount({
    platform: "meta_pending",
    provider: "meta_direct",
    oauthProvider: "meta",
    accountId: "pending",
    accountName: "Meta authorization",
    tokens,
    capabilities: {},
  });
  return { ok: true };
}
