/**
 * Thin fetch wrapper for the Black Basta API.
 *  - Same-origin requests; the session lives in an HTTP-only cookie the
 *    browser attaches by itself. No token is ever stored in JavaScript.
 *  - State-changing requests carry the double-submit CSRF token.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    /** The full error details from the server (e.g. per-line problems). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function unreachable(status: number): ApiError {
  const hint = import.meta.env.DEV ? ' (Development: the API on port 5000 is not running — check its terminal, or start everything with `npm run demo`.)' : '';
  return new ApiError(status, 'UNREACHABLE', `Can't reach the game server right now. Please try again in a moment.${hint}`);
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

async function getCsrfToken(refresh = false): Promise<string> {
  if (csrfToken && !refresh) return csrfToken;
  csrfRequest ??= fetch('/api/auth/csrf', { credentials: 'same-origin' })
    .catch(() => {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the ship. Check your connection and try again.');
    })
    .then((res) => {
      if (!res.ok) throw unreachable(res.status);
      return res.json();
    })
    .then((body: { csrfToken: string }) => {
      csrfToken = body.csrfToken;
      return body.csrfToken;
    })
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Multipart upload; `body` is ignored when set. */
  formData?: FormData;
  signal?: AbortSignal;
}

async function send<T>(path: string, options: RequestOptions, retried: boolean): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = await getCsrfToken();
  if (options.body !== undefined && !options.formData) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the ship. Check your connection and try again.');
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    // A 5xx without our JSON error body comes from a proxy (Vite in development,
    // nginx in production) that could not reach the API at all.
    if (response.status >= 500 && !payload?.error) throw unreachable(response.status);
    const error = payload?.error ?? {};
    // A stale CSRF token (e.g. cookie expired): fetch a new one and retry once.
    if (response.status === 403 && error.code === 'CSRF_TOKEN' && !retried) {
      await getCsrfToken(true);
      return send<T>(path, options, true);
    }
    throw new ApiError(
      response.status,
      error.code ?? 'ERROR',
      error.message ?? (response.status >= 500 ? 'Something went wrong aboard the ship.' : 'Request failed.'),
      error.details?.fields ?? {},
      error.details,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => send<T>(path, { signal }, false),
  post: <T>(path: string, body?: unknown) => send<T>(path, { method: 'POST', body: body ?? {} }, false),
  put: <T>(path: string, body?: unknown) => send<T>(path, { method: 'PUT', body: body ?? {} }, false),
  delete: <T>(path: string) => send<T>(path, { method: 'DELETE' }, false),
  upload: <T>(path: string, formData: FormData) => send<T>(path, { method: 'POST', formData }, false),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong aboard the ship.';
}
