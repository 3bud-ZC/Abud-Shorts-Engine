/**
 * CURATED FACT PACKS
 * -------------------
 * V2.4 Pass 5 content intelligence: the deterministic local planner has no
 * world knowledge and no LLM is configured in every deployment (Ollama/
 * Gemini are both optional), so a curiosity/explainer prompt about a topic
 * outside the hand-written business-vertical templates
 * (localProvider.ts's buildWebDesignScenes*, buildCafeScenes*, etc.) used to
 * fall to a generic, topic-blind ad template ("Looking for the absolute
 * best way to experience <mangled prompt>?") - Pass 4 benchmark 2 ("why
 * airplane windows are rounded") produced visually correct but
 * topic-neutral filler that never actually answered the question.
 *
 * This is a small, curated knowledge base of well-established, uncontested
 * facts, written once at build time (by a human/engineer, not invented at
 * render time) and served deterministically - the opposite of an LLM
 * hallucinating an explanation per request. It intentionally does not
 * attempt to cover "any topic": genuine open-domain factual generation
 * needs an LLM-backed Content AI provider (see contentProviderMesh.ts). A
 * prompt that matches no pack here is not guessed at; see
 * `resolveContentBrief` in localProvider.ts for the honest SAFE_GENERIC
 * fallback and its `contentConfidence: "low"` marker.
 *
 * No numeric claims are invented: every pack avoids specific percentages,
 * dates, or study citations that were not already common, uncontested
 * knowledge.
 */

export type FactPackScene = {
  narration: string;
  narrationAr?: string;
  onScreenText: string;
  onScreenTextAr?: string;
  searchTerms: string[];
};

export type FactPackEntry = {
  id: string;
  /** English matching phrases, scored by substring hits against the normalized prompt. */
  keywords: string[];
  /** Egyptian/MSA-friendly Arabic matching phrases. */
  keywordsAr?: string[];
  hook: FactPackScene;
  explanation: FactPackScene;
  closing: FactPackScene;
};

