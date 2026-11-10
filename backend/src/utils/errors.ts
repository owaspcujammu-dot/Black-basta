/** An error that is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = (message = 'You must board the ship first. Please log in.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = "Marine territory. You don't have permission to enter this area.") => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Lost at sea. That resource does not exist.') => new HttpError(404, 'NOT_FOUND', message);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

/** Parses a positive integer route parameter, or throws a 404 (never a 500). */
export function idParam(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) throw notFound();
  const id = Number(raw);
  if (id < 1) throw notFound();
  return id;
}
