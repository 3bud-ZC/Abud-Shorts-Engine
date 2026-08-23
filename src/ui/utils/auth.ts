import axios from "axios";

let axiosAuthConfigured = false;

export function getSessionToken(): string {
  try {
    return localStorage.getItem("abud_session_token") || "";
  } catch {
    return "";
  }
}

export function shouldRedirectToLogin(status?: number, url = ""): boolean {
  if (status !== 401) return false;
  const target = String(url || "");
  return !(
    target.includes("/api/v2/auth/login") ||
    target.includes("/api/v2/auth/setup-admin") ||
    target.includes("/api/v2/setup/status")
  );
}

export function configureAxiosAuth(): void {
  if (axiosAuthConfigured) return;
  axiosAuthConfigured = true;
  axios.interceptors.request.use((config) => {
    const token = getSessionToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (typeof window !== "undefined" && shouldRedirectToLogin(error?.response?.status, error?.config?.url)) {
        try {
          localStorage.removeItem("abud_session_token");
          localStorage.setItem("abud_auth_notice", "session_expired");
          localStorage.setItem(
            "abud_auth_return_to",
            `${window.location.pathname}${window.location.search}`,
          );
        } catch {
          // Browser storage can be unavailable in private or test contexts.
        }
        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign("/login");
        }
      }
      return Promise.reject(error);
    },
  );
}

export function withMediaAccessToken(url: string): string {
  const token = getSessionToken();
  if (!token || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}
