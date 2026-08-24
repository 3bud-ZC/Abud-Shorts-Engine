/**
 * CLIENT INTEGRATION CATALOG
 * --------------------------
 * Describes each integration in the customer's language: what it is for, what
 * it costs, and how it is connected.
 *
 * Every entry here corresponds to a provider the engine really implements. No
 * integration is invented, and infrastructure the customer never configures
 * (n8n, PostgreSQL, the render worker) is deliberately absent - it is not shown
 * on this page at all.
 */

export type ClientCategory =
  | "AI & Script"
  | "Voice"
  | "Visuals & Stock"
  | "Publishing"
  | "Optional & Advanced";

export const CLIENT_CATEGORY_ORDER: ClientCategory[] = [
  "AI & Script",
  "Voice",
  "Visuals & Stock",
  "Publishing",
  "Optional & Advanced",
];

export type ConnectionType = "key" | "oauth" | "builtin";

export type IntegrationEntry = {
  label: string;
  shortName: string;
  category: ClientCategory;
  purpose: string;
  costLabel: string;
  connectionType: ConnectionType;
  credentialType?: string;
  keyHelp?: string;
  optional?: boolean;
};

export const INTEGRATION_CATALOG: Record<string, IntegrationEntry> = {
  // ------------------------------------------------------------ AI & Script
  local_ai: {
    label: "Built-in Creative Director",
    shortName: "Built-in AI",
    category: "AI & Script",
    purpose: "Writes the script and scene plan on your own machine.",
    costLabel: "Free · Local",
    connectionType: "builtin",
  },
  gemini: {
    label: "Google Gemini",
    shortName: "Gemini",
    category: "AI & Script",
    purpose: "Optional cloud writer for more varied scripts.",
    costLabel: "Usage Based",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Create an API key in Google AI Studio, then paste it here.",
    optional: true,
  },
  ollama: {
    label: "Local LLM (Ollama)",
    shortName: "Ollama",
    category: "Optional & Advanced",
    purpose: "Run a local language model instead of the built-in writer.",
    costLabel: "Free · Local",
    connectionType: "builtin",
    optional: true,
  },

  // ------------------------------------------------------------------ Voice
  elevenlabs: {
    label: "ElevenLabs",
    shortName: "ElevenLabs",
    category: "Voice",
    purpose: "Required for Arabic narration. Also used for premium English voices.",
    costLabel: "Usage Based",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Copy your API key from the ElevenLabs profile page and paste it here.",
  },
  kokoro: {
    label: "Built-in English Voice",
    shortName: "Kokoro",
    category: "Voice",
    purpose: "Free English narration that runs on your own machine.",
    costLabel: "Free · Local",
    connectionType: "builtin",
  },
  google_cloud_tts: {
    label: "Google Cloud Text-to-Speech",
    shortName: "Google TTS",
    category: "Optional & Advanced",
    purpose: "Alternative cloud voice provider.",
    costLabel: "Cloud",
    connectionType: "key",
    credentialType: "service_account_json",
    keyHelp: "Paste the contents of your Google service account JSON file.",
    optional: true,
  },
  edge_tts: {
    label: "Edge TTS",
    shortName: "Edge TTS",
    category: "Optional & Advanced",
    purpose: "Experimental online voice option, disabled by default.",
    costLabel: "Free · Online",
    connectionType: "builtin",
    optional: true,
  },
  piper: {
    label: "Piper (Legacy)",
    shortName: "Piper",
    category: "Optional & Advanced",
    purpose: "Kept so older videos stay readable. Not used for new productions.",
    costLabel: "Free · Local",
    connectionType: "builtin",
    optional: true,
  },

  // -------------------------------------------------------- Visuals & Stock
  pexels: {
    label: "Pexels",
    shortName: "Pexels",
    category: "Visuals & Stock",
    purpose: "Free stock footage library used for most B-roll.",
    costLabel: "Free",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Create a free Pexels API key at pexels.com/api and paste it here.",
  },
  pixabay: {
    label: "Pixabay",
    shortName: "Pixabay",
    category: "Visuals & Stock",
    purpose: "Optional second free library. More footage to choose between.",
    costLabel: "Free",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Create a free Pixabay API key at pixabay.com/api/docs and paste it here.",
    optional: true,
  },
  veo: {
    label: "Google Veo",
    shortName: "Veo",
    category: "Optional & Advanced",
    purpose: "Paid AI video generation. Not required for normal productions.",
    costLabel: "Usage Based",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Paste your Google Veo API key.",
    optional: true,
  },
  fal: {
    label: "fal.ai",
    shortName: "fal.ai",
    category: "Optional & Advanced",
    purpose: "Paid AI video generation (Kling, Wan, Seedance).",
    costLabel: "Usage Based",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Paste your fal.ai API key.",
    optional: true,
  },

  // ------------------------------------------------------------- Publishing
  youtube: {
    label: "YouTube",
    shortName: "YouTube",
    category: "Publishing",
    purpose: "Publish finished videos straight to your channel.",
    costLabel: "Free",
    connectionType: "oauth",
    optional: true,
  },
  meta: {
    label: "Instagram & Facebook",
    shortName: "Meta",
    category: "Publishing",
    purpose: "Publish to your Instagram and Facebook pages.",
    costLabel: "Free",
    connectionType: "oauth",
    optional: true,
  },
  tiktok: {
    label: "TikTok",
    shortName: "TikTok",
    category: "Publishing",
    purpose: "Publish to your TikTok account.",
    costLabel: "Free",
    connectionType: "oauth",
    optional: true,
  },
  telegram: {
    label: "Telegram",
    shortName: "Telegram",
    category: "Publishing",
    purpose: "Send finished videos to a Telegram channel or chat.",
    costLabel: "Free",
    connectionType: "key",
    credentialType: "bot_token",
    keyHelp: "Create a bot with @BotFather and paste the bot token here.",
    optional: true,
  },
  upload_post: {
    label: "Upload-Post",
    shortName: "Upload-Post",
    category: "Publishing",
    purpose: "Publish to several platforms through one service.",
    costLabel: "Cloud",
    connectionType: "key",
    credentialType: "api_key",
    keyHelp: "Paste your Upload-Post API key.",
    optional: true,
  },
};

/** Returns the customer-facing category, or null for anything not shown. */
export function clientCategoryFor(providerId: string): ClientCategory | null {
  return INTEGRATION_CATALOG[providerId]?.category ?? null;
}

/** Providers a customer can configure without touching a terminal. */
export function customerConfigurableProviders(): string[] {
  return Object.entries(INTEGRATION_CATALOG)
    .filter(([, entry]) => entry.connectionType !== "builtin")
    .map(([id]) => id);
}
