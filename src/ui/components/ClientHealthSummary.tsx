import React from "react";
import { Stack, Typography, useTheme } from "@mui/material";

import { StatusBadge } from "./v2";

/**
 * CLIENT HEALTH SUMMARY
 * ---------------------
 * Rolls raw service checks up into the handful of things a non-technical
 * customer can act on.
 *
 * The dashboard previously listed Database, n8n, Render Worker, Remotion,
 * FFmpeg, Kokoro, Whisper and Pexels by name. Those are implementation, and
 * naming them contradicts the no-code product goal. The technical component
 * list is still available under System Health → Advanced Details, and none of
 * the underlying checks are weakened - this only changes how they are grouped
 * and named.
 */

export type HealthComponentLike = {
  name: string;
  status: string;
  message?: string;
};

/** Client-facing group each technical component belongs to. */
const GROUP_BY_COMPONENT: Array<{ match: RegExp; group: string }> = [
  { match: /^(app|api|application|server|http)/i, group: "Application" },
  { match: /(render\s*worker|remotion|ffmpeg|worker|renderer)/i, group: "Video Engine" },
  { match: /(storage|disk|filesystem|volume)/i, group: "Storage" },
  { match: /(database|postgres|postgresql|db)/i, group: "Storage" },
  { match: /(n8n|automation|orchestrat)/i, group: "Automation" },
  { match: /(kokoro|elevenlabs|piper|voice|tts|whisper|caption)/i, group: "Voice" },
  { match: /(pexels|pixabay|stock|media)/i, group: "Media Sources" },
  { match: /(publish|youtube|meta|tiktok|telegram|upload)/i, group: "Publishing" },
];

export const CLIENT_HEALTH_GROUP_ORDER = [
  "Application",
  "Video Engine",
  "Storage",
  "Automation",
  "Voice",
  "Media Sources",
  "Publishing",
] as const;

export function clientGroupFor(componentName: string): string | null {
  const entry = GROUP_BY_COMPONENT.find((candidate) => candidate.match.test(componentName || ""));
  return entry ? entry.group : null;
}

const SEVERITY: Record<string, number> = { healthy: 0, ready: 0, degraded: 1, unhealthy: 2 };

/**
 * Groups components and keeps the WORST status in each group, so a single
 * failing service is never hidden behind a healthy sibling.
 */
export function summarizeHealth(
  components: HealthComponentLike[] = [],
): Array<{ group: string; status: string; count: number }> {
  const buckets = new Map<string, HealthComponentLike[]>();
  components.forEach((component) => {
    const group = clientGroupFor(component.name);
    if (!group) return;
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(component);
  });

  return CLIENT_HEALTH_GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => {
    const members = buckets.get(group)!;
    const worst = members.reduce((a, b) =>
      (SEVERITY[b.status] ?? 1) > (SEVERITY[a.status] ?? 1) ? b : a,
    );
    return { group, status: worst.status, count: members.length };
  });
}

export const ClientHealthSummary: React.FC<{ components?: HealthComponentLike[] }> = ({
  components = [],
}) => {
  const theme = useTheme();
  const rows = summarizeHealth(components);

  if (rows.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: theme.abud.textSecondary }}>
        Checking services…
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      {rows.map((row) => (
        <Stack
          key={row.group}
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            py: 0.85,
            px: 1,
            borderRadius: 1.5,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Typography variant="body2" fontWeight={550}>
            {row.group}
          </Typography>
          <StatusBadge status={row.status} />
        </Stack>
      ))}
    </Stack>
  );
};

export default ClientHealthSummary;
