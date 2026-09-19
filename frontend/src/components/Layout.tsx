import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  BarChart2, FileText, FilePen, BookOpen, User, Users, Settings, LayoutDashboard, Mail, Activity, Menu, X, Target, ShieldCheck, AlertTriangle, Gauge, CalendarClock, Gavel, UploadCloud, Layers,
} from 'lucide-react';
import BrandHeader from './BrandHeader';
import Footer from './Footer';
import { finalReviewApi } from '../api/appraisals';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isPrincipal, isDean, isScrutinizer, isHodOrReviewer, canAllocateTier, hasRole } = useAuthStore();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Any user can be a dean-assigned final reviewer, so surface the link only to
  // those who actually have something awaiting their sign-off.
  const [finalCount, setFinalCount] = useState(0);

  useEffect(() => {
    finalReviewApi.pending().then((r) => setFinalCount(r.length)).catch(() => setFinalCount(0));
  }, [location.pathname]);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (drawerOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const navLink = (to: string, label: string, Icon: any) => {
    const active = location.pathname.startsWith(to);
    return (
      <Link
        key={to}
        to={to}
        className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors ${
          active
            ? 'bg-primary-50 text-primary-700 border-l-2 border-primary-600 -ml-px'
            : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
        }`}
      >
        <Icon size={15} className={active ? 'text-primary-600' : 'text-ink-muted'} />
        {label}
      </Link>
    );
  };

  // Roles stack (the bootstrap account is ADMIN + PRINCIPAL), so the menu is
  // built additively per role and de-duplicated by path rather than chosen by
  // a single "most powerful role" branch.
  const entries: [to: string, label: string, Icon: any][] = [];
  const add = (to: string, label: string, Icon: any) => {
    if (!entries.some(([t]) => t === to)) entries.push([to, label, Icon]);
  };

  // Dean + principal land on the institute-wide oversight dashboard. It goes
  // first so it tops their menu.
  if (isDean() || isPrincipal()) {
    add('/oversight', 'Dashboard', LayoutDashboard);
  }

  // Maintenance admin: accounts and plumbing. No appraisal content at all.
  if (isAdmin()) {
    // The bootstrap account is ADMIN + PRINCIPAL: keep the two dashboards apart.
    add('/admin/dashboard', isPrincipal() || isDean() ? 'Admin Dashboard' : 'Dashboard', LayoutDashboard);
    add('/admin/users', 'Users', Users);
    add('/admin/incharges', 'Incharges', ShieldCheck);
    add('/admin/emails', 'Emails', Mail);
    add('/admin/audit', 'Audit Log', Activity);
  }

  // Principal: institute-wide content, the only role that sees Cat 6 / 550.
  if (isPrincipal()) {
    add('/principal/appraisals', 'All Appraisals', FileText);
  }

  // Dean: configuration + scrutinizer assignment. The principal outranks the
  // dean and may open the same configuration pages, so they get these too —
  // minus the dean's appraisal list, which duplicates /principal/appraisals.
  if (isDean() || isPrincipal()) {
    if (isDean()) add('/dean/appraisals', 'Appraisals', FileText);
    // The institute report is open to both (backend /reports/institute is
    // guarded with CONFIG), hence the role-neutral path.
    add('/reports/institute', 'Institute Reports', BarChart2);
    // Department report with a department picker; rows come back without Cat 6
    // / the /550 for the dean (the server strips them).
    add('/reports/department', 'Department Reports', BarChart2);
    add('/dean/academic-years', 'Academic Years', BookOpen);
    add('/dean/cadre-targets', 'Cadre Targets', Target);
    add('/dean/cadre-tiers', 'Cadre Tiers', Layers);
    add('/dean/review-windows', 'Review Windows', CalendarClock);
    add('/dean/departments', 'Departments', Settings);
  }

  // Tier allocation (dean, special scrutinizer, principal) and the HoD's own
  // department both land on Tracking.
  if (canAllocateTier() || hasRole('HOD')) {
    add('/tracking', 'Tracking', Gauge);
  }

  // Red List is the department's proof-chasing workflow, so it follows the
  // review layer (HoD + incharge reviewer) rather than the tracking roles. The
  // principal reads it institute-wide.
  if (isHodOrReviewer() || isPrincipal()) {
    add('/red-list', 'Red List', AlertTriangle);
  }

  // Department review layer. A plain REVIEWER (incharge) verifies uploads only.
  if (isHodOrReviewer()) {
    add('/dashboard', 'Dashboard', LayoutDashboard);
    add('/reviews', 'Review Queue', FileText);
    add('/drafts', 'Drafts in progress', FilePen);
    add('/uploads', 'Uploads', UploadCloud);
    if (hasRole('HOD')) add('/reports/department', 'Reports', BarChart2);
  }

  // Scrutinizers work only through the final-review queue, so it is a standing
  // menu item for them even when nothing is assigned yet.
  if (isScrutinizer()) {
    add('/final-review', 'Final Review', Gavel);
  }

  // Filing one's own appraisal. /dashboard is the personal filing page, so it
  // is offered to anyone holding FACULTY and, as a fallback, to an account that
  // would otherwise have an empty menu. The dean/principal deliberately do not
  // get it — their appraisal lists are /dean/appraisals and
  // /principal/appraisals.
  if (hasRole('FACULTY') || entries.length === 0) {
    add('/dashboard', 'Dashboard', LayoutDashboard);
    if (hasRole('FACULTY')) add('/appraisal', 'Appraisals', FileText);
  }

  // Every role has an account, so every role gets Profile — last, so it sits at
  // the bottom of the menu.
  add('/profile', 'Profile', User);

  const navItems = (
    <>
      {entries
        .filter(([to]) => !(to === '/final-review' && finalCount > 0))
        .map(([to, label, Icon]) => navLink(to, label, Icon))}
      {finalCount > 0 && navLink('/final-review', `Final Review (${finalCount})`, Gavel)}
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-surface-base">
      {/* Mobile hamburger row above BrandHeader */}
      <div className="lg:hidden flex items-center justify-between bg-primary-800 px-3 py-2 border-b border-primary-700">
        <button
          onClick={() => setDrawerOpen(true)}
          className="text-white p-1.5 rounded hover:bg-primary-700"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="text-xs font-bold text-accent-400 tracking-wide">VNRVJIET PORTAL</div>
        <div className="w-7" />
      </div>

      <BrandHeader />

      <div className="flex flex-1 relative">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-52 bg-surface-card border-r border-surface-border flex-col shrink-0">
          <div className="px-4 py-3 border-b border-surface-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Navigation</span>
          </div>
          <nav className="flex-1 p-2 space-y-0.5">{navItems}</nav>
          <div className="px-3 py-2 border-t border-surface-border">
            <div className="text-[10px] text-ink-subtle">Faculty Appraisal System</div>
          </div>
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside className="lg:hidden fixed top-0 left-0 bottom-0 w-64 bg-surface-card border-r border-surface-border flex flex-col z-50 shadow-xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border bg-primary-700 text-white">
                <span className="text-xs font-semibold uppercase tracking-wider">Navigation</span>
                <button onClick={() => setDrawerOpen(false)} className="p-1 hover:bg-primary-600 rounded" aria-label="Close menu">
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">{navItems}</nav>
              <div className="px-3 py-2 border-t border-surface-border">
                <div className="text-[10px] text-ink-subtle">Faculty Appraisal System</div>
              </div>
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto min-w-0">
          <div className="p-4 sm:p-6 max-w-7xl">{children}</div>
        </main>
      </div>

      <Footer />
    </div>
  );
}
