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
  | 'DEPT_ADMIN'
  | 'PRINCIPAL'
  | 'DEAN'
  | 'SCRUTINIZER'
  | 'SPECIAL_SCRUTINIZER';

export const ALL_ROLES: readonly Role[] = [
  'FACULTY', 'HOD', 'REVIEWER', 'ADMIN', 'DEPT_ADMIN',
  'PRINCIPAL', 'DEAN', 'SCRUTINIZER', 'SPECIAL_SCRUTINIZER',
] as const;

// These three are department-scoped; every other role is institute-wide and
// `assignRole` rejects a departmentId for them.
export const DEPT_SCOPED_ROLES: readonly Role[] = ['HOD', 'REVIEWER', 'DEPT_ADMIN'] as const;

// Tier allocation: the dean, the 2-3 special scrutinizers they delegate to, and
// the principal who sees everything.
export const TIER_ROLES: readonly Role[] = ['DEAN', 'SPECIAL_SCRUTINIZER', 'PRINCIPAL'] as const;

// Institute-wide readers of department content (reports, criteria): mirrors
// backend INSTITUTE_READ. Everyone else is scoped to their own department.
export const INSTITUTE_READ_ROLES: readonly Role[] = ['PRINCIPAL', 'DEAN'] as const;

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

// A person who is both faculty and a department reviewer (HoD or incharge) works
// in two distinct modes: filing their own appraisal, and reviewing others'. The
// workspace switch lets them keep those apart in one login — it filters the menu
// and where they land, nothing more (the token's roles still govern every API
// call, so this is a view, not a privilege).
export type Workspace = 'faculty' | 'staff';

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  /** Which workspace a dual faculty+reviewer is currently viewing. */
  activeWorkspace: Workspace;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => void;
  setWorkspace: (w: Workspace) => void;
  /** True only for FACULTY + (HOD or REVIEWER) with no higher institute role —
   *  the people who actually have two workspaces to switch between. */
  canSwitchWorkspace: () => boolean;
  hasRole: (role: Role) => boolean;
  hasAnyRole: (roles: readonly Role[]) => boolean;
  /** Maintenance admin ONLY — accounts, roles, email queue, audit log.
   *  Never a stand-in for "has power": an admin sees no appraisal content. */
  isAdmin: () => boolean;
  /** Department-scoped maintenance admin — faculty accounts, password resets,
   *  email + audit, confined to their own department by the server. */
  isDeptAdmin: () => boolean;
  /** Either flavour of account maintainer: the institute admin or a dept admin. */
  isAccountAdmin: () => boolean;
  isPrincipal: () => boolean;
  isDean: () => boolean;
  /** Either flavour of scrutinizer. */
  isScrutinizer: () => boolean;
  /** May set a faculty's tier / eligibility and run the quarterly snapshot. */
  canAllocateTier: () => boolean;
  /** May see Category 6 and the /550 grand total.
   *  Ownership beats role: pass the id of the faculty the appraisal belongs to
   *  and an owner viewing their own appraisal is refused, exactly as the server
   *  strips the payload. Called with no argument it answers on role alone. */
  canSeeCoreValues: (ownerId?: string | null) => boolean;
  isHodOrReviewer: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      // A dual faculty+reviewer starts each login in the staff (review) workspace
      // — that is the widest-remit landing the login already used — and can flip
      // to their own filing at any time.
      activeWorkspace: 'staff',
      // The refresh token is no longer held in JS — it lives in an httpOnly
      // cookie. Only the short-lived access token is kept here.
      login: (accessToken, user) => set({ accessToken, user, activeWorkspace: 'staff' }),
      logout: () => set({ accessToken: null, user: null, activeWorkspace: 'staff' }),
      setWorkspace: (w) => set({ activeWorkspace: w }),
      canSwitchWorkspace: () =>
        get().hasRole('FACULTY') &&
        get().hasAnyRole(['HOD', 'REVIEWER']) &&
        !get().hasAnyRole(['DEAN', 'PRINCIPAL', 'ADMIN', 'SCRUTINIZER', 'SPECIAL_SCRUTINIZER']),
      hasRole: (role) => get().user?.roles.some((r) => r.role === role) ?? false,
      hasAnyRole: (roles) => get().user?.roles.some((r) => roles.includes(r.role)) ?? false,
      isAdmin: () => get().hasRole('ADMIN'),
      isDeptAdmin: () => get().hasRole('DEPT_ADMIN'),
      isAccountAdmin: () => get().hasAnyRole(['ADMIN', 'DEPT_ADMIN']),
      isPrincipal: () => get().hasRole('PRINCIPAL'),
      isDean: () => get().hasRole('DEAN'),
      isScrutinizer: () => get().hasAnyRole(['SCRUTINIZER', 'SPECIAL_SCRUTINIZER']),
      canAllocateTier: () => get().hasAnyRole(TIER_ROLES),
      canSeeCoreValues: (ownerId) => {
        const me = get().user;
        if (!me) return false;
        // The check keys on ownership first: staff filing their own appraisal
        // are restricted too, however senior their role.
        if (ownerId && ownerId === me.id) return false;
        return get().hasAnyRole(CORE_VALUE_ROLES);
      },
      isHodOrReviewer: () => get().hasAnyRole(['HOD', 'REVIEWER']),
    }),
    { name: 'auth-storage' }
  )
);
