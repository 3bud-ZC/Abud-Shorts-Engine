import { describe, expect, it } from "vitest";
import { ProviderCredentialsVault } from "./providerCredentialsVault";

class MemoryDb {
  public rows: any[] = [];

  async query<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (sql.includes("INSERT INTO provider_credentials_vault")) {
      const existingIndex = this.rows.findIndex((row) => row.provider_id === values[0] && row.credential_type === values[1]);
      const row = {
        provider_id: values[0],
        credential_type: values[1],
        ciphertext: values[2],
        iv: values[3],
        auth_tag: values[4],
        key_version: 1,
        masked_hint: values[5],
        metadata: JSON.parse(String(values[6] || "{}")),
        health: "configured",
        configured_at: new Date("2026-08-23T00:00:00Z"),
        updated_at: new Date("2026-08-23T00:00:00Z"),
      };
      if (existingIndex >= 0) this.rows[existingIndex] = row;
      else this.rows.push(row);
      return [row] as T[];
    }
    if (sql.includes("SELECT * FROM provider_credentials_vault")) {
      return this.rows.filter((row) => row.provider_id === values[0] && row.credential_type === values[1]) as T[];
    }
    if (sql.includes("SELECT provider_id")) {
      return this.rows as T[];
    }
    if (sql.includes("DELETE FROM provider_credentials_vault")) {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.provider_id !== values[0]);
      return Array.from({ length: before - this.rows.length }, () => ({ provider_id: values[0] })) as T[];
    }
    if (sql.includes("INSERT INTO provider_oauth_states")) {
      return [] as T[];
    }
    return [] as T[];
  }
}

describe("ProviderCredentialsVault", () => {
  it("stores encrypted ciphertext and returns only masked credential metadata", async () => {
    const db = new MemoryDb();
    const vault = new ProviderCredentialsVault(db as any, {
      providerVaultMasterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    } as any);

    const saved = await vault.put({
      providerId: "pexels",
      credentialType: "api_key",
      plaintext: "px_live_secret_1234567890",
    });

    expect(saved.maskedHint).toBe("px_l••••7890");
    expect(JSON.stringify(saved)).not.toContain("px_live_secret");
    expect(db.rows[0].ciphertext).not.toContain("px_live_secret");

    const plaintext = await vault.readPlaintext("pexels", "api_key");
    expect(plaintext).toBe("px_live_secret_1234567890");
  });

  it("rejects unsupported provider credential type combinations", async () => {
    const vault = new ProviderCredentialsVault(new MemoryDb() as any, {
      providerVaultMasterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    } as any);

    await expect(vault.put({
      providerId: "youtube",
      credentialType: "api_key" as any,
      plaintext: "secret",
    })).rejects.toThrow(/not a supported credential type/);
  });
});
