import { describe, expect, it } from "vitest";

import {
  extractExplicitCtaFromPrompt,
  hasExplicitContact,
  hasExplicitOffer,
  hasExplicitWhatsApp,
  inventsUngroundedClaim,
  resolveCtaProvenance,
} from "../server/v2/creative/ctaPolicy";
import { LocalContentAIProvider } from "../server/v2/content-ai/localProvider";

/**
 * V2.4 PASS 4 - CTA TRUTH & PROVENANCE
 * -------------------------------------
 * Real customer incident cmtehsptj000108ledzk3f3ji: the customer's prompt
 * explicitly asked for the CTA "Make your business look professional." and
 * explicitly prohibited inventing a WhatsApp number ("do not invent prices,
 * discounts, phone numbers, WhatsApp numbers, testimonials, or statistics").
 * The final rendered video showed "Message Us on WhatsApp Today" instead,
 * with `ctaProvenance: "USER_EXPLICIT"` - because the old detector was a bare
 * `/whatsapp/i.test(prompt)`, which matches inside the prohibition clause
 * itself.
 */

const INCIDENT_PROMPT = `Create a 25-second vertical TikTok/Reel about how a small business can instantly look more professional online.

Style:
modern, cinematic, fast-paced, premium social media ad.

Use real footage throughout:
small business owners using laptops,
professional website screens,
mobile responsive websites,
client meetings,
web designers working,
analytics dashboards,
business owners reacting positively.

Editing:
use 8–12 visually different shots,
fast clean cuts,
subtle professional transitions,
cinematic reframing,
smooth pacing,
light motion graphics only as overlays,
not as full-screen scenes.

Text:
use short clean captions,
do not show my prompt,
do not show instructions,
do not invent prices, discounts, phone numbers, WhatsApp numbers, testimonials, or statistics.

Voice:
natural confident English voice.

Music:
modern energetic background music,
keep voice clearly audible.

Structure:
strong hook in the first 2 seconds,
problem,
transformation,
professional result,
simple final CTA.

CTA:
"Make your business look professional."

Format:
9:16
1080p
25 seconds

Visual mode:
Auto Professional

Budget:
Free Only

Prioritize real Pexels and Pixabay video footage.
Avoid repeated clips, irrelevant footage, black backgrounds, static text cards, and generic placeholder visuals.`;

describe("V2.4 Pass 4: WhatsApp mentioned only inside a prohibition is never authorized", () => {
  it("does not treat 'do not invent ... WhatsApp numbers' as an explicit WhatsApp request", () => {
    expect(hasExplicitWhatsApp(INCIDENT_PROMPT)).toBe(false);
  });

  it("does not treat the same prohibition sentence as an explicit generic contact request", () => {
    expect(hasExplicitContact(INCIDENT_PROMPT)).toBe(false);
  });

  it("still recognizes a real, affirmative WhatsApp request", () => {
    expect(hasExplicitWhatsApp("Message us on WhatsApp to order now")).toBe(true);
    expect(hasExplicitWhatsApp("تواصل معنا عبر واتساب")).toBe(true);
  });

  it("does not treat a prohibited discount mention as an authorized offer", () => {
    expect(hasExplicitOffer("do not invent any discounts or special offers")).toBe(false);
    expect(hasExplicitOffer("mention our 20% launch discount this week")).toBe(true);
  });
});

describe("V2.4 Pass 4: explicit prompt CTA extraction", () => {
  it("extracts the quoted CTA line from a 'CTA:' section", () => {
    expect(extractExplicitCtaFromPrompt(INCIDENT_PROMPT)).toBe("Make your business look professional.");
  });

  it("extracts an inline CTA on the same line as the heading", () => {
    expect(extractExplicitCtaFromPrompt("CTA: Book your free demo today")).toBe("Book your free demo today");
  });

  it("returns null when there is no CTA section", () => {
    expect(extractExplicitCtaFromPrompt("Create a video about coffee.")).toBeNull();
  });
});

