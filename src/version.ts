export const PRODUCT_NAME = "ABUD Shorts Engine V2";
export const PRODUCT_VERSION = "2.0.0-rc.2";
export const PRODUCT_STAGE = "Release Candidate";
export const PRODUCT_BUILD = "2026.08.22.2";
export const DATABASE_SCHEMA_VERSION = "2.5.0";

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
