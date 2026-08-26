import cuid from "cuid";
import {
  type ArabicDialect,
  type ProductionSceneSpec,
  type ProductionSpec,
  validateContentQuality,
  validateProductionSpec,
} from "../../../types/productionSpec";
import type {
  ContentAIProvider,
  GenerateSpecParams,
  PromptRewriteResult,
  ProviderValidationResult,
  SpecReviewResult,
} from "./types";

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function detectArabicDialect(text: string): ArabicDialect {
  const lower = text.toLowerCase();
  if (
    /عايز|عاوز|دلوقتي|كده|علشان|عشان|ازاي|جامد|مية في المية|اطلب|يلا|كافيه|شياكة|خامة|حاجة|قاهرة|مصر/.test(
      lower,
    )
  ) {
    return "egyptian";
  }
  if (/ابي|تبغى|الحين|وش|سعودي|الرياض|جدة|هلا|حي|ابشر/.test(lower)) {
    return "saudi";
  }
  if (/شلونك|وايد|الكويت|دبي|الامارات|قطر/.test(lower)) {
    return "gulf";
  }
  if (/بدي|شو|هيك|كتير|شام|بيروت|عمان|لبنان|اردن/.test(lower)) {
    return "levantine";
  }
  if (isArabic(text)) {
    return "egyptian"; // Default for Arabic market in this engine
  }
  return "none";
}

export function extractDurationFromPrompt(prompt: string): number | null {
  const matchSec = prompt.match(/(\d+)\s*[-_]?\s*(?:ثانية|ثواني|ثوان|ثوانى|seconds|second|secs|sec|s\b)/i);
  if (matchSec) {
    const val = parseInt(matchSec[1], 10);
    if (val >= 5 && val <= 120) return val;
  }
  return null;
}

export class LocalContentAIProvider implements ContentAIProvider {
  public readonly id = "local_ai";
  public readonly displayName = "Local AI Creative Director";
  public readonly category = "content_ai" as const;

  public async generateProductionSpec(
    params: GenerateSpecParams,
  ): Promise<ProductionSpec> {
    const prompt = params.prompt.trim();
    const isAr = params.language === "ar" || (params.language === "auto" && isArabic(prompt)) || isArabic(prompt);
    const dialect: ArabicDialect =
      params.dialect && params.dialect !== "none"
        ? params.dialect
        : isAr
          ? detectArabicDialect(prompt)
          : "none";

    // Duration Precedence:
    // 1. Explicit UI/API value (requestedDurationSeconds / durationSeconds / duration)
    // 2. Explicit prompt duration extracted from text
    // 3. Default fallback (30 seconds)
    const explicitDuration =
      params.requestedDurationSeconds ??
      params.durationSeconds ??
      params.duration;
    const extractedDuration = extractDurationFromPrompt(prompt);
    const durationSeconds = explicitDuration || extractedDuration || 30;
    const contentStyle = params.contentStyle || "advertisement";
    const aspectRatio = params.aspectRatio || "9:16";
    const resolution = params.resolution || "1080p";
    const quality = params.quality || "standard";
    const productionMode = params.productionMode || "auto_hybrid";
    const visualMode = params.visualMode || "auto";
    const voiceProvider = params.voiceProvider || "auto";
    const voiceId = params.voiceId || "";

    const scenes = this.buildCreativeScenes({
      prompt,
      isArabic: isAr,
      dialect,
      durationSeconds,
      contentStyle,
      brandName: params.brandName || params.brandKit?.brandName,
    });

    const ctaText = isAr
      ? dialect === "egyptian"
        ? "اطلب دلوقتي على واتساب واستفاد بالعرض"
        : "تواصل معنا عبر واتساب للمزيد"
      : "Message us on WhatsApp to get started today";

    const rawSpec: ProductionSpec = {
      id: cuid(),
      creationMode: "prompt",
      title: this.generateTitle(prompt, isAr, dialect),
      userPrompt: prompt,
      language: isAr ? "ar" : "en",
      dialect,
      tone: isAr ? "حماسي وجذاب" : "energetic and modern",
      contentStyle,
      durationSeconds,
      aspectRatio,
      resolution,
      quality,
      sceneCount: scenes.length,
      productionMode,
      visualMode,
      voiceProvider,
      voiceId,
      captionStyle: params.brandKit?.captionStyle || "bold",
      brandId: params.brandId,
      cta: {
        text: ctaText,
        action: "WhatsApp CTA",
        contact: "WhatsApp",
      },
      contact: "WhatsApp",
      scenes,
      brandKit: params.brandKit,
      metadata: {
        planner: "LocalContentAIProvider",
        plannerVersion: "2.2.0",
        scriptPipeline: isAr
          ? {
              stages: [
                "draft",
                "dialect_rewrite",
                "spoken_language_normalization",
                "duration_fit",
                "hook_check",
                "repetition_cleanup",
                "cta_check",
                "scene_segmentation",
              ],
              dialect,
              subjectiveQualityScore: null,
            }
          : undefined,
      },
    };

    const validated = validateProductionSpec(rawSpec);
    const qualityCheck = validateContentQuality(validated);
    return qualityCheck.correctedSpec || validated;
  }

