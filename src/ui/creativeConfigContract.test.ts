import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { CREATIVE_PRESETS } from "../server/v2/creative/creativePlan";
import { ALL_TREATMENTS } from "../server/v2/creative/visualTreatment";
import { TEMPLATE_CREATIVE_PROFILES } from "../short-creator/templateCreativeProfiles";

/**
 * BROWSER-FACING CREATIVE CONFIGURATION CONTRACT
 * ----------------------------------------------
 * The client surface and the creative engine have to agree, and the client must
 * not leak the engine's internal vocabulary.
 *
 * These read the shipped source of the two client pages rather than mounting
 * them, because what matters is the contract: that every option the creator
 * offers is one the planner really understands, and that no treatment enum, EDL
 * payload or provider router id is presented to a customer as a control.
 */

const UI_DIR = path.resolve(__dirname, "pages");
const creatorSource = fs.readFileSync(path.join(UI_DIR, "VideoCreator.tsx"), "utf8");
const detailsSource = fs.readFileSync(path.join(UI_DIR, "VideoDetails.tsx"), "utf8");

/** Options inside a specific `<Select>` in the creator page. */
function selectOptions(source: string, selectId: string): string[] {
  const anchor = source.indexOf(`id="${selectId}"`);
  if (anchor === -1) return [];
  const end = source.indexOf("</Select>", anchor);
  const block = source.slice(anchor, end === -1 ? undefined : end);
  return Array.from(block.matchAll(/<MenuItem value="([^"]+)"/g)).map((match) => match[1]);
}

describe("Advanced creative controls", () => {
  it("exposes Creative Style and Animation Intensity", () => {
    expect(creatorSource).toContain("Creative Style");
    expect(creatorSource).toContain("Animation Intensity");
  });

  it("offers exactly the creative presets the planner implements", () => {
    const offered = selectOptions(creatorSource, "creative-style-select");
    expect(offered.length).toBeGreaterThan(0);
    offered.forEach((option) => {
      expect(Object.keys(CREATIVE_PRESETS)).toContain(option);
    });
  });

  it("offers only the animation intensities the plan accepts", () => {
    const offered = selectOptions(creatorSource, "animation-intensity-select");
    expect(offered.sort()).toEqual(["balanced", "high", "low"]);
  });

  it("labels every creative option in plain language, never as an enum", () => {
    const optionLabels = Array.from(
      creatorSource.matchAll(/<MenuItem value="[^"]+">([^<]+)</g),
    ).map((match) => match[1].trim());
    optionLabels.forEach((label) => {
      // A label that is SCREAMING_SNAKE_CASE is an internal identifier leaking
      // into the client surface.
      expect(label).not.toMatch(/^[A-Z][A-Z0-9_]{4,}$/);
    });
  });

  it("never presents an internal treatment name as a customer-facing control", () => {
    ALL_TREATMENTS.forEach((treatment) => {
      expect(creatorSource).not.toContain(`<MenuItem value="${treatment}"`);
      expect(creatorSource).not.toContain(`>${treatment}<`);
    });
  });

  it("keeps the raw edit decision list and source-router ids out of the creator", () => {
    expect(creatorSource).not.toContain("editDecisionList");
    expect(creatorSource).not.toContain("sceneSourceRouter");
    expect(creatorSource).not.toContain("edl.v1");
  });
});

describe("Product Ad media contract", () => {
  it("only offers product assets the library reports as usable", () => {
    expect(creatorSource).toContain("usableProducts");
    expect(creatorSource).toContain("prod?.usable !== false");
    // The picker must iterate the filtered list, never the raw one.
    expect(creatorSource).toContain("usableProducts.map((prod)");
    expect(creatorSource).not.toContain("uploadedProducts.map((prod)");
  });

  it("auto-selects a usable asset rather than whichever happens to be first", () => {
    expect(creatorSource).toContain("prods.find((prod: any) => prod.usable !== false)");
  });

  it("tells the customer plainly that a Product Ad needs a product photo", () => {
    expect(creatorSource).toMatch(/Product Ad is built around your product photo/i);
  });

  it("marks the format as requiring product media in the template profile", () => {
    expect(TEMPLATE_CREATIVE_PROFILES.product_ad.requiresProductMedia).toBe(true);
    // No other shipped format claims to need it.
    Object.entries(TEMPLATE_CREATIVE_PROFILES)
      .filter(([id]) => id !== "product_ad")
      .forEach(([, profile]) => expect(profile.requiresProductMedia).toBe(false));
  });
});

describe("Creative evidence in Video Details", () => {
  it("summarises the creative decisions in readable terms", () => {
    expect(detailsSource).toContain("Creative Style");
    expect(detailsSource).toContain("Visual Treatments");
    expect(detailsSource).toContain("Shot Count");
    expect(detailsSource).toContain("Source Types");
    expect(detailsSource).toContain("Brand Used");
  });

  it("keeps every raw JSON dump inside a collapsed accordion", () => {
    const dumps = Array.from(detailsSource.matchAll(/JSON\.stringify\(/g));
    expect(dumps.length).toBeGreaterThan(0);
    dumps.forEach((match) => {
      const before = detailsSource.slice(0, match.index);
      const lastAccordion = before.lastIndexOf("<Accordion");
      const lastAccordionClose = before.lastIndexOf("</Accordion>");
      // Every dump sits inside an accordion that has not been closed yet.
      expect(lastAccordion).toBeGreaterThan(lastAccordionClose);
    });
  });

  it("reports brand fields honestly rather than implying the engine knew them", () => {
    expect(detailsSource).toContain("suppliedBrandFields");
    expect(detailsSource).toMatch(/ABUD defaults/);
  });
});
