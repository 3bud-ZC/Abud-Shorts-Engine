import type { BusinessTemplateId } from "./business-templates";

export type TemplateData = Record<string, string>;

export type GeneratedScene = {
  text: string;
  searchTerms?: string[];
};

function pickValue(
  templateData: TemplateData | undefined,
  key: string,
  fallback: string,
): string {
  return templateData?.[key]?.trim() || fallback;
}

function buildProductAdScenes(templateData?: TemplateData): GeneratedScene[] {
  const productName = pickValue(templateData, "productName", "This basic cotton tee");
  const benefit = pickValue(
    templateData,
    "mainBenefit",
    "comfortable everyday wear",
  );
  const offer = pickValue(templateData, "priceOrOffer", "a limited offer");
  const customer = pickValue(templateData, "targetCustomer", "young adults");
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  return [
    { text: "Need a clean everyday T-shirt that actually feels comfortable?" },
    {
      text: `${productName} is soft cotton, easy to style, and made for ${customer}.`,
    },
    {
      text: `Wear it for ${benefit} and grab it now with ${offer}.`,
    },
    { text: `Message us on ${contact} now to reserve yours.` },
  ];
}

function buildRestaurantScenes(templateData?: TemplateData): GeneratedScene[] {
  const name = pickValue(templateData, "restaurantName", "this spot");
  const meal = pickValue(templateData, "mealOrOfferName", "a signature dish");
  const price = pickValue(templateData, "priceOrDeal", "a special price");
  const location = pickValue(templateData, "location", "the city");
  const delivery = pickValue(
    templateData,
    "deliveryAvailable",
    "Delivery available",
  );
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  const deliveryLine = delivery.includes("لا")
    ? `Visit us in ${location} and grab it while it's hot.`
    : `${delivery}. We deliver across ${location}.`;

  return [
    { text: `Craving ${meal}? ${name} is serving it sizzling right now.` },
    { text: `${meal} now comes with ${price}, cooked daily for serious flavor.` },
    { text: deliveryLine },
    { text: `Message us on ${contact} today to order before the offer ends.` },
  ];
}

function buildRealEstateScenes(templateData?: TemplateData): GeneratedScene[] {
  const propertyType = pickValue(templateData, "propertyType", "apartment");
  const location = pickValue(templateData, "location", "New Cairo");
  const area = pickValue(templateData, "area", "120");
  const rooms = pickValue(templateData, "rooms", "3");
  const price = pickValue(templateData, "price", "a flexible payment plan");
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  return [
    { text: `Looking for a modern ${propertyType} in ${location}?` },
    {
      text: `${area} m² with ${rooms} bedrooms and a layout ready to move in.`,
    },
    { text: `Priced at ${price} and waiting in ${location}.` },
    { text: `Message us on ${contact} now to book a viewing.` },
  ];
}

function ensureSentence(text: string, fallback: string): string {
  const trimmed = (text || fallback).trim();
  if (!trimmed) {
    return fallback;
  }
  return /[.!?؟،]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildEducationalScenes(templateData?: TemplateData): GeneratedScene[] {
  const topic = pickValue(templateData, "topic", "programming basics");
  const audience = pickValue(templateData, "audience", "beginner students");
  const lesson = pickValue(
    templateData,
    "keyLesson",
    "variables store reusable information",
  );
  const teacher = pickValue(
    templateData,
    "courseOrTeacherName",
    "our coaching team",
  );
  const cta = pickValue(
    templateData,
    "callToAction",
    "Follow for more tips or message us to join the course",
  );

  return [
    {
      text: `Struggling to understand ${topic}? ${audience} ask us for this quick breakdown.`,
    },
    {
      text: `Start with ${lesson}; it keeps every concept reusable.`,
    },
    {
      text: `${teacher} teaches it this way so the next lesson actually sticks.`,
    },
    { text: ensureSentence(cta, "Follow for more tips.") },
  ];
}

function buildViralCuriosityScenes(templateData?: TemplateData): GeneratedScene[] {
  const topic = pickValue(
    templateData,
    "topic",
    "octopuses have three hearts",
  );
  const fact = pickValue(
    templateData,
    "weirdFact",
    "two pump blood to the gills and one pumps it to the body",
  );
  const twist = pickValue(
    templateData,
    "twist",
    "the main heart stops beating when it swims",
  );
  const cta = pickValue(
    templateData,
    "callToAction",
    "Follow for more strange facts",
  );

  return [
    { text: `Did you know ${topic}?` },
    { text: `${fact}.` },
    { text: `But here's the strange part: ${twist}.` },
    { text: ensureSentence(cta, "Follow for more.") },
  ];
}

export function generateScenesForTemplate(
  templateId: BusinessTemplateId,
  templateData?: TemplateData,
): GeneratedScene[] {
  switch (templateId) {
    case "product_ad":
      return buildProductAdScenes(templateData);
    case "restaurant_offer":
      return buildRestaurantScenes(templateData);
    case "real_estate_listing":
      return buildRealEstateScenes(templateData);
    case "educational_tip":
      return buildEducationalScenes(templateData);
    case "viral_curiosity":
      return buildViralCuriosityScenes(templateData);
    default:
      return [];
  }
}
