import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ErrorScreen } from '../pages/ErrorPages';
import { Spinner } from './ui';

/** Routes that need a logged-in pirate. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your papers…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/**
 * Routes for admins only. This is a convenience for the UI — the real
 * enforcement is on the server, which rejects every /api/admin call from a
 * non-admin regardless of what the browser renders.
 */
export function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your papers…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'admin') return <ErrorScreen code={403} />;
  return <Outlet />;
}

/** Login / register: already-authenticated users are sent to their deck. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Checking your papers…" />;
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  return <Outlet />;
}

interface BoundaryState {
  failed: boolean;
}

/** Catches render errors and shows the 500 — SHIPWRECK page instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <ErrorScreen code={500} standalone />;
    return this.props.children;
  }
}