export const FACT_PACKS: FactPackEntry[] = [
  {
    id: "airplane_windows_rounded",
    keywords: [
      "airplane window", "airplane windows", "plane window", "plane windows",
      "aircraft window", "aircraft windows", "round instead of square", "rounded instead of square",
      "why are airplane windows round", "square windows on planes",
    ],
    keywordsAr: ["شبابيك الطيارة", "نوافذ الطائرة", "ليه شبابيك الطيارة مدورة"],
    hook: {
      narration: "Ever notice every airplane window is round, never square?",
      onScreenText: "Why Are Plane Windows Round?",
      searchTerms: ["airplane window view sky", "aircraft cabin window seat", "commercial jet flying clouds"],
    },
    explanation: {
      narration: "It comes down to physics, not style. A pressurized cabin constantly pushes outward on the fuselage, and sharp corners concentrate that stress into a single point where metal fatigues fastest. A rounded shape spreads the same stress evenly around the frame, so cracks have nowhere to start.",
      onScreenText: "Corners Concentrate Stress",
      searchTerms: ["airplane fuselage close up", "aircraft window frame detail", "airplane wing metal structure"],
    },
    closing: {
      narration: "That one change, after early jet cabins with square windows suffered fatal cracks, is why every airliner window has been curved ever since.",
      onScreenText: "Curved By Design",
      searchTerms: ["airplane interior cabin", "airplane window sunset clouds", "passenger looking out airplane window"],
    },
  },
  {
    id: "phone_battery_slow_after_80",
    keywords: [
      "phone battery", "battery charge slower", "battery charges slower", "80 percent", "charging slows down",
      "why does charging slow down", "fast charging then slow", "battery charging curve",
    ],
    keywordsAr: ["شحن الموبايل بيبطأ", "بطارية الموبايل"],
    hook: {
      narration: "Notice your phone flies up to eighty percent, then crawls the rest of the way?",
      onScreenText: "Why Does Charging Slow Down?",
      searchTerms: ["phone charging cable close up", "smartphone screen charging percentage", "phone plugged in charger"],
    },
    explanation: {
      narration: "Lithium-ion batteries charge in two phases. Early on, the charger pushes a steady, fast current straight into the battery. Past around eighty percent, it switches to a slow, careful trickle that tops off each cell without overheating it.",
      onScreenText: "Two Charging Phases",
      searchTerms: ["phone charger port macro", "battery icon phone screen", "person checking phone charging"],
    },
    closing: {
      narration: "That trade-off protects the battery's long-term health, which is also why many phones let you cap charging at eighty percent on purpose.",
      onScreenText: "It Protects Your Battery",
      searchTerms: ["smartphone on desk charging", "person using phone charging cable", "modern smartphone close up"],
    },
  },
  {
    id: "sky_is_blue",
    keywords: [
      "sky is blue", "sky blue color", "why is the sky blue", "why sky blue",
    ],
    keywordsAr: ["السماء زرقاء", "ليه السما زرقا"],
    hook: {
      narration: "Why is the sky blue and not, say, green or violet?",
      onScreenText: "Why Is The Sky Blue?",
      searchTerms: ["blue sky clouds wide shot", "sunlight through clouds", "clear blue sky landscape"],
    },
    explanation: {
      narration: "Sunlight looks white, but it's really every color mixed together. As it hits our atmosphere, tiny air molecules scatter shorter wavelengths of light, like blue, far more than longer ones like red.",
      onScreenText: "Air Scatters Blue Light Most",
      searchTerms: ["sunlight through atmosphere", "sky gradient blue horizon", "sun rays through sky"],
    },
    closing: {
      narration: "That scattered blue light reaches our eyes from every direction, which is why the whole sky looks blue instead of just the sun.",
      onScreenText: "Scattered Light, Every Direction",
      searchTerms: ["person looking up at sky", "blue sky sunny day", "sky view from below trees"],
    },
  },
  {
    id: "ice_floats",
    keywords: [
      "ice floats", "why does ice float", "ice float on water", "ice less dense than water",
    ],
    keywordsAr: ["الثلج بيطفو", "ليه الثلج يطفو فوق الميه"],
    hook: {
      narration: "Why does ice float instead of sinking, like almost every other solid does in its own liquid?",
      onScreenText: "Why Does Ice Float?",
      searchTerms: ["ice cubes floating water", "ice melting close up", "frozen lake surface"],
    },
    explanation: {
      narration: "When water freezes, its molecules lock into a hexagonal lattice that actually holds them farther apart than they are in liquid water. That open structure makes ice slightly less dense than the water around it.",
      onScreenText: "Ice Has More Space Between Molecules",
      searchTerms: ["ice crystal macro shot", "ice cube close up water", "frozen water texture"],
    },
    closing: {
      narration: "Because it's less dense, ice floats to the surface, and that thin floating layer is actually what insulates lakes and lets fish survive underneath through winter.",
      onScreenText: "It Insulates What's Below",
      searchTerms: ["frozen lake winter", "ice floating on lake", "winter nature landscape"],
    },
  },
  {
    id: "brain_freeze",
    keywords: [
      "brain freeze", "why do we get brain freeze", "ice cream headache", "cold headache",
    ],
    keywordsAr: ["صداع الايس كريم", "برين فريز"],
    hook: {
      narration: "Why does eating something cold too fast give you a sudden, sharp headache?",
      onScreenText: "What Causes Brain Freeze?",
      searchTerms: ["eating ice cream close up", "cold drink person face", "ice cream cone summer"],
    },
    explanation: {
      narration: "Cold touching the roof of your mouth rapidly cools the blood vessels there. Your body reacts by suddenly widening those vessels to warm the area back up, and that rapid change is picked up by a nerve that also senses pain in your face.",
      onScreenText: "A Nerve Signal Gets Confused",
      searchTerms: ["person drinking cold smoothie", "close up face eating cold food", "iced drink summer day"],
    },
    closing: {
      narration: "Your brain reads that signal as pain coming from your forehead instead of your mouth, which is why the ache feels like it's right behind your eyes.",
      onScreenText: "Your Brain Misreads The Signal",
      searchTerms: ["person holding forehead", "cold beverage close up", "person enjoying ice cream"],
    },
  },
  {
    id: "microwave_uneven_heating",
    keywords: [
      "microwave heat unevenly", "microwave uneven", "why does microwave heat unevenly", "microwave hot spots", "microwave cold spots",
    ],
    keywordsAr: ["الميكروويف بيسخن مش متساوي"],
    hook: {
      narration: "Ever pull food out of the microwave and find one bite scalding and the next still cold?",
      onScreenText: "Why Microwaves Heat Unevenly",
      searchTerms: ["microwave oven kitchen", "food inside microwave", "person opening microwave door"],
    },
    explanation: {
      narration: "A microwave fills its box with invisible waves that bounce off the metal walls. Where those waves overlap, they create fixed hot and cold spots inside the oven, not a smooth, even field of heat.",
      onScreenText: "Waves Create Fixed Hot Spots",
      searchTerms: ["microwave oven interior", "plate of food microwave", "kitchen appliance close up"],
    },
    closing: {
      narration: "That's exactly why microwaves spin your food on a turntable, moving it through both the hot and cold spots so it heats far more evenly.",
      onScreenText: "That's Why Plates Turn",
      searchTerms: ["microwave turntable food", "person cooking kitchen", "reheating food microwave"],
    },
  },
];