  public async rewritePrompt(
    prompt: string,
    context?: { language?: string; dialect?: ArabicDialect; contentStyle?: string },
  ): Promise<PromptRewriteResult> {
    const trimmed = prompt.trim();
    const isAr = context?.language === "ar" || isArabic(trimmed);
    const dialect = context?.dialect || detectArabicDialect(trimmed);

    let enhanced = "";
    let summary = "";

    if (isAr) {
      if (trimmed.includes("كافيه") || trimmed.includes("قهوة") || trimmed.includes("cafe")) {
        enhanced =
          "اعمل فيديو إعلان 20 ثانية رأسي باللهجة المصرية لكافيه عصري في القاهرة يستهدف الشباب. افتح بـ Hook حسي عن ريحة القهوة والروقان، واعرض لقطات قريبة لتحضير الإسبريسو وقعدة الكافيه المميزة، واختم بـ CTA للزيارة وعرض خاص.";
        summary = "تمت إضافة تفاصيل المكان، الفئة المستهدفة، اللهجة المصرية، وبنية الـ Hook والعرض والـ CTA.";
      } else if (trimmed.includes("ملابس") || trimmed.includes("براند") || trimmed.includes("تيشرت")) {
        enhanced =
          "اعمل إعلان 30 ثانية رأسي باللهجة المصرية لبراند ملابس شبابي وستريت وير. البداية Hook قوي عن الراحة والشياكة في الصيف، واستعرض جودة الخامة القطنية والقصة، واختم بـ CTA للطلب عبر واتساب مع خصم لفترة محدودة.";
        summary = "تم تحسين التفاصيل البصرية وتركيز الـ Hook على خامة الملابس وتحديد دعوة واضحة للطلب على واتساب.";
      } else if (trimmed.includes("مطعم") || trimmed.includes("برجر") || trimmed.includes("اكل")) {
        enhanced =
          "اعمل فيديو إعلان 15 ثانية لمطعم برجر سريع وحماسي باللهجة المصرية. ركز على الجبنة السايحة واللحمة على الجريل، اذكر عرض الوجبة المزدوجة، واختم بـ CTA للطلب دليفري دلوقتي.";
        summary = "تمت إضافة وصف اللقطات السينمائية للأكل والعرض الحالي ورابط الدليفري.";
      } else {
        enhanced = `اعمل فيديو 30 ثانية رأسي باللهجة المصرية يركز على ${trimmed}. البداية Hook جذاب يشد الانتباه في أول 3 ثوانٍ، يتبعه شرح القيمة الأساسية مع لقطات ديناميكية، ثم إنهاء بـ CTA واضح للطلب والمتابعة.`;
        summary = "تم تحويل الفكرة المختصرة إلى سكريبت متكامل يحدد المدة واللهجة والـ Hook والـ CTA.";
      }
    } else {
      if (trimmed.toLowerCase().includes("backup") || trimmed.toLowerCase().includes("tech")) {
        enhanced =
          "Create a 30-second vertical English educational short explaining why automated backups protect small businesses from catastrophic data loss. Open with an urgent hook, show simple modern tech visuals, and end with an actionable CTA.";
        summary = "Added audience context, vertical framing, visual style guidelines, and clear CTA.";
      } else {
        enhanced = `Create a high-energy 30-second vertical video about ${trimmed}. Open with an engaging 3-second hook, deliver 2 clear value points with crisp visuals, and end with a direct call-to-action to message or subscribe.`;
        summary = "Expanded raw prompt with pacing, hook timing, visual guidance, and CTA structure.";
      }
    }

    return {
      originalPrompt: prompt,
      enhancedPrompt: enhanced,
      changesSummary: summary,
    };
  }

