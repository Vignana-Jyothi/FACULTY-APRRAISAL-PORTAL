import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardPage from './pages/faculty/DashboardPage';
import AppraisalEditPage from './pages/faculty/AppraisalEditPage';
import AppraisalViewPage from './pages/faculty/AppraisalViewPage';
import ReviewQueuePage from './pages/reviewer/ReviewQueuePage';
import FinalReviewPage from './pages/reviewer/FinalReviewPage';
import UploadsPage from './pages/reviewer/UploadsPage';
import FacultyUploadsPage from './pages/reviewer/FacultyUploadsPage';
import ReviewAppraisalPage from './pages/reviewer/ReviewAppraisalPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminAcademicYearsPage from './pages/admin/AdminAcademicYearsPage';
import AdminCadreTargetsPage from './pages/admin/AdminCadreTargetsPage';
import AdminCadreTiersPage from './pages/admin/AdminCadreTiersPage';
import AdminInchargesPage from './pages/admin/AdminInchargesPage';
import AdminReviewWindowsPage from './pages/admin/AdminReviewWindowsPage';
import AdminAppraisalsPage from './pages/admin/AdminAppraisalsPage';
import AdminDepartmentsPage from './pages/admin/AdminDepartmentsPage';
import AdminReportsPage from './pages/admin/AdminReportsPage';
import DeptReportsPage from './pages/reviewer/DeptReportsPage';
import RedListPage from './pages/reviewer/RedListPage';
import TrackingPage from './pages/reviewer/TrackingPage';
import AdminEmailsPage from './pages/admin/AdminEmailsPage';
import AdminAuditPage from './pages/admin/AdminAuditPage';
import ProfilePage from './pages/faculty/ProfilePage';
import OversightDashboardPage from './pages/oversight/OversightDashboardPage';