const NEGATION_WORDS = /\b(not|no|never|isn't|don't|doesn't|without|excluding|except)\b/i;

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/%/g, " percent")
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude English plural/gerund folding - good enough for this small lexicon, not a real stemmer. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter(Boolean).map(stem));
}

function splitSentences(text: string): string[] {
  return (text || "").split(/[.\n!?؟]+/).map((s) => s.trim()).filter(Boolean);
}

/** A keyword phrase matches when every one of its (stemmed) words appears somewhere in the prompt's token set - order-independent, tolerant of simple plurals. */
function phraseMatches(keyword: string, tokens: Set<string>): boolean {
  const words = normalizeText(keyword).split(" ").filter(Boolean).map(stem);
  return words.length > 0 && words.every((word) => tokens.has(word));
}

export type FactPackMatch = {
  pack: FactPackEntry;
  score: number;
};

/**
 * Scores every pack by how many of its keyword phrases match the prompt
 * (bag-of-words per phrase, order-independent, light plural folding - not
 * exact-string equality, so reasonable paraphrases of a covered topic still
 * match, e.g. "why do plane windows have rounded corners" still hits
 * `airplane_windows_rounded`, and "phone batteries charge much slower"
 * still hits `phone_battery_slow_after_80`) and returns the best match, or
 * null when nothing scored. This does not attempt fuzzy semantic matching
 * beyond that, matching this engine's existing deterministic-lexicon design
 * (see stockQueryFamilies.ts).
 *
 * A match is discarded when EVERY sentence that contributed to its score
 * also contains a negation word ("this video is NOT about why airplane
 * windows are round") - matching ctaPolicy.ts's sentence-scoped negation
 * check rather than a blunt whole-prompt heuristic.
 */
export function matchFactPack(prompt: string, isArabic: boolean): FactPackMatch | null {
  const sentences = splitSentences(prompt);
  let best: FactPackMatch | null = null;
  for (const pack of FACT_PACKS) {
    const keywords = isArabic ? pack.keywordsAr || [] : pack.keywords;
    let score = 0;
    let sawAffirmativeHit = false;
    for (const keyword of keywords) {
      for (const sentence of sentences) {
        if (phraseMatches(keyword, tokenize(sentence))) {
          score += 1;
          if (!NEGATION_WORDS.test(sentence)) sawAffirmativeHit = true;
        }
      }
    }
    if (score > 0 && sawAffirmativeHit && (!best || score > best.score)) {
      best = { pack, score };
    }
  }
  return best;
}
