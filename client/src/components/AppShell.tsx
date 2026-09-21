import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Compass, ListMusic, Radio, Search, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/feedback';
import { PresenceAvatar } from './ui/avatar';
import { PlayerBar } from './PlayerBar';
import type { HealthDto } from '../types';

const navItems = [
  { to: '/', label: 'Discover', icon: Compass, end: true },
  { to: '/search', label: 'Search', icon: Search, end: false },
  { to: '/library', label: 'Library', icon: ListMusic, end: false },
  { to: '/rooms', label: 'Rooms', icon: Radio, end: false },
];

export function DemoModeBanner(): JSX.Element | null {
  const { mode } = useAuth();
  const [health, setHealth] = useState<HealthDto | null>(null);

  useEffect(() => {
    if (mode !== 'demo') return;
    let cancelled = false;
    void api
      .health()
      .then((response) => {
        if (!cancelled) setHealth(response);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (mode !== 'demo') return null;
  return (
    <div
      role="status"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200"
    >
      <strong className="font-semibold">DEMO MODE</strong> — you are signed in with a locally-signed demo session
      {health ? ` (API auth mode: ${health.authMode})` : ''}, not with Clerk. Set{' '}
      <code className="rounded bg-black/30 px-1">AUTH_MODE=clerk</code> and{' '}
      <code className="rounded bg-black/30 px-1">VITE_CLERK_PUBLISHABLE_KEY</code> for real authentication.
    </div>
  );
}

export function AppShell(): JSX.Element {
  const { user, signOut, description } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.roles.includes('admin') ?? false;

  return (
    <div className="flex min-h-screen flex-col">
      <DemoModeBanner />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border p-4 md:block">
          <div className="mb-6 flex items-center gap-2">
            <span aria-hidden="true" className="text-2xl">
              ♪
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[0.2em]">CADENZA</p>
              <p className="text-[11px] text-muted-foreground">collaborative listening</p>
            </div>
          </div>
          <nav aria-label="Primary" className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            {isAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Admin
              </NavLink>
            ) : null}
          </nav>
          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
            Shortcuts: <kbd>space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> seek · <kbd>n</kbd>/<kbd>p</kbd> next/prev
          </p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="md:hidden">
              <p className="text-sm font-semibold tracking-[0.2em]">CADENZA</p>
            </div>
            <nav aria-label="Mobile" className="flex items-center gap-1 md:hidden">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  className={({ isActive }) =>
                    cn('rounded-md p-2 text-muted-foreground', isActive && 'bg-accent text-foreground')
                  }
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {user ? (
                <>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-medium">{user.displayName}</p>
                    <p className="text-[11px] text-muted-foreground">{user.email}</p>
                  </div>
                  <PresenceAvatar displayName={user.displayName} avatarUrl={user.avatarUrl} />
                  <Badge>{user.roles.join(' · ')}</Badge>
                </>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void signOut().then(() => navigate('/sign-in'));
                }}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </Button>
            </div>
          </header>
          <p className="sr-only">{description}</p>

          <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-32 pt-6 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
      <PlayerBar />
    </div>
  );
}
