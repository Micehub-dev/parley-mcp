export type ParleyErrorCode =
  | "invalid_argument"
  | "lease_conflict"
  | "not_found"
  | "participant_failure"
  | "session_finished"
  | "storage_failure"
  | "version_mismatch";

export type ParleyErrorDetailValue = string | number | boolean | null;

export class ParleyError extends Error {
  constructor(
    public readonly code: ParleyErrorCode,
    message: string,
    public readonly details?: Record<string, ParleyErrorDetailValue>
  ) {
    super(`[${code}] ${message}`);
    this.name = "ParleyError";
  }
}

export function isParleyError(error: unknown): error is ParleyError {
  return error instanceof ParleyError;
}
