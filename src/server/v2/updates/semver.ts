/**
 * Semantic version comparison for the updater.
 *
 * The updater must never decide "newer" by string comparison: "2.10.0" sorts
 * before "2.9.0" alphabetically, which would silently offer customers a
 * downgrade. Everything here works on parsed numeric components instead.
 *
 * Only the subset of semver that a product release actually uses is supported:
 * MAJOR.MINOR.PATCH with an optional pre-release tag and optional build
 * metadata. Build metadata is ignored for ordering, as the specification
 * requires.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string;
  raw: string;
}

const SEMVER_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Returns null rather than throwing: a malformed remote version is data, not a crash. */
export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split(".") : [],
    build: build || "",
    raw: value.trim(),
  };
}

export function isValidVersion(value: unknown): boolean {
  return parseVersion(value) !== null;
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version without a pre-release tag outranks the same version with one:
  // 2.2.0 is newer than 2.2.0-rc.1.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else if (leftNumeric !== rightNumeric) {
      // Numeric identifiers always have lower precedence than alphanumeric ones.
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left > right ? 1 : -1;
    }
  }
  return 0;
}

/**
 * Returns 1 when `a` is newer than `b`, -1 when older, 0 when equal.
 * Throws on an unparseable input so a caller can never treat garbage as equal.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new Error(`Not a valid version: ${String(a)}`);
  if (!right) throw new Error(`Not a valid version: ${String(b)}`);

  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerThan(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** True when `candidate` is a downgrade relative to `current`. */
export function isOlderThan(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) < 0;
}

/**
 * Whether an application at `appVersion` may act on a manifest that demands at
 * least `minimumUpdaterVersion`. An older client must stop and say so rather
 * than half-apply a release whose format it does not understand.
 */
export function satisfiesMinimum(appVersion: string, minimum: string): boolean {
  return compareVersions(appVersion, minimum) >= 0;
}
