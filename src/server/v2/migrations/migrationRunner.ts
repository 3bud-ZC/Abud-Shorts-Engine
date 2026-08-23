import { Pool } from "pg";
import { logger } from "../../../logger";

export interface Migration {
  version: string;
  name: string;
  up: (pool: Pool) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "2.0.0",
    name: "initial_v2_core_schema",
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          current_stage TEXT NOT NULL DEFAULT 'Queued',
          title TEXT,
          template_id TEXT,
          brand_name TEXT,
          input JSONB NOT NULL,
          output JSONB,
          error TEXT,
          technical_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS job_events (
          id BIGSERIAL PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL,
          stage TEXT NOT NULL,
          message TEXT NOT NULL,
          technical_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS provider_settings (
          provider TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          encrypted_secret TEXT,
          metadata JSONB,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS generated_assets (
          id TEXT PRIMARY KEY,
          job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
          video_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          path TEXT NOT NULL,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS brands (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          watermark_text TEXT NOT NULL DEFAULT '',
          primary_color TEXT NOT NULL DEFAULT '#24545a',
          accent_color TEXT NOT NULL DEFAULT '#d28b4c',
          caption_style TEXT NOT NULL DEFAULT 'bold',
          include_outro BOOLEAN NOT NULL DEFAULT true,
          outro_text TEXT NOT NULL DEFAULT '',
          contact_text TEXT NOT NULL DEFAULT '',
          is_default BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, id);
        CREATE INDEX IF NOT EXISTS idx_generated_assets_video_id ON generated_assets(video_id);
        CREATE INDEX IF NOT EXISTS idx_brands_default ON brands(is_default);
      `);
    },
  },
  {
    version: "2.2.0",
    name: "v2_production_spec_extensions",
    up: async (pool: Pool) => {
      await pool.query(`
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS creation_mode TEXT DEFAULT 'template';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_prompt TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS production_spec JSONB;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_provider TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ai_model TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visual_mode TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visual_providers_used TEXT[];
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_provider TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quality_profile TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS resolution TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS aspect_ratio TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS language TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dialect TEXT;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cost_estimate JSONB;
        ALTER TABLE provider_settings ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
      `);
    },
  },
  {
    version: "2.4.0",
    name: "v2_publishing_and_scheduling",
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS social_accounts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          account_name TEXT NOT NULL,
          account_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          connection_status TEXT NOT NULL DEFAULT 'connected',
          capabilities JSONB NOT NULL DEFAULT '{}',
          encrypted_credentials TEXT,
          last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS publications (
          id TEXT PRIMARY KEY,
          video_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          title TEXT,
          caption TEXT,
          description TEXT,
          hashtags JSONB NOT NULL DEFAULT '[]',
          metadata JSONB NOT NULL DEFAULT '{}',
          scheduled_at TIMESTAMPTZ,
          published_at TIMESTAMPTZ,
          source_timezone TEXT NOT NULL DEFAULT 'UTC',
          provider TEXT NOT NULL,
          provider_post_id TEXT,
          provider_url TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          technical_error TEXT,
          idempotency_key TEXT UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS scheduled_publications (
          id TEXT PRIMARY KEY,
          publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL,
          scheduled_at TIMESTAMPTZ NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          status TEXT NOT NULL DEFAULT 'pending',
          locked_at TIMESTAMPTZ,
          locked_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS publishing_attempts (
          id BIGSERIAL PRIMARY KEY,
          publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          technical_error TEXT,
          provider_response JSONB,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS publishing_events (
          id BIGSERIAL PRIMARY KEY,
          publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          stage TEXT NOT NULL,
          message TEXT NOT NULL,
          technical_message TEXT,
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS automation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          event_trigger TEXT NOT NULL,
          platforms JSONB NOT NULL DEFAULT '[]',
          account_ids JSONB NOT NULL DEFAULT '[]',
          conditions JSONB NOT NULL DEFAULT '{}',
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_publications_video_id ON publications(video_id);
        CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
        CREATE INDEX IF NOT EXISTS idx_scheduled_pub_status_time ON scheduled_publications(status, scheduled_at ASC);
        CREATE INDEX IF NOT EXISTS idx_pub_attempts_pub_id ON publishing_attempts(publication_id);
        CREATE INDEX IF NOT EXISTS idx_pub_events_pub_id ON publishing_events(publication_id, id);
      `);
    },
  },
  {
    version: "2.5.0",
    name: "v2_enterprise_auth_backups_diagnostics_webhooks",
    up: async (pool: Pool) => {
      await pool.query(`
        -- System Settings & Setup State
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- Local Admin Access & Users
        CREATE TABLE IF NOT EXISTS admin_users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- Admin Sessions
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

        -- Audit Logs
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGSERIAL PRIMARY KEY,
          action TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT 'system',
          entity_type TEXT,
          entity_id TEXT,
          metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

        -- Backups Registry
        CREATE TABLE IF NOT EXISTS backups (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          filepath TEXT NOT NULL,
          type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          includes_media BOOLEAN NOT NULL DEFAULT false,
          includes_secrets BOOLEAN NOT NULL DEFAULT false,
          version TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'completed',
          manifest JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);

        -- Webhooks Subscriptions
        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          secret TEXT NOT NULL,
          events JSONB NOT NULL DEFAULT '[]',
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- Webhook Delivery History
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id BIGSERIAL PRIMARY KEY,
          webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          payload JSONB NOT NULL,
          status TEXT NOT NULL,
          response_code INTEGER,
          response_body TEXT,
          error TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_deliv_webhook_id ON webhook_deliveries(webhook_id, id DESC);
      `);
    },
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  // Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const appliedRows = await pool.query<{ version: string }>(
    `SELECT version FROM schema_migrations ORDER BY version ASC`,
  );
  const appliedSet = new Set(appliedRows.rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      logger.info(
        { version: migration.version, name: migration.name },
        "Applying database migration",
      );
      await migration.up(pool);
      await pool.query(
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now())`,
        [migration.version, migration.name],
      );
      logger.info(
        { version: migration.version, name: migration.name },
        "Database migration applied successfully",
      );
    }
  }
}
