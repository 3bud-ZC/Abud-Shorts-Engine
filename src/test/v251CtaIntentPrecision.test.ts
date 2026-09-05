import { describe, expect, it } from "vitest";

import {
  hasExplicitContact,
  hasExplicitWhatsApp,
  resolveCtaProvenance,
} from "../server/v2/creative/ctaPolicy";
import { LocalContentAIProvider } from "../server/v2/content-ai/localProvider";

/**
 * V2.4 PASS 5.1 - CTA PRECISION
 * -----------------------------
 * Real benchmark job cmtezn158000507p8h39i4ptc ("Why do phone batteries
 * charge much slower after about 80%?") produced CTA "Contact us to learn
 * more" for a purely factual curiosity video, because the old contact
 * detector was a bare substring match (`/phone/i`) that fired on the noun
 * "phone" inside "phone batteries" with no verb, no imperative, no request
 * for contact at all. This suite pins the fix: contact/WhatsApp detection
 * now requires genuine INTENT (a verb or CTA-slot anchor), not keyword
 * presence, and curiosity-style content gets a channel-free default closer
 * instead of business CTA language.
 */

describe("V2.4 Pass 5.1: contact-channel detection requires intent, not keyword presence", () => {
  it("does not treat 'phone batteries' as contact intent (the exact reported bug)", () => {
    expect(hasExplicitContact("Why do phone batteries charge much slower after about 80%?")).toBe(false);
    expect(hasExplicitWhatsApp("Why do phone batteries charge much slower after about 80%?")).toBe(false);
  });

  it("does not treat other bare topical mentions as contact intent", () => {
    expect(hasExplicitContact("This video explains phone screen technology.")).toBe(false);
    expect(hasExplicitContact("A short history of the telephone.")).toBe(false);
    expect(hasExplicitContact("Why smartphones get hot while charging.")).toBe(false);
    expect(hasExplicitContact("A quick guide to email security best practices.")).toBe(false);
    expect(hasExplicitContact("How website design has changed over 20 years.")).toBe(false);
    expect(hasExplicitWhatsApp("How WhatsApp encryption actually works.")).toBe(false);
  });

  it("still recognizes genuine contact-intent phrasing", () => {
    expect(hasExplicitContact("Call us to book your appointment.")).toBe(true);
    expect(hasExplicitContact("Call me if you have questions.")).toBe(true);
    expect(hasExplicitContact("Phone us anytime this week.")).toBe(true);
    expect(hasExplicitContact("Contact us by phone for a free quote.")).toBe(true);
    expect(hasExplicitContact("Message us to get started.")).toBe(true);
    expect(hasExplicitContact("Send us a DM to order now.")).toBe(true);
  });

  it("still recognizes genuine WhatsApp-intent phrasing", () => {
    expect(hasExplicitWhatsApp("WhatsApp us to place your order.")).toBe(true);
    expect(hasExplicitWhatsApp("Message us on WhatsApp for pricing.")).toBe(true);
    expect(hasExplicitWhatsApp("تواصل معنا عبر واتساب")).toBe(true);
  });

  it("recognizes WhatsApp explicitly anchored to the CTA/closing slot even without an 'us' verb", () => {
    // Real Pass 4 regression prompt: "...والختام واتساب" ("...and the closing: WhatsApp").
    expect(hasExplicitWhatsApp("اعمل اعلان 20 ثانية لبراند ملابس شبابي، البداية Hook قوي والختام واتساب")).toBe(true);
    expect(hasExplicitWhatsApp("Keep it short. Closing: WhatsApp.")).toBe(true);
  });

  it("still ignores WhatsApp mentioned only inside a prohibition clause", () => {
    expect(hasExplicitWhatsApp("do not invent prices, discounts, phone numbers, WhatsApp numbers, testimonials, or statistics.")).toBe(false);
    expect(hasExplicitContact("do not invent prices, discounts, phone numbers, WhatsApp numbers, testimonials, or statistics.")).toBe(false);
  });
});

describe("V2.4 Pass 5.1: content-style-aware CTA closer", () => {
  it("gives curiosity content a channel-free closer, never invented business CTA language", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Why do phone batteries charge much slower after about 80%?",
      isArabic: false,
      dialect: "none",
      isCuriosityStyle: true,
    });
    expect(resolved.text).toBe("Now you know why.");
    expect(resolved.provenance).toBe("SAFE_INFERRED");
    expect(resolved.contact).toBeUndefined();
  });

  it("leaves non-curiosity content on the existing generic fallback", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Create a video for our shop.",
      isArabic: false,
      dialect: "none",
      isCuriosityStyle: false,
    });
    expect(resolved.text).not.toBe("Now you know why.");
  });

  it("still prioritizes an explicit customer CTA over the curiosity default", () => {
    const resolved = resolveCtaProvenance({
      prompt: "Why do phone batteries charge slower after 80%?\nCTA: Follow for more science facts.",
      isArabic: false,
      dialect: "none",
      isCuriosityStyle: true,
    });
    expect(resolved.text).toBe("Follow for more science facts.");
    expect(resolved.provenance).toBe("USER_EXPLICIT");
  });
});

describe("V2.4 Pass 5.1: LocalContentAIProvider end-to-end battery prompt no longer invents a CTA channel", () => {
  it("does not produce a contact/WhatsApp CTA for the real battery benchmark prompt", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why do phone batteries charge much slower after about 80%? Make it a 20-second explainer with real footage.",
      language: "en",
      requestedDurationSeconds: 20,
    });

    expect(spec.cta?.contact).toBeUndefined();
    const ctaSceneNarration = spec.scenes[spec.scenes.length - 1]?.narration?.toLowerCase() || "";
    expect(ctaSceneNarration).not.toContain("contact us");
    expect(ctaSceneNarration).not.toContain("whatsapp");
  });
});
