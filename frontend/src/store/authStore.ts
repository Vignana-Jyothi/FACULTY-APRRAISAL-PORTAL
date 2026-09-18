import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Mirrors the backend `RoleType` enum. Keep in step with
// backend/src/utils/roles.ts — that file is the authorization source of truth
// and these helpers only decide what the UI offers to draw.
export type Role =
  | 'FACULTY'
  | 'HOD'
  | 'REVIEWER'
  | 'ADMIN'
  | 'PRINCIPAL'
  | 'DEAN'
  | 'SCRUTINIZER'
  | 'SPECIAL_SCRUTINIZER';

export const ALL_ROLES: readonly Role[] = [
  'FACULTY', 'HOD', 'REVIEWER', 'ADMIN',
  'PRINCIPAL', 'DEAN', 'SCRUTINIZER', 'SPECIAL_SCRUTINIZER',
] as const;

// Only these two are department-scoped; every other role is institute-wide and
// `assignRole` rejects a departmentId for them.
export const DEPT_SCOPED_ROLES: readonly Role[] = ['HOD', 'REVIEWER'] as const;

// Tier allocation: the dean, the 2-3 special scrutinizers they delegate to, and
// the principal who sees everything.
export const TIER_ROLES: readonly Role[] = ['DEAN', 'SPECIAL_SCRUTINIZER', 'PRINCIPAL'] as const;

// Category 6 (core values, +50) and the /550 grand total. The HoD/Reviewer enter
// them for their own department and read their own entry back; the principal
// sees them institute-wide. Dean, scrutinizers, admin and faculty never do.
export const CORE_VALUE_ROLES: readonly Role[] = ['PRINCIPAL', 'HOD', 'REVIEWER'] as const;

export interface UserRole {
  role: Role;
  departmentId: string | null;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  employeeCode: string;
  departmentId: string | null;
  roles: UserRole[];
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => void;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: readonly Role[]) => boolean;
  /** Maintenance admin ONLY — accounts, roles, email queue, audit log.
   *  Never a stand-in for "has power": an admin sees no appraisal content. */
  isAdmin: () => boolean;
  isPrincipal: () => boolean;
  isDean: () => boolean;
  /** Either flavour of scrutinizer. */
  isScrutinizer: () => boolean;
  /** May set a faculty's tier / eligibility and run the quarterly snapshot. */
  canAllocateTier: () => boolean;
  /** May see Category 6 and the /550 grand total. */
  canSeeCoreValues: () => boolean;
  isHodOrReviewer: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      // The refresh token is no longer held in JS — it lives in an httpOnly
      // cookie. Only the short-lived access token is kept here.
      login: (accessToken, user) => set({ accessToken, user }),
      logout: () => set({ accessToken: null, user: null }),
      hasRole: (role) => get().user?.roles.some((r) => r.role === role) ?? false,
      hasAnyRole: (roles) => get().user?.roles.some((r) => roles.includes(r.role)) ?? false,
      isAdmin: () => get().hasRole('ADMIN'),
      isPrincipal: () => get().hasRole('PRINCIPAL'),
      isDean: () => get().hasRole('DEAN'),
      isScrutinizer: () => get().hasAnyRole(['SCRUTINIZER', 'SPECIAL_SCRUTINIZER']),
      canAllocateTier: () => get().hasAnyRole(TIER_ROLES),
      canSeeCoreValues: () => get().hasAnyRole(CORE_VALUE_ROLES),
      isHodOrReviewer: () => get().hasAnyRole(['HOD', 'REVIEWER']),
    }),
    { name: 'auth-storage' }
  )
);
