import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ClerkSignInScreen, useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ErrorNote } from '../components/ui/feedback';
import { Input, Label } from '../components/ui/input';

const PERSONAS = [
  { email: 'demo@cadenza.dev', displayName: 'Demo Listener', blurb: 'Listener account with the starter playlists and room.' },
  { email: 'admin@cadenza.dev', displayName: 'Cadenza Admin', blurb: 'Admin account — unlocks the /admin stats dashboard.' },
];

export function SignInPage(): JSX.Element {
  const { isSignedIn, mode, signInWithDemo } = useAuth();
  const [email, setEmail] = useState(PERSONAS[0]?.email ?? '');
  const [displayName, setDisplayName] = useState(PERSONAS[0]?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isSignedIn) return <Navigate to="/" replace />;

  if (mode === 'clerk') {
    return (
      <div className="min-h-screen">
        <header className="border-b border-border px-6 py-4">
          <p className="text-sm font-semibold tracking-[0.3em]">CADENZA</p>
        </header>
        <ClerkSignInScreen />
      </div>
    );
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithDemo(email.trim(), displayName.trim() || undefined);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <header className="space-y-1 text-center">
          <p className="text-sm font-semibold tracking-[0.3em]">CADENZA</p>
          <h1 className="text-2xl font-semibold">Sign in to listen together</h1>
          <p className="text-sm text-muted-foreground">
            This build has no Clerk keys configured, so it runs with the API&apos;s demo auth mode. The production path
            (Clerk session tokens) stays wired behind <code>VITE_AUTH_MODE=clerk</code>.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Choose a demo persona</CardTitle>
            <CardDescription>Sessions are signed locally by the API and expire after 12 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {PERSONAS.map((persona) => (
                <button
                  key={persona.email}
                  type="button"
                  onClick={() => {
                    setEmail(persona.email);
                    setDisplayName(persona.displayName);
                  }}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent ${
                    email === persona.email ? 'border-primary' : 'border-border'
                  }`}
                >
                  <span className="block font-medium">{persona.displayName}</span>
                  <span className="block text-xs text-muted-foreground">{persona.email}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{persona.blurb}</span>
                </button>
              ))}
            </div>

            <form className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={80}
                />
              </div>
              {error ? <ErrorNote message={error} /> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Enter CADENZA'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
