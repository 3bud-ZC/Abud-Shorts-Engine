import { describe, it, expect } from "vitest";
import { convertTemplateToProductionSpec } from "./templateToSpec";
import { BUSINESS_TEMPLATE_IDS } from "../../short-creator/business-templates";

describe("Template Mode -> Production Spec Converter", () => {
  it.each(BUSINESS_TEMPLATE_IDS)(
    "converts template %s to a valid canonical ProductionSpec",
    (templateId) => {
      const spec = convertTemplateToProductionSpec({
        templateId,
        templateData: {
          productName: "Oversized Tee",
          mainBenefit: "ultra soft cotton",
          priceOrOffer: "20% off",
          targetCustomer: "youth",
          contactMethod: "+2010000000",
        },
        config: {
          brandKit: {
            brandName: "StreetBrand",
            captionStyle: "bold",
            includeOutro: true,
          },
        },
      });

      expect(spec.creationMode).toBe("template");
      expect(spec.templateId).toBe(templateId);
      expect(spec.scenes.length).toBeGreaterThanOrEqual(1);
      expect(spec.scenes.length).toBeLessThanOrEqual(5);
      expect(spec.scenes[0].narration.length).toBeGreaterThan(0);
      expect(spec.scenes[0].stockSearchTerms.length).toBeGreaterThan(0);
      expect(spec.brandKit?.brandName).toBe("StreetBrand");
      expect(spec.costEstimate?.isFree).toBe(true);
      expect(spec.costEstimate?.estimatedCost).toBe(0);
    },
  );
});