describe("V2.4 Pass 4: canonical CTA provenance resolution", () => {
  it("prefers the customer's explicit CTA text and does not invent a contact channel", () => {
    const resolved = resolveCtaProvenance({ prompt: INCIDENT_PROMPT, isArabic: false, dialect: "none" });
    expect(resolved.text).toBe("Make your business look professional.");
    expect(resolved.provenance).toBe("USER_EXPLICIT");
    expect(resolved.contact).toBeUndefined();
  });

  it("falls back to a channel-free CTA when nothing was authorized", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Create a 20 second video about our new bakery.",
      isArabic: false,
      dialect: "none",
    });
    expect(resolved.provenance).toBe("SAFE_INFERRED");
    expect(resolved.contact).toBeUndefined();
    expect(resolved.text.toLowerCase()).not.toContain("whatsapp");
  });

  it("uses a verified brand contact when one is on file and the prompt is silent", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Create a 20 second video about our new bakery.",
      isArabic: false,
      dialect: "none",
      brandContactText: "@ourbakery",
    });
    expect(resolved.provenance).toBe("BRAND_PROFILE");
    expect(resolved.contact).toBe("@ourbakery");
  });

  it("marks a genuine WhatsApp ask as USER_EXPLICIT", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Create a video and ask people to message us on WhatsApp.",
      isArabic: false,
      dialect: "none",
    });
    expect(resolved.provenance).toBe("USER_EXPLICIT");
    expect(resolved.contact).toBe("WhatsApp");
  });
});

describe("V2.4 Pass 4: canned CTA scenes never invent claims the prompt forbade", () => {
  it("flags the web-design template's canned WhatsApp CTA as ungrounded against the incident prompt", () => {
    expect(
      inventsUngroundedClaim("Message our team on WhatsApp today to get started on your brand new high converting website.", INCIDENT_PROMPT),
    ).toBe(true);
  });
});

describe("V2.4 Pass 4: LocalContentAIProvider end to end on the real incident prompt", () => {
  it("never mentions WhatsApp anywhere in the generated spec and uses the customer's literal CTA", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: INCIDENT_PROMPT,
      language: "en",
      productionMode: "auto_hybrid",
      visualMode: "auto",
      voiceProvider: "kokoro",
      requestedDurationSeconds: 20,
    });

    // Everything the engine actually generated (not the customer's own prompt
    // text, which legitimately contains the word "WhatsApp" inside its own
    // prohibition clause) must be free of the invented channel.
    const generatedSurface = JSON.stringify({
      cta: spec.cta,
      contact: spec.contact,
      scenes: spec.scenes,
    }).toLowerCase();
    expect(generatedSurface).not.toContain("whatsapp");
    expect(generatedSurface).not.toContain("واتساب");

    expect(spec.cta?.text).toBe("Make your business look professional.");
    expect(spec.cta?.contact).toBeUndefined();
    expect(spec.contact).toBeUndefined();
    expect((spec.metadata as any)?.promptCompiler?.ctaProvenance).toBe("USER_EXPLICIT");

    const ctaScene = spec.scenes.find((scene) => scene.purpose === "cta");
    expect(ctaScene).toBeDefined();
    expect(ctaScene!.narration.toLowerCase()).not.toContain("whatsapp");
    expect(ctaScene!.onScreenText?.toLowerCase()).not.toContain("whatsapp");
  });

  it("never splices raw prompt text into narration for a topic outside the known business verticals (benchmark 2 regression)", async () => {
    // Real Pass 4 benchmark run: this exact prompt produced narration
    // "Looking for the absolute best way to experience Create a 25second
    // vertical cur?" - the generic fallback spliced a truncated,
    // punctuation-stripped copy of the raw prompt into the hook line.
    const prompt =
      "Create a 25-second vertical curiosity video explaining why airplane windows are rounded instead of square. Use highly relevant real footage, fast clean editing, natural narration, clean captions and no full-screen text cards.";
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt,
      language: "en",
      productionMode: "auto_hybrid",
      visualMode: "auto",
      voiceProvider: "kokoro",
      requestedDurationSeconds: 25,
    });

    for (const scene of spec.scenes) {
      const narrationLower = scene.narration.toLowerCase();
      expect(narrationLower).not.toContain("25second");
      expect(narrationLower).not.toContain("vertical cur");
      expect(narrationLower).not.toContain("create a");
    }
  });
});
