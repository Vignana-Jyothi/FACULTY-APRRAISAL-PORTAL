import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// withCredentials so the httpOnly refresh-token cookie is sent to /api/auth.
const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Where a user who must replace an assigned password is sent. */
export const FORCE_PASSWORD_PATH = '/profile?forcePassword=1';

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    // Someone else chose this user's password and the server refuses everything
    // but the change-password flow until it is replaced. Mark the session so
    // ProtectedRoute holds them on the form, and send them there — rather than
    // letting the caller show a generic "failed" error.
    if (error.response?.status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      const { user, accessToken, login } = useAuthStore.getState();
      if (user && accessToken) {
        // Narrow cast: AuthUser does not declare mustChangePassword (authStore.ts
        // is owned by another change); the field rides along on the stored user.
        login(accessToken, { ...user, mustChangePassword: true } as typeof user);
      }
      if (window.location.pathname !== '/profile') {
        window.location.href = FORCE_PASSWORD_PATH;
      }
      // Never settle: the caller's generic error toast would only confuse — the
      // page is being replaced, or (already on /profile) the forced form is the
      // only thing the user should act on.
      return new Promise(() => {});
    }
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
