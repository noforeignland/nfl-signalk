/**
 * Error-message helpers for network failures.
 *
 * node-fetch v2 builds its FetchError message as
 * `request to ${url} failed, reason: ${systemError.message}`. For many
 * low-level socket failures (ECONNRESET, premature close, socket hang up)
 * the wrapped system error carries an empty `.message`, so the reason comes
 * out blank and the user sees `...failed, reason: ` with nothing useful.
 * The diagnostic code (ECONNRESET, ETIMEDOUT, ENOTFOUND, …) lives on the
 * FetchError's own `.code` / `.errno` / `.type` fields instead.
 */

interface FetchErrorLike {
  message: string;
  code?: unknown;
  errno?: unknown;
  type?: unknown;
}

function isFetchErrorLike(err: unknown): err is FetchErrorLike {
  return typeof err === 'object' && err !== null && 'message' in err;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Produce a human-readable, non-empty description of a thrown error.
 *
 * If the error is a node-fetch FetchError whose reason is blank, the
 * diagnostic code from `.code` / `.errno` / `.type` is substituted in so the
 * status the user sees is actionable instead of empty.
 */
export function describeFetchError(err: unknown): string {
  if (!isFetchErrorLike(err)) {
    return 'Unknown error';
  }

  const message = err.message;
  const trimmed = message.trimEnd();

  // Only intervene when the message ends with a blank reason.
  if (!trimmed.endsWith('reason:')) {
    return message.length > 0 ? message : 'Unknown error';
  }

  const detail =
    asNonEmptyString(err.code) ?? asNonEmptyString(err.errno) ?? asNonEmptyString(err.type);

  return detail
    ? `${trimmed} ${detail}`
    : `${trimmed} connection error (no further detail from the network layer)`;
}
