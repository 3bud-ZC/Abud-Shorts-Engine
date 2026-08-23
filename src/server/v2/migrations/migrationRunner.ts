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
  {
    version: "2.6.0",
    name: "v2_1_voice_profiles_api_tokens_and_stage_metadata",
    up: async (pool: Pool) => {
      await pool.query(`
        ALTER TABLE brands ADD COLUMN IF NOT EXISTS voice_profile JSONB;
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage_timings JSONB NOT NULL DEFAULT '{}';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checkpoint JSONB NOT NULL DEFAULT '{}';

        CREATE TABLE IF NOT EXISTS api_tokens (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          scopes JSONB NOT NULL DEFAULT '[]',
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_jobs_updated_status ON jobs(status, updated_at DESC);
      `);
    },
  },
  {
    version: "2.7.0",
    name: "v2_1_phase3_revisions_workers_and_webhooks",
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS video_revisions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          revision_number INTEGER NOT NULL,
          parent_revision_id TEXT REFERENCES video_revisions(id) ON DELETE SET NULL,
          source_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
          output_video_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          reason TEXT,
          change_type TEXT NOT NULL,
          changed_fields JSONB NOT NULL DEFAULT '{}',
          is_final BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(project_id, revision_number)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_video_revisions_one_final
          ON video_revisions(project_id)
          WHERE is_final = true;
        CREATE INDEX IF NOT EXISTS idx_video_revisions_project
          ON video_revisions(project_id, revision_number ASC);
        CREATE INDEX IF NOT EXISTS idx_video_revisions_output
          ON video_revisions(output_video_id);

        CREATE TABLE IF NOT EXISTS worker_leases (
          worker_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'idle',
          active_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
          capabilities JSONB NOT NULL DEFAULT '{}',
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
          lease_expires_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_worker_leases_status
          ON worker_leases(status, lease_expires_at);
        CREATE INDEX IF NOT EXISTS idx_worker_leases_active_job
          ON worker_leases(active_job_id);

        ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
        ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS signature_version TEXT DEFAULT 'hmac-sha256-v1';
      `);
    },
  },
  {
    version: "2.8.0",
    name: "v2_1_durable_scene_artifacts",
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scene_artifacts (
          artifact_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          type TEXT NOT NULL,
          scene_index INTEGER NOT NULL,
          segment_index INTEGER,
          source_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
          source_revision_id TEXT REFERENCES video_revisions(id) ON DELETE SET NULL,
          provider TEXT,
          model TEXT,
          input_hash TEXT NOT NULL,
          storage_ref TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          duration_seconds DOUBLE PRECISION,
          metadata JSONB NOT NULL DEFAULT '{}',
          valid BOOLEAN NOT NULL DEFAULT true,
          superseded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_project
          ON scene_artifacts(project_id, type, scene_index);
        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_source_job
          ON scene_artifacts(source_job_id);
        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_source_revision
          ON scene_artifacts(source_revision_id);
        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_input_hash
          ON scene_artifacts(type, input_hash)
          WHERE valid = true;
      `);
    },
  },
  {
    version: "2.9.0",
    name: "v2_2_server_workflow_hardening",
    up: async (pool: Pool) => {
      await pool.query(`
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key
          ON jobs(idempotency_key)
          WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_jobs_status_created
          ON jobs(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
          ON jobs(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_today
          ON jobs(created_at DESC)
          WHERE status IN ('ready','failed','canceled','queued','preparing','generating_content','searching_assets','generating_voice','generating_captions','rendering','finalizing');

        CREATE INDEX IF NOT EXISTS idx_job_events_created
          ON job_events(job_id, created_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_generated_assets_kind_created
          ON generated_assets(kind, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_reuse
          ON scene_artifacts(project_id, type, scene_index, input_hash)
          WHERE valid = true;
        CREATE INDEX IF NOT EXISTS idx_scene_artifacts_ref_lifecycle
          ON scene_artifacts(storage_ref, valid, superseded_at);

        CREATE INDEX IF NOT EXISTS idx_worker_leases_expiry_busy
          ON worker_leases(lease_expires_at)
          WHERE status = 'busy';

        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
          ON webhook_deliveries(status, next_attempt_at)
          WHERE status = 'failed';

        CREATE INDEX IF NOT EXISTS idx_publications_schedule_lookup
          ON publications(status, scheduled_at ASC);
        CREATE INDEX IF NOT EXISTS idx_scheduled_publications_claim
          ON scheduled_publications(status, scheduled_at ASC, locked_at);
      `);
    },
  },
  {
    version: "2.10.0",
    name: "v2_2_provider_credentials_vault",
    up: async (pool: Pool) => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_credentials_vault (
          provider_id TEXT NOT NULL,
          credential_type TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          key_version INTEGER NOT NULL DEFAULT 1,
          masked_hint TEXT,
          metadata JSONB NOT NULL DEFAULT '{}',
          health TEXT NOT NULL DEFAULT 'unknown',
          configured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_tested_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (provider_id, credential_type)
        );

        CREATE INDEX IF NOT EXISTS idx_provider_credentials_health
          ON provider_credentials_vault(provider_id, health);

        CREATE TABLE IF NOT EXISTS provider_oauth_states (
          state TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          redirect_uri TEXT,
          code_verifier_hash TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expiry
          ON provider_oauth_states(provider_id, expires_at);
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
