import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, type Role } from '../store/authStore';
import Layout from './Layout';
import { FORCE_PASSWORD_PATH } from '../api/client';

interface Props {
  children: React.ReactNode;
  roles?: readonly Role[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user } = useAuthStore();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;

  // Someone else chose this password (bulk import / admin create): nothing but
  // the profile page's change-password form until it is replaced. The server
  // enforces the same thing (403 PASSWORD_CHANGE_REQUIRED); this just avoids a
  // screen full of refused requests.
  // Narrow cast: `mustChangePassword` comes from the login and /me payloads but
  // is not declared on AuthUser (authStore.ts is owned by another change).
  const mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword === true;
  if (mustChangePassword && location.pathname !== '/profile') {
    return <Navigate to={FORCE_PASSWORD_PATH} replace />;
  }

  if (roles && !roles.some((r) => user.roles.some((ur) => ur.role === r))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Layout>{children}</Layout>;
}
