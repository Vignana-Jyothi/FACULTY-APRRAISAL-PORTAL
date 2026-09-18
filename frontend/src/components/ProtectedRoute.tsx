import { Navigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../store/authStore';
import Layout from './Layout';

interface Props {
  children: React.ReactNode;
  roles?: readonly Role[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user } = useAuthStore();

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.some((r) => user.roles.some((ur) => ur.role === r))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Layout>{children}</Layout>;
}
