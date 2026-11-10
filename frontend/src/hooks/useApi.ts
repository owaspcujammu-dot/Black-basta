import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../services/api';

interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/**
 * GET a resource and keep it in state. Refetches when `path` or any value in
 * `deps` changes (e.g. a version counter bumped by a server push).
 * Pass `null` as the path to skip the request.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    // Background refreshes keep showing the current data instead of a spinner.
    if (loadedPath.current !== path) setLoading(true);

    api
      .get<T>(path, controller.signal)
      .then((result) => {
        loadedPath.current = path;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong aboard the ship.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
