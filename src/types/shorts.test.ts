import { describe, expect, test } from "vitest";

import { createShortInput } from "./shorts";
import { sanitizeBrandColor } from "../components/utils";

const baseInput = {
  scenes: [
    {
      text: "Base scene",
      searchTerms: ["egypt"],
    },
  ],
  config: {},
};

describe("createShortInput template validation", () => {
  test("accepts generic flow without template data", () => {
    const result = createShortInput.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  test("rejects template without required template data", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "product_ad",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.errors.map((error) => error.path.join("."));
      expect(messages).toContain("businessTemplateData.productName");
    }
  });

  test("rejects template data when template id is missing", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateData: {
        arbitrary: "value",
      },
    });

    expect(result.success).toBe(false);
  });

  test("accepts payload when template data is complete", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "product_ad",
      businessTemplateData: {
        productName: "Cairo Bag",
        productCategory: "Leather",
        mainBenefit: "Handmade craftsmanship",
        priceOrOffer: "799 EGP",
        targetCustomer: "Young professionals",
        contactMethod: "DM on Instagram",
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("createShortInput brandKit validation", () => {
  test("accepts payload without brandKit", () => {
    const result = createShortInput.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  test("accepts payload with full brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      config: {
        brandKit: {
          brandName: "Abud",
          watermarkText: "Abud",
          primaryColor: "#7C3AED",
          accentColor: "#FFFFFF",
          captionStyle: "bold",
          includeOutro: true,
          outroText: "Follow for more.",
          contactText: "Order on WhatsApp",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts payload with partial brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      config: {
        brandKit: {
          brandName: "Abud",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts payload with invalid color strings (no strict validation)", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      config: {
        brandKit: {
          primaryColor: "not-a-color",
          accentColor: "also-invalid",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid captionStyle", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      config: {
        brandKit: {
          captionStyle: "fancy",
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test("existing template tests still pass with brandKit present", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "product_ad",
      businessTemplateData: {
        productName: "Cotton T-Shirt",
        productCategory: "Clothing",
        mainBenefit: "comfortable everyday wear",
        priceOrOffer: "limited offer",
        targetCustomer: "young adults",
        contactMethod: "WhatsApp",
      },
      config: {
        brandKit: {
          brandName: "Abud",
          watermarkText: "Abud",
          primaryColor: "#7C3AED",
          captionStyle: "bold",
          includeOutro: true,
          outroText: "Follow for more offers.",
          contactText: "Order on WhatsApp",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty brandKit object without breaking config", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      config: {
        brandKit: {},
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts restaurant_offer template with brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "restaurant_offer",
      businessTemplateData: {
        restaurantName: "Abud Grill",
        mealOrOfferName: "Grilled Chicken Combo",
        priceOrDeal: "limited offer today",
        location: "Nasr City",
        deliveryAvailable: "Yes",
        contactMethod: "WhatsApp",
      },
      config: {
        brandKit: {
          brandName: "Abud Grill",
          watermarkText: "Abud Grill",
          primaryColor: "#7C3AED",
          accentColor: "#FFFFFF",
          captionStyle: "clean",
          includeOutro: true,
          outroText: "Order your meal today.",
          contactText: "WhatsApp delivery available",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts real_estate_listing template with brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "real_estate_listing",
      businessTemplateData: {
        propertyType: "Apartment",
        location: "New Cairo",
        area: "120",
        rooms: "3",
        price: "2.5M EGP",
        contactMethod: "Call",
      },
      config: {
        brandKit: {
          brandName: "Abud Realty",
          watermarkText: "Abud Realty",
          primaryColor: "#059669",
          accentColor: "#FFFFFF",
          captionStyle: "minimal",
          includeOutro: true,
          outroText: "Contact us today.",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts educational_tip template with brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "educational_tip",
      businessTemplateData: {
        topic: "Learning faster",
        audience: "students",
        keyLesson: "Use spaced repetition to retain more knowledge",
        courseOrTeacherName: "Abud Edu",
        callToAction: "Subscribe for more tips",
      },
      config: {
        brandKit: {
          brandName: "Abud Edu",
          watermarkText: "Abud Edu",
          primaryColor: "#2563EB",
          accentColor: "#FEF08A",
          captionStyle: "bold",
          includeOutro: false,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts viral_curiosity template with brandKit", () => {
    const result = createShortInput.safeParse({
      ...baseInput,
      businessTemplateId: "viral_curiosity",
      businessTemplateData: {
        topic: "Octopuses have three hearts",
        weirdFact: "Two hearts pump blood to the gills and one pumps it to the body",
        audience: "curious viewers",
        twist: "The main heart stops beating when the octopus swims",
        callToAction: "Follow for more strange facts",
      },
      config: {
        brandKit: {
          brandName: "Abud Facts",
          watermarkText: "Abud Facts",
          primaryColor: "#111827",
          accentColor: "#FFFFFF",
          captionStyle: "minimal",
          includeOutro: true,
          outroText: "Follow for more strange facts.",
          contactText: "New facts daily",
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("brand color sanitization", () => {
  test("keeps safe supported color formats", () => {
    expect(sanitizeBrandColor("#7C3AED", "white")).toBe("#7C3AED");
    expect(sanitizeBrandColor("rgba(0, 0, 0, 0.5)", "white")).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
    expect(sanitizeBrandColor("white", "black")).toBe("white");
  });

  test("falls back for unsupported color strings", () => {
    expect(sanitizeBrandColor("not-a-color!", "#FFFFFF")).toBe("#FFFFFF");
    expect(sanitizeBrandColor("", "#FFFFFF")).toBe("#FFFFFF");
    expect(sanitizeBrandColor(undefined, "#FFFFFF")).toBe("#FFFFFF");
  });
});
