import fs from "fs";
import path from "path";
import { z } from "zod";

/**
 * The update transaction record.
 *
 * The host updater owns this file; the application only ever reads it. That is
 * deliberate - the web application has no Docker access, so the only honest way
 * for the Update Center to report "an update was attempted and rolled back" is
 * to read what the host-side updater persisted in the shared data directory.
 *
 * The file also survives an interrupted run. If the terminal is closed or the
 * machine reboots mid-update, the next `abud-shorts update` finds a transaction
 * that never reached SUCCESS, FAILED or ROLLED_BACK and offers recovery instead
 * of starting a second half-update on top of the first.
 */

export const UPDATE_STATES = [
  "PREPARING",
  "BACKED_UP",
  "APPLYING",
  "VERIFYING",
  "SUCCESS",
  "FAILED",
  "ROLLING_BACK",
  "ROLLED_BACK",
] as const;

export type UpdateState = (typeof UPDATE_STATES)[number];

/** States that mean the updater is no longer running and nothing is half-applied. */
export const TERMINAL_UPDATE_STATES: UpdateState[] = ["SUCCESS", "FAILED", "ROLLED_BACK"];

export function isTerminalUpdateState(state: UpdateState): boolean {
  return TERMINAL_UPDATE_STATES.includes(state);
}

export const updateTransactionSchema = z.object({
  transactionId: z.string().min(1),
  state: z.enum(UPDATE_STATES),
  /**
   * Whether this transaction was an update or an administrator asking to go
   * back. Both end in ROLLED_BACK, but only one of them is a failure, and the
   * Update Center must not describe a deliberate rollback as an update that
   * "did not complete". Optional so records written before this field existed
   * still parse.
   */
  kind: z.enum(["update", "rollback"]).optional(),
  channel: z.enum(["stable", "development"]),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  schemaVersion: z.string().optional(),
  backupId: z.string().optional(),
  imageDigest: z.string().optional(),
  packageSha256: z.string().optional(),
  error: z.string().optional(),
  rollback: z
    .object({
      attempted: z.boolean(),
      result: z.enum(["succeeded", "failed", "not_required"]),
      restoredVersion: z.string().optional(),
      databaseRestored: z.boolean().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type UpdateTransaction = z.infer<typeof updateTransactionSchema>;

export const updateStateFileSchema = z.object({
  current: updateTransactionSchema.optional(),
  lastSuccessful: updateTransactionSchema.optional(),
  history: z.array(updateTransactionSchema).default([]),
});

export type UpdateStateFile = z.infer<typeof updateStateFileSchema>;

export const UPDATE_STATE_RELATIVE_PATH = path.join("updates", "update-state.json");

export function updateStatePath(dataDir: string): string {
  return path.join(dataDir, UPDATE_STATE_RELATIVE_PATH);
}

const EMPTY_STATE: UpdateStateFile = { history: [] };

/**
 * Reads the host updater's record. A missing file simply means no update has
 * ever run here; a corrupt one is reported as empty rather than crashing the
 * Update Center, because the state file is not a source of truth the
 * application can repair.
 */
export function readUpdateState(dataDir: string): UpdateStateFile {
  const file = updateStatePath(dataDir);
  try {
    if (!fs.existsSync(file)) return EMPTY_STATE;
    const parsed = updateStateFileSchema.safeParse(
      JSON.parse(stripByteOrderMark(fs.readFileSync(file, "utf-8"))),
    );
    return parsed.success ? parsed.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * This file is written by the host updater, not by the application, and on
 * Windows that means PowerShell - which writes UTF-8 with a byte order mark.
 * JSON.parse rejects a leading BOM outright, so without this the Update Center
 * would silently report "no update has ever run here" on every Windows
 * installation that had in fact just updated.
 */
export function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * True when a previous run stopped in a non-terminal state. Used both by the
 * Update Center (to warn the operator) and by the host updater (to resume).
 */
export function hasIncompleteTransaction(state: UpdateStateFile): boolean {
  return Boolean(state.current && !isTerminalUpdateState(state.current.state));
}