// Role sets, mirroring backend/src/utils/roles.ts. The routes below are the
// UI's half of P2: maintenance (/admin/*) never overlaps appraisal content.
const MAINTENANCE = ['ADMIN'] as const;                       // accounts, roles, mail, audit
const CONFIG = ['DEAN', 'PRINCIPAL'] as const;                // dean-owned configuration
const SEES_ALL = ['PRINCIPAL'] as const;                      // institute-wide content
// Cross-department readers of tracking; HoD is scoped to their own department
// server-side.
const TRACKING = ['HOD', 'DEAN', 'SPECIAL_SCRUTINIZER', 'PRINCIPAL'] as const;
const DEPT_REVIEW = ['HOD', 'REVIEWER'] as const;
// Reports: the backend guards /reports/department, /criteria and /export with
// DEPT_CONTENT_READ, which includes the dean. The dean's rows come back
// institute-wide and stripped of Cat 6 / the /550 total.
const DEPT_REPORTS = ['HOD', 'DEAN', 'PRINCIPAL'] as const;
// The red list is the department's proof workflow, not a tracking view. The
// people who chase a faculty's rejected proofs are the HoD and the incharge
// reviewer; the principal reads it institute-wide.
const RED_LIST = ['HOD', 'REVIEWER', 'PRINCIPAL'] as const;

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ style: { background: '#1e3a5f', color: '#fff', borderRadius: '4px', fontSize: '14px' } }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Faculty */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/appraisal" element={<Navigate to="/dashboard" replace />} />
        <Route path="/appraisal/:id/edit" element={<ProtectedRoute><AppraisalEditPage /></ProtectedRoute>} />
        <Route path="/appraisal/:id" element={<ProtectedRoute><AppraisalViewPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

        {/* Scrutinizer sign-off above the HoD. Assignment is per submission, so
            role alone does not grant entry — the queue is empty for everyone
            who has not been assigned. */}
        <Route path="/final-review" element={<ProtectedRoute><FinalReviewPage /></ProtectedRoute>} />

        {/* Faculty-wise uploads — proof verification lives with the department. */}
        <Route path="/uploads" element={
          <ProtectedRoute roles={DEPT_REVIEW}><UploadsPage /></ProtectedRoute>
        } />
        <Route path="/uploads/:submissionId" element={
          <ProtectedRoute roles={DEPT_REVIEW}><FacultyUploadsPage /></ProtectedRoute>
        } />

        {/* Reviewer / HoD */}
        <Route path="/reviews" element={
          <ProtectedRoute roles={DEPT_REVIEW}><ReviewQueuePage /></ProtectedRoute>
        } />
        <Route path="/reviews/:id" element={
          <ProtectedRoute roles={DEPT_REVIEW}><ReviewAppraisalPage /></ProtectedRoute>
        } />
        <Route path="/reports/department" element={
          <ProtectedRoute roles={DEPT_REPORTS}><DeptReportsPage /></ProtectedRoute>
        } />
        <Route path="/red-list" element={
          <ProtectedRoute roles={RED_LIST}><RedListPage /></ProtectedRoute>
        } />
        <Route path="/tracking" element={
          <ProtectedRoute roles={TRACKING}><TrackingPage /></ProtectedRoute>
        } />

        {/* Maintenance admin — accounts and plumbing, no appraisal content. */}
        <Route path="/admin/dashboard" element={
          <ProtectedRoute roles={MAINTENANCE}><AdminDashboardPage /></ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute roles={MAINTENANCE}><AdminUsersPage /></ProtectedRoute>
        } />
        <Route path="/admin/incharges" element={
          <ProtectedRoute roles={MAINTENANCE}><AdminInchargesPage /></ProtectedRoute>
        } />
        <Route path="/admin/emails" element={
          <ProtectedRoute roles={MAINTENANCE}><AdminEmailsPage /></ProtectedRoute>
        } />
        <Route path="/admin/audit" element={
          <ProtectedRoute roles={MAINTENANCE}><AdminAuditPage /></ProtectedRoute>
        } />

        {/* Dean — configuration and scrutinizer assignment. */}
        <Route path="/dean/academic-years" element={
          <ProtectedRoute roles={CONFIG}><AdminAcademicYearsPage /></ProtectedRoute>
        } />
        <Route path="/dean/cadre-targets" element={
          <ProtectedRoute roles={CONFIG}><AdminCadreTargetsPage /></ProtectedRoute>
        } />
        <Route path="/dean/cadre-tiers" element={
          <ProtectedRoute roles={CONFIG}><AdminCadreTiersPage /></ProtectedRoute>
        } />
        <Route path="/dean/review-windows" element={
          <ProtectedRoute roles={CONFIG}><AdminReviewWindowsPage /></ProtectedRoute>
        } />
        {/* Departments belong to the dean. The admin only picks from the
            existing list when creating a user — it never edits it. */}
        <Route path="/dean/departments" element={
          <ProtectedRoute roles={CONFIG}><AdminDepartmentsPage /></ProtectedRoute>
        } />
        <Route path="/dean/appraisals" element={
          <ProtectedRoute roles={CONFIG}><AdminAppraisalsPage /></ProtectedRoute>
        } />

        {/* Dean + principal landing: institute-wide oversight dashboard. */}
        <Route path="/oversight" element={
          <ProtectedRoute roles={CONFIG}><OversightDashboardPage /></ProtectedRoute>
        } />

        {/* Principal — institute-wide content. */}
        <Route path="/principal/appraisals" element={
          <ProtectedRoute roles={SEES_ALL}><AdminAppraisalsPage /></ProtectedRoute>
        } />
        {/* Institute report — dean and principal both, so the path is
            role-neutral. /principal/reports redirects below. */}
        <Route path="/reports/institute" element={
          <ProtectedRoute roles={CONFIG}><AdminReportsPage /></ProtectedRoute>
        } />

        {/* Pages that moved off /admin/*: keep old links working. */}
        <Route path="/admin/academic-years" element={<Navigate to="/dean/academic-years" replace />} />
        <Route path="/admin/cadre-targets" element={<Navigate to="/dean/cadre-targets" replace />} />
        <Route path="/admin/cadre-tiers" element={<Navigate to="/dean/cadre-tiers" replace />} />
        <Route path="/admin/review-windows" element={<Navigate to="/dean/review-windows" replace />} />
        <Route path="/admin/appraisals" element={<Navigate to="/dean/appraisals" replace />} />
        <Route path="/admin/departments" element={<Navigate to="/dean/departments" replace />} />
        <Route path="/admin/reports" element={<Navigate to="/reports/institute" replace />} />
        <Route path="/principal/reports" element={<Navigate to="/reports/institute" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
