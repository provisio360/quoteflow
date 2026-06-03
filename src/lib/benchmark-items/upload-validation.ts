// Pure decision core — no framework, DB, or network imports.
//
// The brief-upload "reject before submit" gate (issue #24). A single rule,
// shared by the browser submit guard and the server action, so the message a
// user sees client-side is identical to the one the action would return. The
// file is described structurally so both a DOM File and a server File fit.

/** The minimal shape both a browser File and a server File satisfy. */
export interface UploadCandidate {
  readonly name: string;
  readonly size: number;
}

/**
 * The reason an upload selection is rejected, or `null` when it is acceptable.
 * Messages match the per-row error report's file-level entries so the gate and
 * the action speak with one voice.
 */
export function uploadProblem(file: UploadCandidate | null): string | null {
  if (file === null || file.size === 0) return "No spreadsheet uploaded";
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return "File must be a .xlsx spreadsheet";
  }
  return null;
}
