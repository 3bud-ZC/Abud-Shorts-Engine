import cuid from "cuid";
import type { V2Database } from "../db";

export type RevisionKind = "initial" | "voice" | "media" | "caption" | "full";

export type VideoRevisionRecord = {
  id: string;
  projectId: string;
  revisionNumber: number;
  parentRevisionId?: string;
  sourceJobId?: string;
  outputVideoId?: string;
  status: "queued" | "rendering" | "ready" | "failed";
  reason?: string;
  changeType: RevisionKind;
  changedFields: Record<string, unknown>;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
};

type RevisionRow = {
  id: string;
  project_id: string;
  revision_number: number;
  parent_revision_id?: string;
  source_job_id?: string;
  output_video_id?: string;
  status: "queued" | "rendering" | "ready" | "failed";
  reason?: string;
  change_type: RevisionKind;
  changed_fields: Record<string, unknown>;
  is_final: boolean;
  created_at: Date;
  updated_at: Date;
};

export class RevisionService {
  constructor(private db: V2Database) {}

  public async ensureInitialRevision(input: {
    projectId: string;
    sourceJobId?: string;
    outputVideoId?: string;
  }): Promise<VideoRevisionRecord> {
    const existing = await this.listRevisions(input.projectId);
    if (existing.length > 0) return existing[0];

    const id = cuid();
    const rows = await this.db.query<RevisionRow>(
      `INSERT INTO video_revisions (
        id, project_id, revision_number, source_job_id, output_video_id, status,
        reason, change_type, changed_fields, is_final, created_at, updated_at
      ) VALUES ($1,$2,1,$3,$4,'ready','Initial generated video','initial',$5,true,now(),now())
      RETURNING *`,
      [id, input.projectId, input.sourceJobId || null, input.outputVideoId || input.projectId, JSON.stringify({})],
    );
    return this.map(rows[0]);
  }

  public async createRevision(input: {
    id?: string;
    projectId: string;
    parentRevisionId?: string;
    sourceJobId?: string;
    outputVideoId?: string;
    reason?: string;
    changeType: RevisionKind;
    changedFields: Record<string, unknown>;
    status?: "queued" | "rendering" | "ready" | "failed";
  }): Promise<VideoRevisionRecord> {
    const latest = await this.db.query<{ max: string | null }>(
      "SELECT MAX(revision_number)::text AS max FROM video_revisions WHERE project_id = $1",
      [input.projectId],
    );
    const revisionNumber = Number(latest[0]?.max || 0) + 1;
    const id = input.id || cuid();
    const rows = await this.db.query<RevisionRow>(
      `INSERT INTO video_revisions (
        id, project_id, revision_number, parent_revision_id, source_job_id, output_video_id,
        status, reason, change_type, changed_fields, is_final, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,now(),now())
      RETURNING *`,
      [
        id,
        input.projectId,
        revisionNumber,
        input.parentRevisionId || null,
        input.sourceJobId || null,
        input.outputVideoId || null,
        input.status || "queued",
        input.reason || null,
        input.changeType,
        JSON.stringify(input.changedFields || {}),
      ],
    );
    return this.map(rows[0]);
  }

  public async listRevisions(projectId: string): Promise<VideoRevisionRecord[]> {
    const rows = await this.db.query<RevisionRow>(
      "SELECT * FROM video_revisions WHERE project_id = $1 ORDER BY revision_number ASC",
      [projectId],
    );
    return rows.map((row) => this.map(row));
  }

  public async markFinal(projectId: string, revisionId: string): Promise<VideoRevisionRecord | null> {
    await this.db.query("UPDATE video_revisions SET is_final = false WHERE project_id = $1", [projectId]);
    const rows = await this.db.query<RevisionRow>(
      `UPDATE video_revisions
       SET is_final = true, updated_at = now()
       WHERE project_id = $1 AND id = $2
       RETURNING *`,
      [projectId, revisionId],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  public async getFinal(projectId: string): Promise<VideoRevisionRecord | null> {
    const rows = await this.db.query<RevisionRow>(
      "SELECT * FROM video_revisions WHERE project_id = $1 AND is_final = true LIMIT 1",
      [projectId],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  public async markRevisionReadyForJob(sourceJobId: string, outputVideoId: string): Promise<VideoRevisionRecord | null> {
    const rows = await this.db.query<RevisionRow>(
      `UPDATE video_revisions
       SET status = 'ready',
           output_video_id = $2,
           updated_at = now()
       WHERE source_job_id = $1
       RETURNING *`,
      [sourceJobId, outputVideoId],
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  private map(row: RevisionRow): VideoRevisionRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      revisionNumber: row.revision_number,
      parentRevisionId: row.parent_revision_id || undefined,
      sourceJobId: row.source_job_id || undefined,
      outputVideoId: row.output_video_id || undefined,
      status: row.status,
      reason: row.reason || undefined,
      changeType: row.change_type,
      changedFields: row.changed_fields || {},
      isFinal: row.is_final,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
