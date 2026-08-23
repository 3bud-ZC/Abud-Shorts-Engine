export const PRODUCT_NAME = "ABUD Shorts Engine V2";
export const PRODUCT_VERSION = "2.1.0";
export const PRODUCT_STAGE = "General Availability";
export const PRODUCT_BUILD = "2026.08.23.3";
export const DATABASE_SCHEMA_VERSION = "2.9.0";

export function getProductInfo() {
  return {
    name: PRODUCT_NAME,
    version: PRODUCT_VERSION,
    stage: PRODUCT_STAGE,
    build: PRODUCT_BUILD,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    canonicalUrl: "http://localhost:3130",
    docsUrl: "https://github.com/gyoridavid/short-video-maker",
  };
}
