export type ParleyErrorCode =
  | "invalid_argument"
  | "lease_conflict"
  | "not_found"
  | "session_finished"
  | "storage_failure"
  | "version_mismatch";

export class ParleyError extends Error {
  constructor(
    public readonly code: ParleyErrorCode,
    message: string,
    public readonly details?: Record<string, string | number | boolean>
  ) {
    super(`[${code}] ${message}`);
    this.name = "ParleyError";
  }
}

export function isParleyError(error: unknown): error is ParleyError {
  return error instanceof ParleyError;
}
