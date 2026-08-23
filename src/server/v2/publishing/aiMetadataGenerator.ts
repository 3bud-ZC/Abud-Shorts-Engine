import type { ProductionSpec } from "../../../types/productionSpec";
import type { PlatformMetadata, PublishingPlatform } from "./types";

export type GenerateMetadataParams = {
  platform: PublishingPlatform;
  prompt?: string;
  title?: string;
  narrationLines?: string[];
  brandName?: string;
  ctaText?: string;
  language?: string;
  spec?: ProductionSpec;
};

export class AIMetadataGenerator {
  public generateMetadata(params: GenerateMetadataParams): PlatformMetadata {
    const isArabic =
      params.language === "ar" ||
      (params.prompt && /[\u0600-\u06FF]/.test(params.prompt)) ||
      (params.narrationLines && params.narrationLines.some((l) => /[\u0600-\u06FF]/.test(l)));

    const rawTitle =
      params.title ||
      params.spec?.title ||
      (params.prompt ? params.prompt.slice(0, 60).trim() : "Viral Video");

    const brand = params.brandName || params.spec?.brandKit?.brandName || "ABUD";
    const cta = params.ctaText || params.spec?.brandKit?.contactText || "Link in bio / WhatsApp";
    const hook = params.narrationLines?.[0] || rawTitle;

    switch (params.platform) {
      case "youtube":
        return this.generateYouTubeMetadata(rawTitle, hook, brand, cta, isArabic, params.narrationLines);
      case "tiktok":
        return this.generateTikTokMetadata(rawTitle, hook, brand, cta, isArabic);
      case "instagram":
        return this.generateInstagramMetadata(rawTitle, hook, brand, cta, isArabic, params.narrationLines);
      case "facebook":
        return this.generateFacebookMetadata(rawTitle, hook, brand, cta, isArabic);
      case "telegram":
        return this.generateTelegramMetadata(rawTitle, hook, brand, cta, isArabic, params.narrationLines);
      case "linkedin":
        return this.generateLinkedInMetadata(rawTitle, hook, brand, cta, isArabic);
      case "twitter":
        return this.generateTwitterMetadata(rawTitle, hook, brand, cta, isArabic);
      case "threads":
      default:
        return this.generateDefaultMetadata(rawTitle, hook, brand, cta, isArabic);
    }
  }

