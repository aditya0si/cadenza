import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { AlbumPage } from './pages/AlbumPage';
import { AdminPage } from './pages/AdminPage';
import { ArtistPage } from './pages/ArtistPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { LibraryPage } from './pages/LibraryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaylistPage } from './pages/PlaylistPage';
import { RoomPage } from './pages/RoomPage';
import { RoomsPage } from './pages/RoomsPage';
import { SearchPage } from './pages/SearchPage';
import { SignInPage } from './pages/SignInPage';

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Restoring your session…
      </div>
    );
  }
  return isSignedIn ? children : <Navigate to="/sign-in" replace />;
}

function RequireAdmin({ children }: { children: JSX.Element }): JSX.Element {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('admin') ?? false;
  return isAdmin ? (
    children
  ) : (
    <div className="space-y-2 p-6">
      <h1 className="text-xl font-semibold">Admins only</h1>
      <p className="text-sm text-muted-foreground">
        This dashboard is backed by /api/stats/* and requires the <code>admin</code> role.
      </p>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DiscoverPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/albums/:albumId" element={<AlbumPage />} />
        <Route path="/artists/:artistId" element={<ArtistPage />} />
        <Route path="/playlists/:playlistId" element={<PlaylistPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
