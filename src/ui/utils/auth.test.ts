import { describe, expect, it } from "vitest";
import { shouldRedirectToLogin } from "./auth";

describe("dashboard auth redirects", () => {
  it("redirects protected dashboard API 401s to login", () => {
    expect(shouldRedirectToLogin(401, "/api/v2/jobs")).toBe(true);
    expect(shouldRedirectToLogin(401, "/api/videos")).toBe(true);
  });

  it("does not redirect bootstrap auth routes", () => {
    expect(shouldRedirectToLogin(401, "/api/v2/auth/login")).toBe(false);
    expect(shouldRedirectToLogin(401, "/api/v2/auth/setup-admin")).toBe(false);
    expect(shouldRedirectToLogin(401, "/api/v2/setup/status")).toBe(false);
    expect(shouldRedirectToLogin(403, "/api/v2/jobs")).toBe(false);
  });
});