  private generateYouTubeMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
    narration?: string[],
  ): PlatformMetadata {
    const cleanTitle = isArabic
      ? `${title.slice(0, 75)} 🔥 #Shorts`
      : `${title.slice(0, 75)} | ${brand} #Shorts`;

    const descLines = [
      hook,
      "",
      isArabic
        ? `🔥 فيديو جديد ومميز من ${brand}!`
        : `🔥 Exclusive video production by ${brand}!`,
      "",
      narration && narration.length > 0 ? "📌 " + narration.join("\n📌 ") : "",
      "",
      isArabic ? `📲 للطلب والاستفسار: ${cta}` : `📲 Contact & Orders: ${cta}`,
      "",
      "#Shorts #Trending #Viral #" + brand.replace(/\s+/g, ""),
    ].filter(Boolean);

    const tags = [
      "Shorts",
      "Viral",
      "Trending",
      brand,
      isArabic ? "مصر" : "Content",
      isArabic ? "اعلانات" : "Marketing",
      isArabic ? "فيديو_قصير" : "Video",
    ];

    return {
      title: cleanTitle.slice(0, 100),
      description: descLines.join("\n"),
      tags,
      hashtags: ["Shorts", "Viral", brand.replace(/\s+/g, "")],
      privacy: "unlisted",
    };
  }

  private generateTikTokMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
  ): PlatformMetadata {
    const caption = isArabic
      ? `${hook} 👀 استمتعوا بأقوى العروض مع ${brand}! للطلب ${cta}`
      : `${hook} 👀 Check this out with ${brand}! ${cta}`;

    const hashtags = [
      "fyp",
      "foryou",
      "viral",
      "shorts",
      brand.replace(/\s+/g, "").toLowerCase(),
      isArabic ? "ترند_مصر" : "trending",
    ];

    return {
      title: title.slice(0, 150),
      caption: `${caption}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`,
      hashtags,
      privacy: "public",
    };
  }

  private generateInstagramMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
    narration?: string[],
  ): PlatformMetadata {
    const body = isArabic
      ? `✨ ${hook}\n\nجاهز لتجربة مختلفة؟ مع ${brand} بنقدملك الأفضل دايماً!\n\n👇 اطلب دلوقتي أو ابعتلنا على:\n📲 ${cta}`
      : `✨ ${hook}\n\nReady for something next-level? ${brand} delivers premium quality every time.\n\n👇 Order now or reach out:\n📲 ${cta}`;

    const hashtags = [
      "reels",
      "explore",
      "trendingreels",
      "viral",
      "instareels",
      brand.replace(/\s+/g, "").toLowerCase(),
      isArabic ? "مصر" : "creator",
      isArabic ? "اكسبلور" : "reelsvideo",
      isArabic ? "تسوق" : "lifestyle",
    ];

    return {
      title: title.slice(0, 120),
      caption: `${body}\n.\n.\n.\n${hashtags.map((h) => `#${h}`).join(" ")}`,
      hashtags,
      reelSettings: {
        shareToFeed: true,
      },
      privacy: "public",
    };
  }

  private generateFacebookMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
  ): PlatformMetadata {
    const description = isArabic
      ? `📢 ${hook}\n\nعروض وتفاصيل جديدة ومميزة من ${brand}!\n\nللتواصل والحجز الفوري:\n📞 ${cta}\n\n#${brand.replace(/\s+/g, "")} #Reels #اعلانات`
      : `📢 ${hook}\n\nSpecial highlights from ${brand}!\n\nGet in touch today:\n📞 ${cta}\n\n#${brand.replace(/\s+/g, "")} #Reels #Viral`;

    return {
      title: title.slice(0, 150),
      description,
      caption: description,
      hashtags: [brand.replace(/\s+/g, ""), "Reels", "Viral"],
      privacy: "public",
    };
  }

  private generateTelegramMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
    narration?: string[],
  ): PlatformMetadata {
    const boldTitle = `🎬 <b>${title}</b>`;
    const body = isArabic
      ? `<i>${hook}</i>\n\n📌 <b>أبرز التفاصيل من ${brand}:</b>\n` +
        (narration && narration.length > 0 ? narration.map((n) => `• ${n}`).join("\n") : "") +
        `\n\n📲 <b>للتواصل والطلب:</b> ${cta}`
      : `<i>${hook}</i>\n\n📌 <b>Highlights from ${brand}:</b>\n` +
        (narration && narration.length > 0 ? narration.map((n) => `• ${n}`).join("\n") : "") +
        `\n\n📲 <b>Contact & Orders:</b> ${cta}`;

    return {
      title: title.slice(0, 120),
      caption: `${boldTitle}\n\n${body}`,
      hashtags: [brand.replace(/\s+/g, ""), "Shorts", "Telegram"],
      privacy: "public",
    };
  }

  private generateLinkedInMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
  ): PlatformMetadata {
    const post = isArabic
      ? `💡 ${hook}\n\nفي عالم صناعة المحتوى السريع، ${brand} تقدم رؤية مبتكرة تواكب التطور.\n\nتواصل معنا: ${cta}\n\n#Business #Innovation #Marketing`
      : `💡 ${hook}\n\nIn modern fast-paced media, ${brand} brings creative digital innovation.\n\nLearn more: ${cta}\n\n#Business #Innovation #DigitalMarketing`;

    return {
      title: title.slice(0, 140),
      caption: post,
      description: post,
      hashtags: ["Business", "Innovation", "Marketing"],
      privacy: "public",
    };
  }

  private generateTwitterMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
  ): PlatformMetadata {
    const tweet = isArabic
      ? `${hook.slice(0, 140)} 🔥\n\nمع ${brand}: ${cta}\n#Shorts #${brand.replace(/\s+/g, "")}`
      : `${hook.slice(0, 140)} 🔥\n\nWith ${brand}: ${cta}\n#Shorts #${brand.replace(/\s+/g, "")}`;

    return {
      title: title.slice(0, 100),
      caption: tweet.slice(0, 280),
      hashtags: ["Shorts", brand.replace(/\s+/g, "")],
      privacy: "public",
    };
  }

  private generateDefaultMetadata(
    title: string,
    hook: string,
    brand: string,
    cta: string,
    isArabic?: boolean,
  ): PlatformMetadata {
    return {
      title: title.slice(0, 100),
      caption: `${hook}\n\n${brand} · ${cta}`,
      hashtags: ["Shorts", "Viral"],
      privacy: "public",
    };
  }
}

export const aiMetadataGenerator = new AIMetadataGenerator();
