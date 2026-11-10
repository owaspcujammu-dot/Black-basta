/**
 * Page chunks, loaded on demand. The same loader functions feed React.lazy and
 * the idle-time preload, so a preloaded page opens instantly.
 */
export const pageLoaders = {
  Login: () => import('./Login'),
  Register: () => import('./Register'),
  Rules: () => import('./Rules'),
  Scoreboard: () => import('./Scoreboard'),
  Dashboard: () => import('./Dashboard'),
  Challenges: () => import('./Challenges'),
  Profile: () => import('./Profile'),
};

/** Only ever requested for admins: participants never download the admin panel. */
export const adminLoaders = {
  AdminLayout: () => import('../layouts/AdminLayout'),
  AdminDashboard: () => import('./admin/AdminDashboard'),
  AdminChallenges: () => import('./admin/AdminChallenges'),
  AdminUsers: () => import('./admin/AdminUsers'),
  AdminAnnouncements: () => import('./admin/AdminAnnouncements'),
};

/** Downloads the pages this visitor can open, once the browser is idle. */
export function preloadPages(role: 'guest' | 'participant' | 'admin') {
  const loaders = [...Object.values(pageLoaders), ...(role === 'admin' ? Object.values(adminLoaders) : [])];
  const run = () => loaders.forEach((load) => void load().catch(() => undefined));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
