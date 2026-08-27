import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  SCHEMA_BACKWARDS_COMPATIBLE,
  getLatestMigrationVersion,
} from "./migrationRunner";
import { DATABASE_SCHEMA_VERSION } from "../../../version";

/**
 * A customer may install stable v2.2.0 (schema 2.12.0) before v2.3 ships, then
 * upgrade. These checks pin the properties that make that upgrade - and a code
 * rollback afterwards - safe without a database reset.
 */

/** Capture every SQL statement a migration issues, without a real database. */
async function collectSql(migrationIndex: number): Promise<string> {
  const statements: string[] = [];
  const fakePool = {
    query: async (text: string) => {
      statements.push(text);
      return { rows: [], rowCount: 0 };
    },
  };
  await MIGRATIONS[migrationIndex].up(fakePool as never);
  return statements.join("\n");
}

const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS\s+\w*tmp)/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\s+\w+\s+TYPE\b/i,
  /\bALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL\b/i,
];

describe("migration safety — v2.2 to v2.3 upgrade compatibility", () => {
  it("keeps DATABASE_SCHEMA_VERSION equal to the latest migration", () => {
    expect(getLatestMigrationVersion()).toBe(DATABASE_SCHEMA_VERSION);
  });

  it("has migrations in ascending version order with unique versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    expect(versions).toEqual(sorted);
  });

  it("declares itself backwards compatible, and every migration is additive", async () => {
    expect(SCHEMA_BACKWARDS_COMPATIBLE).toBe(true);
    for (let i = 0; i < MIGRATIONS.length; i += 1) {
      const sql = await collectSql(i);
      for (const pattern of DESTRUCTIVE) {
        expect(pattern.test(sql), `${MIGRATIONS[i].version} (${MIGRATIONS[i].name}) runs ${pattern}`).toBe(false);
      }
    }
  });

  it("only needs to apply 2.13.0 on top of a v2.2.0 (2.12.0) database, additively", async () => {
    const deltaFrom212 = MIGRATIONS.filter(
      (m) => m.version.localeCompare("2.12.0", undefined, { numeric: true }) > 0,
    );
    expect(deltaFrom212.map((m) => m.version)).toEqual(["2.13.0"]);

    const idx = MIGRATIONS.findIndex((m) => m.version === "2.13.0");
    const sql = await collectSql(idx);
    // Additive shapes only.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    // Never touches the data a v2.2 customer already has.
    expect(sql).not.toMatch(/\b(jobs|brands|generated_assets|video_revisions|publications|provider_credentials_vault|admin_users)\b\s+DROP/i);
  });
});
