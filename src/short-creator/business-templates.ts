export const BUSINESS_TEMPLATE_IDS = [
  "product_ad",
  "restaurant_offer",
  "real_estate_listing",
  "educational_tip",
  "viral_curiosity",
] as const;

export type BusinessTemplateId = (typeof BUSINESS_TEMPLATE_IDS)[number];

export type BusinessTemplateFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select";

export type BusinessTemplateField = {
  key: string;
  label: string;
  type: BusinessTemplateFieldType;
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

export interface BusinessTemplate {
  id: BusinessTemplateId;
  displayName: string;
  description: string;
  targetUseCase: string;
  defaultTone: string;
  suggestedDurationSeconds: number;
  examplePrompt: string;
  pexelsSearchHints: string[];
  fallbackPexelsSearchHints: string[];
  hookStyle: string;
  ctaStyle: string;
  fields: BusinessTemplateField[];
  recommendedSceneCount?: number;
  targetDurationSeconds?: number;
  qualityChecklist?: string[];
}

const TEMPLATE_DEFINITIONS: Record<BusinessTemplateId, BusinessTemplate> = {
  product_ad: {
    id: "product_ad",
    displayName: "Product Ad",
    description:
      "Perfect for highlighting a single product with a bold hook, benefit-driven middle, and urgent CTA.",
    targetUseCase: "Retailers and D2C brands promoting a hero product",
    defaultTone: "Bold, confident, conversational Egyptian Arabic",
    suggestedDurationSeconds: 35,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook asks a direct question or highlights comfort",
      "Value line explains fabric/fit",
      "Offer mentions limited stock/price",
      "CTA points to WhatsApp or direct order",
    ],
    examplePrompt:
      "عرف جمهورك على المنتج، أبرز فائدة حقيقية، وانهِ بدعوة للشراء قبل انتهاء العرض",
    pexelsSearchHints: [
      "fashion",
      "clothing",
      "t shirt",
      "streetwear",
      "shopping",
      "retail store",
      "model clothing",
      "clothes rack",
      "cotton fabric",
      "casual outfit",
    ],
    fallbackPexelsSearchHints: [
      "fashion",
      "apparel",
      "shopping",
      "retail store",
      "clothes store",
      "streetwear",
      "model clothing",
      "cotton fabric",
      "minimal wardrobe",
    ],
    hookStyle: "Start with a dramatic question or bold stat",
    ctaStyle: "Clear price mention + urgency to DM or visit store",
    fields: [
      {
        key: "productName",
        label: "Product Name",
        type: "text",
        required: true,
        placeholder: "مثال: شنطة يد جلد طبيعي",
      },
      {
        key: "productCategory",
        label: "Product Category",
        type: "text",
        required: true,
        placeholder: "إكسسوارات، أزياء رياضية، أجهزة منزلية...",
      },
      {
        key: "mainBenefit",
        label: "Main Benefit",
        type: "textarea",
        required: true,
        helperText: "ما السبب الرئيسي لشراء المنتج الآن؟",
      },
      {
        key: "priceOrOffer",
        label: "Price or Offer",
        type: "text",
        required: true,
        placeholder: "مثال: 599 جنيه بدل 750 لمدة 48 ساعة",
      },
      {
        key: "targetCustomer",
        label: "Target Customer",
        type: "text",
        required: true,
        placeholder: "سيدات القاهرة، طلاب جامعة، أصحاب المشاريع...",
      },
      {
        key: "contactMethod",
        label: "Preferred Contact Method",
        type: "text",
        required: true,
        helperText: "اكتب طريقة التواصل: واتساب، إنستجرام، زيارة فرع...",
      },
    ],
  },
  restaurant_offer: {
    id: "restaurant_offer",
    displayName: "Restaurant Offer",
    description:
      "For cafés and restaurants teasing a seasonal menu, combo, or delivery promo.",
    targetUseCase: "Local restaurants in Cairo/Alexandria pushing dine-in or delivery",
    defaultTone: "Warm, appetizing, friendly Egyptian Arabic",
    suggestedDurationSeconds: 40,
    recommendedSceneCount: 4,
    targetDurationSeconds: 22,
    qualityChecklist: [
      "Hook mentions craving or fresh meal",
      "Offer line names the dish and deal",
      "Delivery or location convenience is stated",
      "CTA tells viewers to order or book",
      "B-roll shows appetizing food or kitchen shots",
    ],
    examplePrompt:
      "ابدأ بلقطة شهية، احكي عن مكونات مميزة، واختم بعرض محدود للزيارة أو الطلب",
    pexelsSearchHints: [
      "restaurant",
      "food",
      "grilled chicken",
      "meal",
      "dining",
      "kitchen",
      "chef cooking",
      "food delivery",
      "takeaway food",
      "cafe",
    ],
    fallbackPexelsSearchHints: [
      "restaurant",
      "food",
      "meal",
      "dining",
      "kitchen",
      "chef",
      "food delivery",
      "takeaway food",
      "cafe",
    ],
    hookStyle: "Sensory hook describing smell/texture",
    ctaStyle: "Invite viewers to book a table or order now",
    fields: [
      {
        key: "restaurantName",
        label: "Restaurant Name",
        type: "text",
        required: true,
      },
      {
        key: "mealOrOfferName",
        label: "Meal or Offer Name",
        type: "text",
        required: true,
        placeholder: "كومبو فطار، طبق توقيع الشيف...",
      },
      {
        key: "priceOrDeal",
        label: "Price or Deal",
        type: "text",
        required: true,
        helperText: "اذكر السعر أو نسبة الخصم أو كود الطلب",
      },
      {
        key: "location",
        label: "Location",
        type: "text",
        required: true,
        placeholder: "التجمع الخامس، سموحة، المعادي...",
      },
      {
        key: "deliveryAvailable",
        label: "Delivery Available?",
        type: "select",
        required: true,
        options: ["نعم - متاح دليفري", "لا - للزيارة فقط"],
      },
      {
        key: "contactMethod",
        label: "Contact or Booking",
        type: "text",
        required: true,
        helperText: "اكتب رقم، لينك طلب، أو منصّة",
      },
    ],
  },
  real_estate_listing: {
    id: "real_estate_listing",
    displayName: "Real Estate Listing",
    description:
      "Spotlights apartments or office spaces with credibility, amenities, and viewing CTA.",
    targetUseCase: "Agents advertising new listings in Egypt",
    defaultTone: "Trust-building, premium, informative",
    suggestedDurationSeconds: 45,
    recommendedSceneCount: 4,
    targetDurationSeconds: 22,
    qualityChecklist: [
      "Hook highlights the property opportunity",
      "Area/rooms/layout are mentioned",
      "Location and price/deal are clear",
      "CTA tells viewers to message/book a viewing",
      "B-roll shows apartments/interiors/buildings",
    ],
    examplePrompt:
      "قدم الموقع، أبرز أهم ميزة مع دليل اجتماعي، واختم بموعد المعاينة",
    pexelsSearchHints: [
      "apartment",
      "real estate",
      "home interior",
      "living room",
      "modern apartment",
      "building",
      "city apartment",
      "balcony",
      "bedroom",
      "house tour",
    ],
    fallbackPexelsSearchHints: [
      "apartment",
      "real estate",
      "home interior",
      "living room",
      "modern apartment",
      "building",
      "city apartment",
      "balcony",
      "bedroom",
      "house tour",
    ],
    hookStyle: "Lead with scarcity or lifestyle upgrade",
    ctaStyle: "Book a tour or call the agent",
    fields: [
      {
        key: "propertyType",
        label: "Property Type",
        type: "select",
        required: true,
        options: ["شقة", "فيلا", "مكتب", "محل", "أرض"],
      },
      {
        key: "location",
        label: "Location / Neighborhood",
        type: "text",
        required: true,
      },
      {
        key: "area",
        label: "Area (m²)",
        type: "number",
        required: true,
        helperText: "أدخل المساحة بالمتر المربع",
      },
      {
        key: "rooms",
        label: "Rooms / Layout",
        type: "number",
        required: true,
        helperText: "عدد الغرف أو التقسيم",
      },
      {
        key: "price",
        label: "Price or Installment",
        type: "text",
        required: true,
        placeholder: "سعر كاش أو قسط شهري",
      },
      {
        key: "contactMethod",
        label: "Contact Method",
        type: "text",
        required: true,
        helperText: "رقم سمسار، واتساب، أو لينك حجز",
      },
    ],
  },
  educational_tip: {
    id: "educational_tip",
    displayName: "Educational Tip",
    description:
      "Short actionable lessons for creators, tutors, or coaches who want to teach a single insight.",
    targetUseCase: "Educators and coaches sharing a quick lesson",
    defaultTone: "Friendly, helpful, confident",
    suggestedDurationSeconds: 35,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook mentions a common struggle or question",
      "Lesson explains one clear idea",
      "Example/use-case line is included",
      "CTA invites to follow/message/join",
      "Footage shows students, laptops, or classroom energy",
    ],
    examplePrompt:
      "عرّف المشكلة، اشرح فكرة واحدة ببساطة، واختم بدعوة لمتابعة الدروس أو الاشتراك",
    pexelsSearchHints: [
      "student",
      "education",
      "classroom",
      "study",
      "teacher",
      "online learning",
      "coding",
      "programming",
      "laptop study",
      "computer class",
    ],
    fallbackPexelsSearchHints: [
      "student",
      "education",
      "classroom",
      "study",
      "teacher",
      "online learning",
      "coding",
      "programming",
      "laptop study",
      "computer class",
    ],
    hookStyle: "Pose a relatable pain question",
    ctaStyle: "Encourage DM for checklist or free consult",
    fields: [
      {
        key: "topic",
        label: "Topic",
        type: "text",
        required: true,
        placeholder: "مثال: إدارة الوقت لرواد الأعمال",
      },
      {
        key: "audience",
        label: "Audience",
        type: "text",
        required: true,
        helperText: "من الشخص الذي يستفيد من النصيحة؟",
      },
      {
        key: "keyLesson",
        label: "Key Lesson",
        type: "textarea",
        required: true,
        helperText: "اكتب أهم 2-3 نقاط تريد توضيحها",
      },
      {
        key: "courseOrTeacherName",
        label: "Course or Teacher Name",
        type: "text",
        required: true,
      },
      {
        key: "callToAction",
        label: "Call To Action",
        type: "text",
        required: true,
        placeholder: "راسلنا على واتساب لتحميل الدليل",
        helperText: "مثال: تابعونا للمزيد أو راسلنا للانضمام",
      },
    ],
  },
  viral_curiosity: {
    id: "viral_curiosity",
    displayName: "Viral Curiosity Short",
    description:
      "Fast-paced format for reels highlighting surprising facts about animals, science, or hidden trivia.",
    targetUseCase: "Content creators chasing viral reach with curiosity hooks",
    defaultTone: "Playful, fast, scroll-stopping",
    suggestedDurationSeconds: 30,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook opens with a curiosity question or 'Did you know'",
      "Weird fact is stated clearly and simply",
      "Explanation or extra detail is easy to follow",
      "Twist or strong ending keeps attention",
      "Footage matches the topic (ocean, animals, science, nature)",
      "Captions are readable and pacing feels fast",
    ],
    examplePrompt:
      "افتتح بسؤال غريب، اذكر حقيقة مفاجئة، واختم بدعوة لمتابعة المزيد",
    pexelsSearchHints: [
      "octopus",
      "underwater",
      "ocean",
      "sea life",
      "marine animal",
      "animal",
      "nature",
      "wildlife",
      "science",
      "ocean wildlife",
    ],
    fallbackPexelsSearchHints: [
      "octopus",
      "underwater",
      "ocean",
      "sea life",
      "marine animal",
      "animal",
      "nature",
      "wildlife",
      "science",
      "ocean wildlife",
    ],
    hookStyle: "Drop a shocking stat in first sentence",
    ctaStyle: "Ask viewers to comment or try it locally",
    fields: [
      {
        key: "topic",
        label: "Topic or Business Angle",
        type: "text",
        required: true,
      },
      {
        key: "weirdFact",
        label: "Weird Fact",
        type: "textarea",
        required: true,
        helperText: "اكتب المعلومة أو المفاجأة",
      },
      {
        key: "audience",
        label: "Audience",
        type: "text",
        required: true,
      },
      {
        key: "twist",
        label: "Twist or Challenge",
        type: "text",
        required: true,
        helperText: "كيف تربط الحقيقة بتحدي أو تجربة؟",
      },
      {
        key: "callToAction",
        label: "Call To Action",
        type: "text",
        required: true,
        placeholder: "اكتب CTA يدفع للتعليق أو الزيارة",
      },
    ],
  },
};

export function getBusinessTemplateById(
  id: BusinessTemplateId,
): BusinessTemplate {
  return TEMPLATE_DEFINITIONS[id];
}

export function listBusinessTemplates(): BusinessTemplate[] {
  return Object.values(TEMPLATE_DEFINITIONS);
}
