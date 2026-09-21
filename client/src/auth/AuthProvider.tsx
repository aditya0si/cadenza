import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignedIn, SignedOut, useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react';
import { api, setTokenGetter } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import type { UserDto } from '../types';

export type AuthMode = 'clerk' | 'demo';

export interface AuthState {
  mode: AuthMode;
  isLoaded: boolean;
  isSignedIn: boolean;
  user: UserDto | null;
  /** Human-readable description of how the session was obtained. */
  description: string;
  signInWithDemo: (email: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = (): AuthState => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};

export const CLERK_PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? '';

/**
 * Which auth mode the app runs in. `VITE_AUTH_MODE` wins; otherwise Clerk is
 * used when a publishable key exists and demo sessions otherwise, so a bare
 * `npm run build && npm run preview` is always clickable.
 */
export const resolveAuthMode = (): AuthMode => {
  const configured = import.meta.env.VITE_AUTH_MODE as string | undefined;
  if (configured === 'clerk' || configured === 'demo') return configured;
  return CLERK_PUBLISHABLE_KEY ? 'clerk' : 'demo';
};

const DEMO_TOKEN_KEY = 'cadenza.demo.token';
const DEMO_USER_KEY = 'cadenza.demo.user';

/** Demo mode: sessions are minted by POST /api/auth/demo-session (AUTH_MODE=demo). */
function DemoAuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(DEMO_TOKEN_KEY));
  const [user, setUser] = useState<UserDto | null>(() => {
    const stored = localStorage.getItem(DEMO_USER_KEY);
    return stored ? (JSON.parse(stored) as UserDto) : null;
  });
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setTokenGetter(() => localStorage.getItem(DEMO_TOKEN_KEY));
  }, []);

  // Validate a stored session once on boot; a stale token is simply dropped.
  useEffect(() => {
    let cancelled = false;
    const verify = async (): Promise<void> => {
      const stored = localStorage.getItem(DEMO_TOKEN_KEY);
      if (!stored) {
        if (!cancelled) setIsLoaded(true);
        return;
      }
      try {
        const response = await api.me();
        if (cancelled) return;
        setUser(response.user);
        localStorage.setItem(DEMO_USER_KEY, JSON.stringify(response.user));
      } catch {
        localStorage.removeItem(DEMO_TOKEN_KEY);
        localStorage.removeItem(DEMO_USER_KEY);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };
    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithDemo = useCallback(async (email: string, displayName?: string) => {
    const response = await api.demoSignIn(email, displayName);
    localStorage.setItem(DEMO_TOKEN_KEY, response.token);
    localStorage.setItem(DEMO_USER_KEY, JSON.stringify(response.user));
    setToken(response.token);
    setUser(response.user);
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEMO_TOKEN_KEY);
    localStorage.removeItem(DEMO_USER_KEY);
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'demo',
      isLoaded,
      isSignedIn: token !== null && user !== null,
      user,
      description: 'Demo sessions — signed locally by the API, not by Clerk',
      signInWithDemo,
      signOut,
    }),
    [isLoaded, token, user, signInWithDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Clerk mode: real Clerk session tokens are handed to the API and the socket. */
function ClerkAuthBridge({ children }: { children: ReactNode }): JSX.Element {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  const value = useMemo<AuthState>(() => {
    const mapped: UserDto | null = user
      ? {
          id: user.id,
          email: user.primaryEmailAddress?.emailAddress ?? '',
          displayName: user.fullName ?? user.username ?? 'Listener',
          avatarUrl: user.imageUrl ?? null,
          roles: Array.isArray(user.publicMetadata?.roles) ? (user.publicMetadata.roles as string[]) : ['listener'],
          createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      : null;
    return {
      mode: 'clerk',
      isLoaded: isLoaded ?? false,
      isSignedIn: isSignedIn === true,
      user: mapped,
      description: 'Clerk session tokens verified by the API',
      signInWithDemo: async () => {
        throw new Error('Demo sign-in is disabled because VITE_AUTH_MODE=clerk');
      },
      signOut: async () => {
        disconnectSocket();
        await clerk.signOut();
      },
    };
  }, [isLoaded, isSignedIn, user, clerk]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Chooses the provider at the root. Real Clerk stays wired for real keys; the
 * demo provider exists only when the app is explicitly configured for it.
 */
export function AuthRoot({ children, mode }: { children: ReactNode; mode: AuthMode }): JSX.Element {
  if (mode === 'clerk') {
    return (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        <ClerkAuthBridge>{children}</ClerkAuthBridge>
      </ClerkProvider>
    );
  }
  return <DemoAuthProvider>{children}</DemoAuthProvider>;
}

/** Sign-in screen for Clerk mode (demo mode uses the in-app persona picker). */
export function ClerkSignInScreen(): JSX.Element {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to CADENZA</h1>
        <SignedOut>
          <SignIn routing="hash" />
        </SignedOut>
        <SignedIn>
          <p className="text-muted-foreground text-sm">Signed in. Loading your library…</p>
        </SignedIn>
      </div>
    </div>
  );
}
