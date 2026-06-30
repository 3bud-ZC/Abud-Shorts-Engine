import { describe, expect, test, vi, afterEach } from "vitest";

import {
  TemplateNarrationError,
  applyBusinessTemplateToScenes,
} from "./templateEnrichment";
import { getBusinessTemplateById } from "./business-templates";
import * as templateSceneFactory from "./templateSceneFactory";

describe("applyBusinessTemplateToScenes", () => {
  const productTemplate = getBusinessTemplateById("product_ad");
  const restaurantTemplate = getBusinessTemplateById("restaurant_offer");
  const realEstateTemplate = getBusinessTemplateById("real_estate_listing");
  const educationalTemplate = getBusinessTemplateById("educational_tip");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("generates concise narration with template data and ignores example prompt", () => {
    const result = applyBusinessTemplateToScenes(
      [
        {
          text: productTemplate.examplePrompt,
          searchTerms: [],
        },
      ],
      productTemplate,
      {
        productName: "Basic Cotton T-Shirt",
        mainBenefit: "breathable fabric",
        priceOrOffer: "limited offer",
        targetCustomer: "young adults",
        contactMethod: "WhatsApp",
      },
    );

    expect(result).toHaveLength(4);
    const narrationTexts = result.map((scene) => scene.text);
    expect(narrationTexts[0]).toContain("Need a clean everyday T-shirt");
    expect(narrationTexts[1]).toContain("Basic Cotton T-Shirt");
    expect(narrationTexts[2]).toContain("breathable fabric");
    expect(narrationTexts[3]).toContain("WhatsApp");
    expect(narrationTexts[3].toLowerCase()).toContain("message us");
    narrationTexts.forEach((text) => {
      expect(text).not.toEqual(productTemplate.examplePrompt);
      expect(text).not.toContain("HOOK");
      expect(text.length).toBeLessThan(221);
    });
    productTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
    expect(result[0].fallbackSearchTerms).toEqual(
      expect.arrayContaining(productTemplate.fallbackPexelsSearchHints),
    );
  });

  test("merges template hints with comma-separated template data keywords", () => {
    const result = applyBusinessTemplateToScenes([], productTemplate, {
      priceOrOffer: "خصم كبير، cairo downtown",
    });

    expect(result[0].searchTerms).toContain("cairo downtown");
    productTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
  });

  test("deduplicates fallback search terms", () => {
    const result = applyBusinessTemplateToScenes(
      [
        {
          text: "Custom text",
          searchTerms: ["clothing", "fashion"],
        },
      ],
      productTemplate,
    );

    const fallback = result[0].fallbackSearchTerms ?? [];
    expect(fallback).toEqual(
      expect.arrayContaining(productTemplate.fallbackPexelsSearchHints),
    );
    productTemplate.fallbackPexelsSearchHints.forEach((hint) => {
      expect(fallback.filter((term) => term === hint)).toHaveLength(1);
    });
  });

  test("throws TemplateNarrationError if generator emits instructional example text", () => {
    vi.spyOn(templateSceneFactory, "generateScenesForTemplate").mockReturnValue([
      {
        text: productTemplate.examplePrompt,
      },
    ]);

    expect(() => applyBusinessTemplateToScenes([], productTemplate)).toThrow(
      TemplateNarrationError,
    );
  });

  test("restaurant template produces appetizing hook to CTA", () => {
    const result = applyBusinessTemplateToScenes(
      [],
      restaurantTemplate,
      {
        restaurantName: "Abud Grill",
        mealOrOfferName: "Grilled Chicken Combo",
        priceOrDeal: "limited offer today",
        location: "Nasr City",
        deliveryAvailable: "نعم - متاح دليفري",
        contactMethod: "WhatsApp",
      },
    );

    expect(result).toHaveLength(4);
    const narrationTexts = result.map((scene) => scene.text.toLowerCase());
    expect(narrationTexts[0]).toContain("craving");
    expect(narrationTexts[0]).toContain("grilled chicken combo".toLowerCase());
    expect(narrationTexts[1]).toContain("limited offer");
    expect(narrationTexts[2]).toContain("deliver");
    expect(narrationTexts[3]).toContain("message us");
    narrationTexts.forEach((text) => {
      expect(text.length).toBeLessThan(221);
      expect(text).not.toContain("ابدأ");
    });
    restaurantTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
    expect(result[0].fallbackSearchTerms).toEqual(
      expect.arrayContaining(restaurantTemplate.fallbackPexelsSearchHints),
    );
  });

  test("real estate template covers hook/value/location/cta", () => {
    const result = applyBusinessTemplateToScenes(
      [],
      realEstateTemplate,
      {
        propertyType: "Apartment",
        location: "New Cairo",
        area: "120",
        rooms: "3",
        price: "2.5 million EGP",
        contactMethod: "WhatsApp",
      },
    );

    expect(result).toHaveLength(4);
    const texts = result.map((scene) => scene.text.toLowerCase());
    expect(texts[0]).toContain("modern");
    expect(texts[1]).toContain("120");
    expect(texts[1]).toContain("bedroom");
    expect(texts[2]).toContain("2.5 million");
    expect(texts[3]).toContain("message us");
    texts.forEach((text) => {
      expect(text.length).toBeLessThan(221);
      expect(text).not.toContain("قدم");
    });
    realEstateTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
    expect(result[0].fallbackSearchTerms).toEqual(
      expect.arrayContaining(realEstateTemplate.fallbackPexelsSearchHints),
    );
  });

  test("educational template keeps hook/lesson/example/cta", () => {
    const result = applyBusinessTemplateToScenes(
      [],
      educationalTemplate,
      {
        topic: "Programming basics",
        audience: "beginner students",
        keyLesson: "variables store reusable information",
        courseOrTeacherName: "Abud Coding",
        callToAction:
          "Follow for more coding tips or message us to join the course",
      },
    );

    expect(result).toHaveLength(4);
    const texts = result.map((scene) => scene.text.toLowerCase());
    expect(texts[0]).toContain("struggling");
    expect(texts[1]).toContain("variables");
    expect(texts[2]).toContain("abud coding".toLowerCase());
    expect(texts[3]).toContain("follow");
    texts.forEach((text) => {
      expect(text.length).toBeLessThan(221);
      expect(text).not.toContain("عرّف");
    });
    educationalTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
    expect(result[0].fallbackSearchTerms).toEqual(
      expect.arrayContaining(educationalTemplate.fallbackPexelsSearchHints),
    );
  });

  test("viral curiosity template keeps hook/fact/twist/cta", () => {
    const viralTemplate = getBusinessTemplateById("viral_curiosity");
    const result = applyBusinessTemplateToScenes(
      [],
      viralTemplate,
      {
        topic: "octopuses have three hearts",
        weirdFact:
          "Two hearts pump blood to the gills and one pumps it to the body",
        twist: "the main heart stops beating when it swims",
        callToAction: "Follow for more strange facts",
      },
    );

    expect(result).toHaveLength(4);
    const texts = result.map((scene) => scene.text.toLowerCase());
    expect(texts[0]).toContain("did you know");
    expect(texts[1]).toContain("gills");
    expect(texts[2]).toContain("strange part");
    expect(texts[3]).toContain("follow");
    texts.forEach((text) => {
      expect(text.length).toBeLessThan(221);
      expect(text).not.toContain("شارك");
    });
    viralTemplate.pexelsSearchHints.forEach((hint) => {
      expect(result[0].searchTerms).toContain(hint);
    });
    expect(result[0].fallbackSearchTerms).toEqual(
      expect.arrayContaining(viralTemplate.fallbackPexelsSearchHints),
    );
  });
});
