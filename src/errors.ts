export type DebateErrorCode =
  | "invalid_argument"
  | "lease_conflict"
  | "not_found"
  | "session_finished"
  | "storage_failure"
  | "version_mismatch";

export class DebateError extends Error {
  constructor(
    public readonly code: DebateErrorCode,
    message: string,
    public readonly details?: Record<string, string | number | boolean>
  ) {
    super(`[${code}] ${message}`);
    this.name = "DebateError";
  }
}

export function isDebateError(error: unknown): error is DebateError {
  return error instanceof DebateError;
}
