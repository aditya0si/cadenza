import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SignInPage } from './SignInPage';

const signInWithDemo = vi.fn(async () => undefined);
const authState = {
  mode: 'demo' as 'demo' | 'clerk',
  isLoaded: true,
  isSignedIn: false,
  user: null,
  description: 'demo',
  signInWithDemo,
  signOut: vi.fn(async () => undefined),
};

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
  ClerkSignInScreen: () => <div>Clerk sign-in</div>,
  resolveAuthMode: () => 'demo',
  AuthRoot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CLERK_PUBLISHABLE_KEY: '',
}));

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSignedIn = false;
  authState.mode = 'demo';
});

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <SignInPage />
    </MemoryRouter>,
  );
};

describe('SignInPage (demo mode)', () => {
  it('offers the two demo personas and explains the demo auth mode', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Demo Listener/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cadenza Admin/ })).toBeInTheDocument();
    expect(screen.getByText(/DEMO MODE|demo auth mode/i)).toBeInTheDocument();
  });

  it('prefills the form from the selected persona and signs in', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Cadenza Admin/ }));
    expect(screen.getByLabelText('Email')).toHaveValue('admin@cadenza.dev');
    await user.click(screen.getByRole('button', { name: 'Enter CADENZA' }));
    expect(signInWithDemo).toHaveBeenCalledWith('admin@cadenza.dev', 'Cadenza Admin');
  });

  it('surfaces a sign-in failure', async () => {
    const user = userEvent.setup();
    signInWithDemo.mockRejectedValueOnce(new Error('Demo session token has expired'));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Enter CADENZA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demo session token has expired');
  });

  it('renders the Clerk screen when the app is configured for real Clerk auth', () => {
    authState.mode = 'clerk';
    renderPage();
    expect(screen.getByText('Clerk sign-in')).toBeInTheDocument();
  });

  it('redirects away once the session exists', () => {
    authState.isSignedIn = true;
    render(
      <MemoryRouter initialEntries={['/sign-in']}>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Enter CADENZA' })).not.toBeInTheDocument();
  });
});
