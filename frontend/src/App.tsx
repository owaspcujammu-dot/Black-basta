import { MotionConfig } from 'framer-motion';
import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, GuestOnly, RequireAdmin, RequireAuth } from './components/guards';
import { AuthProvider } from './context/AuthContext';
import { LiveProvider } from './context/LiveContext';
import { ToastProvider } from './context/ToastContext';
import { Shell } from './layouts/Shell';
import { ErrorScreen, NotFoundPage } from './pages/ErrorPages';
import Landing from './pages/Landing';
import { adminLoaders, pageLoaders } from './pages/loaders';

// Everything past the landing page is loaded on demand (and preloaded when idle);
// the admin panel is never downloaded by participants.
const Login = lazy(pageLoaders.Login);
const Register = lazy(pageLoaders.Register);
const Rules = lazy(pageLoaders.Rules);
const Dashboard = lazy(pageLoaders.Dashboard);
const Challenges = lazy(pageLoaders.Challenges);
const Scoreboard = lazy(pageLoaders.Scoreboard);
const Profile = lazy(pageLoaders.Profile);
const AdminLayout = lazy(adminLoaders.AdminLayout);
const AdminDashboard = lazy(adminLoaders.AdminDashboard);
const AdminChallenges = lazy(adminLoaders.AdminChallenges);
const AdminUsers = lazy(adminLoaders.AdminUsers);
const AdminAnnouncements = lazy(adminLoaders.AdminAnnouncements);

export default function App() {
  return (
    <ErrorBoundary>
      {/* JS animations follow the OS "reduce motion" setting, like the CSS ones. */}
      <MotionConfig reducedMotion="user">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <AuthProvider>
              <LiveProvider>
                <Routes>
                  <Route element={<Shell />}>
                    <Route index element={<Landing />} />
                    <Route path="rules" element={<Rules />} />
                    <Route path="scoreboard" element={<Scoreboard />} />

                    <Route element={<GuestOnly />}>
                      <Route path="login" element={<Login />} />
                      <Route path="register" element={<Register />} />
                    </Route>

                    <Route element={<RequireAuth />}>
                      <Route path="dashboard" element={<Dashboard />} />
                      <Route path="challenges" element={<Challenges />} />
                      <Route path="challenges/:id" element={<Challenges />} />
                      <Route path="practice" element={<Challenges key="practice" practice />} />
                      <Route path="practice/:id" element={<Challenges key="practice" practice />} />
                      <Route path="profile" element={<Profile />} />
                    </Route>

                    <Route element={<RequireAdmin />}>
                      <Route path="admin" element={<AdminLayout />}>
                        <Route index element={<AdminDashboard />} />
                        <Route path="challenges" element={<AdminChallenges />} />
                        <Route path="users" element={<AdminUsers />} />
                        <Route path="announcements" element={<AdminAnnouncements />} />
                      </Route>
                    </Route>

                    <Route path="403" element={<ErrorScreen code={403} />} />
                    <Route path="500" element={<ErrorScreen code={500} />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </LiveProvider>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </ErrorBoundary>
  );
}
