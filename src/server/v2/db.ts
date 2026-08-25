import { Pool, type QueryResultRow } from "pg";
import { Config } from "../../config";
import { logger } from "../../logger";
import { runMigrations } from "./migrations/migrationRunner";

export class V2Database {
  private pool?: Pool;

  constructor(private config: Config) {
    if (config.databaseUrl) {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        max: config.databaseMaxConnections,
        idleTimeoutMillis: config.databaseIdleTimeoutMs,
        connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
        statement_timeout: config.databaseStatementTimeoutMs,
      });
      this.pool.on("error", (error) => {
        logger.warn({ error }, "V2 database pool connection error");
      });
    }
  }

  public get enabled(): boolean {
    return Boolean(this.pool);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    if (!this.pool) {
      throw new Error("V2 database is not configured.");
    }
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  /**
   * Runs a unit of work on one connection inside a transaction.
   *
   * Needed for anything that has to be serialised across concurrent callers -
   * OAuth token refresh takes a `pg_advisory_xact_lock`, and an advisory
   * transaction lock is only held for the life of the transaction that took it,
   * so the whole sequence has to run on a single client.
   */
  public async transaction<T>(
    work: (tx: {
      query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<R[]>;
    }) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) {
      throw new Error("V2 database is not configured.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work({
        query: async <R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) => {
          const rows = await client.query<R>(text, values);
          return rows.rows;
        },
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public getPoolState(): {
    configured: boolean;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    maxConnections: number;
  } {
    return {
      configured: Boolean(this.pool),
      totalCount: this.pool?.totalCount || 0,
      idleCount: this.pool?.idleCount || 0,
      waitingCount: this.pool?.waitingCount || 0,
      maxConnections: this.config.databaseMaxConnections,
    };
  }

  public async migrate(): Promise<void> {
    if (!this.pool) return;
    await runMigrations(this.pool);
  }

  public async health(): Promise<{ ok: boolean; latencyMs?: number; message: string }> {
    if (!this.pool) {
      return { ok: false, message: "DATABASE_URL is not configured." };
    }
    const started = Date.now();
    try {
      await this.pool.query("SELECT 1");
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: "Database connection is healthy.",
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Database check failed.",
      };
    }
  }

  public async close(): Promise<void> {
    await this.pool?.end();
  }
}
