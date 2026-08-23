import crypto from "crypto";
import cuid from "cuid";
import { V2Database } from "../db";

export const API_TOKEN_SCOPES = [
  "production:create",
  "production:read",
  "videos:read",
  "publishing:write",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export type ApiTokenRecord = {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

type ApiTokenRow = {
  id: string;
  name: string;
  scopes: string[];
  last_used_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function mapRow(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    name: row.name,
    scopes: (row.scopes || []).filter((scope): scope is ApiTokenScope =>
      (API_TOKEN_SCOPES as readonly string[]).includes(scope),
    ),
    lastUsedAt: row.last_used_at || undefined,
    revokedAt: row.revoked_at || undefined,
    createdAt: row.created_at,
  };
}

export class ApiTokenService {
  constructor(private db: V2Database) {}

  public async createToken(name: string, scopes: string[]): Promise<ApiTokenRecord & { token: string }> {
    const cleanName = String(name || "").trim();
    if (cleanName.length < 2 || cleanName.length > 120) {
      throw new Error("Token name must be between 2 and 120 characters.");
    }
    const cleanScopes = Array.from(new Set(scopes)).filter((scope): scope is ApiTokenScope =>
      (API_TOKEN_SCOPES as readonly string[]).includes(scope),
    );
    if (cleanScopes.length === 0) {
      throw new Error("At least one valid API token scope is required.");
    }

    const id = cuid();
    const token = `ase_${crypto.randomBytes(32).toString("base64url")}`;
    const rows = await this.db.query<ApiTokenRow>(
      `INSERT INTO api_tokens (id, name, token_hash, scopes, created_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id, name, scopes, last_used_at, revoked_at, created_at`,
      [id, cleanName, hashToken(token), JSON.stringify(cleanScopes)],
    );

    return { ...mapRow(rows[0]), token };
  }

  public async listTokens(): Promise<ApiTokenRecord[]> {
    const rows = await this.db.query<ApiTokenRow>(
      `SELECT id, name, scopes, last_used_at, revoked_at, created_at
       FROM api_tokens
       ORDER BY created_at DESC`,
    );
    return rows.map(mapRow);
  }

  public async revokeToken(id: string): Promise<ApiTokenRecord | null> {
    const rows = await this.db.query<ApiTokenRow>(
      `UPDATE api_tokens
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1
       RETURNING id, name, scopes, last_used_at, revoked_at, created_at`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  public async validateToken(token: string, requiredScope?: ApiTokenScope): Promise<{
    valid: boolean;
    forbidden: boolean;
    token?: ApiTokenRecord;
  }> {
    if (!token || !token.startsWith("ase_")) {
      return { valid: false, forbidden: false };
    }

    const rows = await this.db.query<ApiTokenRow>(
      `SELECT id, name, scopes, last_used_at, revoked_at, created_at
       FROM api_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row || row.revoked_at) {
      return { valid: false, forbidden: false };
    }
    const record = mapRow(row);
    if (requiredScope && !record.scopes.includes(requiredScope)) {
      return { valid: false, forbidden: true, token: record };
    }

    await this.db.query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [record.id]);
    return { valid: true, forbidden: false, token: record };
  }
}
