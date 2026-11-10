import { LayoutDashboard, Map as MapIcon, Megaphone, Shield, Users } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Page, PageHeader, Spinner } from '../components/ui';
import { Container } from './Shell';

const TABS = [
  { to: '/admin', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/challenges', end: false, label: 'Challenges', icon: MapIcon },
  { to: '/admin/users', end: false, label: 'Pirates', icon: Users },
  { to: '/admin/announcements', end: false, label: 'Announcements', icon: Megaphone },
];

export default function AdminLayout() {
  return (
    <Page>
      <Container>
        <PageHeader title="Admiral's Bridge" subtitle="Admin panel — organizers only" icon={<Shield className="h-5 w-5" aria-hidden="true" />} />
        <nav aria-label="Admin sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-accent-500/20">
          {TABS.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `-mb-px flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                  isActive ? 'border-accent-400 bg-accent-500/10 text-accent-200' : 'border-transparent text-slate-300 hover:bg-navy-800 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </Container>
    </Page>
  );
}