  public async reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult> {
    const quality = validateContentQuality(spec);
    const score = quality.valid ? Math.max(100 - quality.warnings.length * 10, 70) : 40;
    return {
      approved: quality.valid,
      score,
      warnings: quality.warnings,
      correctedSpec: quality.correctedSpec,
    };
  }

  public async validate(): Promise<ProviderValidationResult> {
    return {
      provider: "Local AI Creative Director",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Local deterministic Creative Director engine is operational.",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    };
  }

  private generateTitle(prompt: string, isAr: boolean, dialect: ArabicDialect): string {
    const words = prompt.split(/\s+/).slice(0, 5).join(" ");
    if (isAr) {
      return `إنتاج إعلان: ${words}`;
    }
    return `AI Production: ${words}`;
  }

  private buildCreativeScenes(context: {
    prompt: string;
    isArabic: boolean;
    dialect: ArabicDialect;
    durationSeconds: number;
    contentStyle: string;
    brandName?: string;
  }): ProductionSceneSpec[] {
    const { prompt, isArabic: isAr, dialect, durationSeconds, brandName } = context;
    const lower = prompt.toLowerCase();

    // Outro budget deduction
    const outroTime = Math.min(2.5, Math.max(1.5, Math.round(durationSeconds * 0.1 * 10) / 10));
    const contentBudget = Math.max(durationSeconds - outroTime, 6);

    // Scene count: 3 scenes for <=22s, 4 scenes for >22s
    const sceneCount = durationSeconds <= 22 ? 3 : 4;
    const durPerScene = Math.round((contentBudget / sceneCount) * 10) / 10;

    if (isAr) {
      if (lower.includes("موقع") || lower.includes("مواقع") || lower.includes("ويب") || lower.includes("web") || lower.includes("تصميم")) {
        return this.buildWebDesignScenesArabic(dialect, durPerScene, brandName, durationSeconds);
      }
      if (lower.includes("كافيه") || lower.includes("قهوة") || lower.includes("cafe")) {
        return this.buildCafeScenesArabic(dialect, durPerScene, brandName);
      }
      if (lower.includes("ملابس") || lower.includes("تيشرت") || lower.includes("ستريت") || lower.includes("clothing") || lower.includes("براند")) {
        return this.buildClothingScenesArabic(dialect, durPerScene, brandName, durationSeconds);
      }
      if (lower.includes("مطعم") || lower.includes("برجر") || lower.includes("اكل") || lower.includes("وجبة")) {
        return this.buildFoodScenesArabic(dialect, durPerScene, brandName);
      }
      if (lower.includes("عقار") || lower.includes("شقة") || lower.includes("فيلا") || lower.includes("كمبوند")) {
        return this.buildRealEstateScenesArabic(dialect, durPerScene, brandName);
      }
      return this.buildGenericArabicScenes(prompt, dialect, durPerScene, brandName);
    }

    // English scenes
    if (lower.includes("website") || lower.includes("web") || lower.includes("design") || lower.includes("landing page") || lower.includes("site")) {
      return this.buildWebDesignScenesEnglish(durPerScene, brandName, durationSeconds);
    }
    if (lower.includes("backup") || lower.includes("cloud") || lower.includes("software") || lower.includes("tech")) {
      return this.buildTechEducationalScenesEnglish(durPerScene, brandName);
    }
    return this.buildGenericEnglishScenes(prompt, durPerScene, brandName);
  }

  private buildWebDesignScenesEnglish(
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "our agency";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Are you losing valuable potential clients every day because your small business website looks outdated?",
          onScreenText: "Is Your Website Losing You Clients?",
          stockSearchTerms: ["laptop website browsing", "modern technology", "business work"],
          visualPrompt: "Close-up of a sleek modern laptop displaying responsive clean landing page",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `${bName} builds clean, lightning fast, mobile friendly websites that showcase your services and earn instant trust.`,
          onScreenText: "Fast · Responsive · Modern Design",
          stockSearchTerms: ["web developer coding", "responsive design screen", "creative agency"],
          visualPrompt: "Modern UI/UX designer working on website layout with creative screens",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Message our team on WhatsApp today to get started on your brand new high converting website.",
          onScreenText: "Message Us on WhatsApp Today",
          stockSearchTerms: ["mobile contact us", "happy client handshake", "technology"],
          visualPrompt: "Happy business owner tapping on smartphone with WhatsApp message ready",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "Are you losing valuable potential clients and revenue every single day because your business website looks outdated?",
        onScreenText: "Is Your Website Losing You Clients?",
        stockSearchTerms: ["frustrated business owner", "laptop computer search", "office work"],
        visualPrompt: "Business professional looking at search results on modern laptop",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "When customers search for your services, they expect a blazing fast, trustworthy modern site that works on mobile.",
        onScreenText: "Trust Begins With Your Website",
        stockSearchTerms: ["smartphone browsing website", "modern online store", "digital marketing"],
        visualPrompt: "User smoothly scrolling through modern vibrant website on smartphone",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} creates custom, lightning fast, responsive websites engineered to elevate your brand and drive real conversions.`,
        onScreenText: "Fast · Responsive · High Converting",
        stockSearchTerms: ["creative web design agency", "coding laptop screen", "technology team"],
        visualPrompt: "Showcase of multiple digital device mockups displaying high end responsive websites",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Message our design team on WhatsApp today to claim your limited discount and launch your new website.",
        onScreenText: "Message Us on WhatsApp Today",
        stockSearchTerms: ["whatsapp communication", "business handshake", "happy customer"],
        visualPrompt: "Customer service chat interaction on glowing smartphone screen with special offer badge",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildWebDesignScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "فريقنا";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "بتخسر عملاء كل يوم عشان معندكش موقع احترافي؟",
          onScreenText: "موقع احترافي لشركتك",
          stockSearchTerms: ["laptop website browsing", "modern technology", "business work"],
          visualPrompt: "Close-up of a sleek modern laptop displaying responsive clean landing page",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `${bName} بيصمملك موقع سريع ومتوافق مع الموبايل يعرض خدماتك بأعلى جودة.`,
          onScreenText: "تصميم سريع ومتوافق مع الموبايل",
          stockSearchTerms: ["web developer coding", "responsive design screen", "creative agency"],
          visualPrompt: "Modern UI/UX designer working on website layout with creative screens",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "تواصل معانا دلوقتي على واتساب وابدأ موقعك الجديد.",
          onScreenText: "تواصل معنا عبر واتساب",
          stockSearchTerms: ["mobile contact us", "happy client handshake", "technology"],
          visualPrompt: "Happy business owner tapping on smartphone with WhatsApp message ready",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتخسر عملاء ومبيعات كل يوم عشان معندكش موقع إلكتروني احترافي؟",
        onScreenText: "بتخسر عملاء بدون موقع؟",
        stockSearchTerms: ["frustrated business owner", "laptop computer search", "office work"],
        visualPrompt: "Business professional looking at search results on modern laptop",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "العميل أول ما بيدور على خدمتك بيحب يشوف موقع سريع وشيك يثق فيه.",
        onScreenText: "ثقة العميل تبدأ من موقعك",
        stockSearchTerms: ["smartphone browsing website", "modern online store", "digital marketing"],
        visualPrompt: "User smoothly scrolling through modern vibrant website on smartphone",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} بنصمملك موقع سريع، متوافق مع الموبايل، وبأعلى معايير الجودة والسرعة.`,
        onScreenText: "مواقع سريعة · متوافقة مع الموبايل",
        stockSearchTerms: ["creative web design agency", "coding laptop screen", "technology team"],
        visualPrompt: "Showcase of multiple digital device mockups displaying high end responsive websites",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معانا دلوقتي على واتساب واستفاد بعرض تصميم موقعك الإلكتروني الجديد.",
        onScreenText: "تواصل معنا الآن عبر واتساب",
        stockSearchTerms: ["whatsapp communication", "business handshake", "happy customer"],
        visualPrompt: "Customer service chat interaction on glowing smartphone screen with special offer badge",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildClothingScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "براندنا";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
          onScreenText: "تيشرت الصيف المثالي",
          stockSearchTerms: ["streetwear fashion", "young man tshirt", "urban clothing"],
          visualPrompt: "Cinematic close-up of high quality cotton streetwear t-shirt with modern aesthetic lighting",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `مع كولكشن ${bName} الجديد، قطن مية في المية وقصة أوفر سايز رايقة.`,
          onScreenText: "قطن 100% · قصة أوفر سايز",
          stockSearchTerms: ["stylish clothes model", "modern clothing", "lifestyle"],
          visualPrompt: "Hero product shot of stylish contemporary apparel",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "اطلب دلوقتي على واتساب واستفاد بخصم خاص وشحن سريع لباب بيتك.",
          onScreenText: "اطلب الآن عبر واتساب",
          stockSearchTerms: ["mobile shopping", "happy customer smartphone", "fashion store"],
          visualPrompt: "Modern smartphone checkout with glowing discount banner",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتدور على تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
        onScreenText: "تيشرت الصيف المثالي",
        stockSearchTerms: ["streetwear", "fashion model", "urban clothing"],
        visualPrompt: "Cinematic close-up of high quality cotton streetwear t-shirt with modern aesthetic lighting",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "معظم التيشرتات بتكش أو بتبهت بعد أول غسلة، والقصة مش دايمًا مظبوطة.",
        onScreenText: "مشاكل التيشرتات العادية",
        stockSearchTerms: ["young man fashion", "tshirt close up", "city street style"],
        visualPrompt: "Stylistic urban fashion shot in golden hour sunlight",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `مع كولكشن ${bName} الجديد، قطن مية في المية وقصة أوفر سايز رايقة تناسب كل ستايل.`,
        onScreenText: "قطن 100% · قصة أوفر سايز",
        stockSearchTerms: ["stylish clothes", "modern youth clothing", "lifestyle"],
        visualPrompt: "Hero product shot of stylish contemporary apparel",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "اطلب دلوقتي على واتساب واستفاد بخصم خاص وشحن سريع لباب بيتك.",
        onScreenText: "اطلب الآن عبر واتساب",
        stockSearchTerms: ["mobile shopping", "happy customer smartphone", "fashion store"],
        visualPrompt: "Modern smartphone checkout with glowing discount banner",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildCafeScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "الكافيه";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "محتاج تفصل شوية وتبدأ يومك بفنجان قهوة يعدل المزاج؟",
        onScreenText: "فنجان قهوة يعدل المزاج",
        stockSearchTerms: ["coffee espresso", "barista pouring coffee", "cafe aesthetic"],
        visualPrompt: "Slow motion pour of rich espresso with golden crema in a stylish modern cafe",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `في ${bName} بنحضر كل كوباية بحب من أجود أنواع البن المحمص طازة.`,
        onScreenText: "بن محمص طازة يومياً",
        stockSearchTerms: ["coffee beans roasting", "barista crafting latte", "cafe interior"],
        visualPrompt: "Warm cinematic cafe environment with aromatic roasted coffee beans",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "زورنا النهاردة واستمتع بأحلى قعدة وأجمد عروض الفطار والقهوة.",
        onScreenText: "زورنا اليوم واستمتع بالعرض",
        stockSearchTerms: ["friends laughing in cafe", "coffee cup table", "happy customer"],
        visualPrompt: "Cozy vibrant cafe seating area with smiling guests",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildFoodScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "المطعم";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "جعان ونفسك في ساندوتش برجر حقيقي يملى العين والبطن؟",
        onScreenText: "برجر حقيقي على أصوله",
        stockSearchTerms: ["sizzling burger grill", "burger cheese melting", "fast food"],
        visualPrompt: "Extreme close up of sizzling smash burger patty with melting cheddar cheese",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} بيقدملك لحمة بلدي مية في المية وصوصات سرية معمولة عشانك.`,
        onScreenText: "لحمة بلدي 100% وصوصات سرية",
        stockSearchTerms: ["gourmet burger preparation", "french fries crispy", "food restaurant"],
        visualPrompt: "Delicious burger assembly with fresh brioche bun and crispy golden fries",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "اطلب دلوقتي دليفري والعرض التوفيري هيوصلك سخن لحد عندك.",
        onScreenText: "اطلب دليفري الآن",
        stockSearchTerms: ["food delivery driver", "delicious burger meal", "eating burger"],
        visualPrompt: "Steaming hot food delivery package and happy eating moment",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildRealEstateScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتفكر في سكن راقي أو استثمار عقاري مضمون بعائد عالي؟",
        onScreenText: "سكن راقي واستثمار مضمون",
        stockSearchTerms: ["modern luxury apartment", "architecture building", "modern interior"],
        visualPrompt: "Architectural drone shot of modern luxury residential compound",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: "وحدات مميزة بمساحات متنوعة وأنظمة سداد مرنة بدون فوائد وبأقل مقدم.",
        onScreenText: "مساحات متنوعة · أنظمة سداد مرنة",
        stockSearchTerms: ["luxury living room interior", "balcony view luxury", "apartment"],
        visualPrompt: "Spacious sunlit living room with panoramic view",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معنا اليوم لحجز معاينة مجانية واغتنام الفرصة.",
        onScreenText: "تواصل معنا الآن للمعانية",
        stockSearchTerms: ["real estate handshake", "luxury home keys", "customer meeting"],
        visualPrompt: "Client receiving keys to luxury home with warm handshake",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildGenericArabicScenes(
    prompt: string,
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const cleanPrompt = prompt.replace(/[^\w\s\u0600-\u06FF]/gi, "").slice(0, 40);
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: `هل تبحث عن أفضل طريقة للوصول إلى ${cleanPrompt} بكل سهولة وسرعة؟`,
        onScreenText: cleanPrompt,
        stockSearchTerms: ["modern technology", "business meeting", "lifestyle"],
        visualPrompt: "Dynamic modern visual scene representing progress and success",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: "نقدم لك حلولاً مصممة خصيصاً لتمنحك أعلى جودة وأفضل تجربة.",
        onScreenText: "أعلى جودة وأفضل تجربة",
        stockSearchTerms: ["quality service", "happy customer", "innovation"],
        visualPrompt: "Focused modern professional delivering high quality results",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معنا الآن عبر واتساب لمعرفة كافة التفاصيل والاستفادة من العرض.",
        onScreenText: "تواصل معنا الآن",
        stockSearchTerms: ["contact us", "smartphone communication", "customer service"],
        visualPrompt: "Customer reaching out via mobile chat with friendly support",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildTechEducationalScenesEnglish(
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "Did you know that 60% of small businesses lose critical data due to simple hardware failure?",
        onScreenText: "60% of Businesses Lose Data",
        stockSearchTerms: ["server room blinking", "cyber security tech", "business computer"],
        visualPrompt: "Dramatic illuminated server rack with blinking security lights",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "Without automated off-site backups, one accidental deletion or ransomware attack can halt operations.",
        onScreenText: "The Real Cost of Downtime",
        stockSearchTerms: ["stressed worker computer", "cyber attack graphic", "technology failure"],
        visualPrompt: "Stressed professional staring at frozen screen with error warning",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: "Implementing encrypted daily backups ensures your files are restored in minutes, zero stress.",
        onScreenText: "Automated Encrypted Backups",
        stockSearchTerms: ["cloud computing data", "secure backup progress", "cyber security"],
        visualPrompt: "Sleek holographic backup synchronization with green checkmarks",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Follow for more essential tech tips and secure your business infrastructure today.",
        onScreenText: "Follow For Daily Tech Tips",
        stockSearchTerms: ["technology team success", "smiling engineer", "software development"],
        visualPrompt: "Confident IT professional giving thumbs up with clean modern office background",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildGenericEnglishScenes(
    prompt: string,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const cleanPrompt = prompt.replace(/[^\w\s]/gi, "").slice(0, 30);
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: `Looking for the absolute best way to experience ${cleanPrompt}?`,
        onScreenText: cleanPrompt,
        stockSearchTerms: ["cinematic hero shot", "modern lifestyle", "trending product"],
        visualPrompt: "High energy cinematic shot introducing the core subject",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: "Built with premium quality and tailored to deliver exactly what you need.",
        onScreenText: "Premium Quality & Speed",
        stockSearchTerms: ["quality craftsmanship", "customer satisfaction", "modern technology"],
        visualPrompt: "Close up detail showcasing quality and reliability",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Get in touch today to grab this limited offer before it's gone.",
        onScreenText: "Message Us Today",
        stockSearchTerms: ["call to action mobile", "happy customer smartphone", "shopping"],
        visualPrompt: "Smartphone screen with friendly message prompt and glowing CTA",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }
}
