/**
 * Trusted proxy handling.
 *
 * A VPS installation normally sits behind nginx, and often behind Cloudflare as
 * well, which means the protocol and host the customer's browser actually used
 * arrive only as X-Forwarded-* headers. Those headers are trivially spoofable by
 * anybody who can reach the application directly, so they are honoured only when
 * the operator has explicitly declared that a proxy is in front.
 *
 * TRUSTED_PROXY is unset by default. A direct-to-internet or localhost
 * installation therefore ignores forwarded headers entirely, which is the safe
 * default.
 */

export type TrustedProxySetting = number | boolean | string[];

export interface TrustedProxyConfig {
  enabled: boolean;
  /** The value handed to Express's `trust proxy` setting. */
  expressSetting: TrustedProxySetting;
  /** Human-readable description for diagnostics and the Advanced panel. */
  description: string;
}

/**
 * Accepted values for TRUSTED_PROXY:
 *   unset / "false" / "0"  - no proxy, forwarded headers ignored (default)
 *   "1".."9"               - that many trusted proxy hops
 *   "loopback" | "linklocal" | "uniquelocal" - Express's named ranges
 *   comma-separated CIDRs or IPs - explicit trusted sources
 *   "true"                 - trust one hop; the common single-nginx case
 */
export function resolveTrustedProxy(raw: string | undefined): TrustedProxyConfig {
  const value = (raw || "").trim();

  if (!value || value === "false" || value === "0" || value === "off") {
    return {
      enabled: false,
      expressSetting: false,
      description: "No trusted proxy. X-Forwarded-* headers are ignored.",
    };
  }

  if (value === "true" || value === "on") {
    return {
      enabled: true,
      expressSetting: 1,
      description: "Trusting 1 proxy hop.",
    };
  }

  if (/^[1-9]$/.test(value)) {
    return {
      enabled: true,
      expressSetting: Number(value),
      description: `Trusting ${value} proxy hop(s).`,
    };
  }

  if (value === "loopback" || value === "linklocal" || value === "uniquelocal") {
    return {
      enabled: true,
      expressSetting: [value],
      description: `Trusting the ${value} address range.`,
    };
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length > 0 && entries.every(isAddressOrCidr)) {
    return {
      enabled: true,
      expressSetting: entries,
      description: `Trusting ${entries.length} explicitly listed proxy address(es).`,
    };
  }

  // An unparseable value must not silently become "trust everything".
  return {
    enabled: false,
    expressSetting: false,
    description:
      "TRUSTED_PROXY could not be understood, so forwarded headers are ignored. " +
      "Use true, a hop count, or a comma-separated list of proxy addresses.",
  };
}

function isAddressOrCidr(entry: string): boolean {
  const [address, prefix] = entry.split("/");
  if (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) return false;
  // IPv4, or anything hex-and-colons which covers the IPv6 forms Express accepts.
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(address) || ipv6.test(address);
}

export interface ForwardedRequestFacts {
  protocol: string;
  host: string | undefined;
}

/**
 * The protocol and host to believe for this request. With no trusted proxy the
 * connection's own values win, whatever the headers claim.
 */
export function effectiveRequestOrigin(
  config: TrustedProxyConfig,
  request: {
    protocol: string;
    secure?: boolean;
    get: (header: string) => string | undefined;
    socket?: { encrypted?: boolean };
  },
): ForwardedRequestFacts {
  if (!config.enabled) {
    return {
      protocol: request.socket?.encrypted ? "https" : "http",
      host: request.get("host"),
    };
  }
  // Express has already validated the hop chain against `trust proxy` before
  // populating req.protocol, so these are the vetted values, not raw headers.
  return {
    protocol: request.protocol,
    host: request.get("x-forwarded-host") || request.get("host"),
  };
}
