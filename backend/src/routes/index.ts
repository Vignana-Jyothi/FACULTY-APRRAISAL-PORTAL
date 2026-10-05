import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { roleGuard } from '../middleware/roleGuard';
import { authLimiter, otpLimiter } from '../middleware/rateLimit';
import { proofUpload, MAX_UPLOAD_MB, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_MIME } from '../middleware/upload';
import { reviewerGuard } from '../middleware/reviewerGuard';
import { RoleType } from '@prisma/client';
// One source of truth for who may do what — utils/roles.ts.
import {
  MAINTENANCE,
  ACCOUNT_ADMIN,
  SEES_ALL,
  CONFIG,
  TIER,
  DEPT_REVIEW,
  DEPT_CONTENT_READ,
} from '../utils/roles';

import * as auth from '../controllers/authController';
import * as user from '../controllers/userController';
import * as dept from '../controllers/departmentController';
import * as year from '../controllers/academicYearController';
import * as appraisal from '../controllers/appraisalController';
import * as review from '../controllers/reviewController';
import * as finalReview from '../controllers/finalReviewController';
import * as report from '../controllers/reportController';
import * as email from '../controllers/emailController';
import * as audit from '../controllers/auditController';
import * as upload from '../controllers/uploadController';
import * as cadreTarget from '../controllers/cadreTargetController';
import * as reviewWindow from '../controllers/reviewWindowController';
import * as verification from '../controllers/verificationController';
import * as draftReview from '../controllers/draftReviewController';
import * as tracking from '../controllers/trackingController';
import * as feedback from '../controllers/feedbackController';
import * as oversight from '../controllers/oversightController';
import * as deptReviewer from '../controllers/deptReviewerController';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';

// Wrap multer middleware to turn upload errors into clean 400 JSON
function handleUpload(req: Request, res: Response, next: NextFunction) {
  proofUpload.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_UPLOAD_MB} MB). Upload a smaller file, or paste a link to it instead.` : err.message)
        : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

const router = Router();

// Upload rules, so the client can reject an oversized file before spending the
// bandwidth and show the real limit instead of a hardcoded guess.
router.get('/config/uploads', authenticate, (_req, res) =>
  res.json({ maxMb: MAX_UPLOAD_MB, maxBytes: MAX_UPLOAD_BYTES, allowedMime: ALLOWED_UPLOAD_MIME })
);

// Auth
router.post('/auth/login', authLimiter, auth.login);
router.post('/auth/refresh', auth.refresh);
// No `authenticate`: logout must work with an expired access token — it
// resolves the user from the refresh cookie and revokes the session itself.
router.post('/auth/logout', auth.logout);
router.post('/auth/forgot-password', otpLimiter, auth.forgotPassword);
router.post('/auth/reset-password', authLimiter, auth.resetPassword);

// User profile
router.get('/users/me', authenticate, user.getMe);
router.put('/users/me/profile', authenticate, user.updateProfile);
router.post('/users/me/password-otp', authenticate, otpLimiter, user.requestPasswordOtp);
router.post('/users/me/change-password', authenticate, user.changePasswordWithOtp);

// Admin: user management. Account maintenance (list / create / edit /
// deactivate / reactivate / reset password) is open to the institute ADMIN and
// to a DEPT_ADMIN — the controllers confine a DEPT_ADMIN to their own
// department. Role assignment and bulk import stay ADMIN-only (MAINTENANCE): a
// dept-admin cannot hand out roles or import rosters.
router.get('/admin/users', authenticate, roleGuard(ACCOUNT_ADMIN), user.listUsers);
router.post('/admin/users', authenticate, roleGuard(ACCOUNT_ADMIN), user.createUser);
router.put('/admin/users/:id', authenticate, roleGuard(ACCOUNT_ADMIN), user.updateUser);
// Soft delete: deactivates the account and stands down its roles. Nothing is
// erased — appraisals, the reviews this user gave, and the audit trail survive.
router.delete('/admin/users/:id', authenticate, roleGuard(ACCOUNT_ADMIN), user.deactivateUser);
router.post('/admin/users/:id/reactivate', authenticate, roleGuard(ACCOUNT_ADMIN), user.reactivateUser);
router.post('/admin/users/:id/reset-password', authenticate, roleGuard(ACCOUNT_ADMIN), user.adminResetPassword);
router.post('/admin/users/:id/roles', authenticate, roleGuard(MAINTENANCE), user.assignRole);
router.delete('/admin/users/:id/roles/:roleId', authenticate, roleGuard(MAINTENANCE), user.revokeRole);

// HoD appoints / stands down department reviewers (incharges). Locked to the
// REVIEWER role and the HoD's own department inside the controller.
router.get('/department/reviewers', authenticate, roleGuard([RoleType.HOD]), deptReviewer.listDeptReviewers);
router.post('/department/reviewers', authenticate, roleGuard([RoleType.HOD]), deptReviewer.addDeptReviewer);
router.delete('/department/reviewers/:userId', authenticate, roleGuard([RoleType.HOD]), deptReviewer.removeDeptReviewer);
router.get('/admin/users/bulk-import/template', authenticate, roleGuard(MAINTENANCE), user.bulkImportTemplate);
router.post('/admin/users/bulk-import', authenticate, roleGuard(MAINTENANCE), user.bulkImportUsers);

// Admin: departments
router.get('/admin/departments', authenticate, dept.listDepartments);
router.post('/admin/departments', authenticate, roleGuard(CONFIG), dept.createDepartment);
router.put('/admin/departments/:id', authenticate, roleGuard(CONFIG), dept.updateDepartment);
// Soft delete: deactivates the department. Nothing attached to it is removed.
router.delete('/admin/departments/:id', authenticate, roleGuard(CONFIG), dept.deleteDepartment);
router.post('/admin/departments/:id/reactivate', authenticate, roleGuard(CONFIG), dept.reactivateDepartment);

// Public departments (for forms)
router.get('/departments', authenticate, dept.listDepartments);

// Public: academic years (any auth user, for dropdowns)
router.get('/academic-years', authenticate, year.listAcademicYears);

// Dean: academic years — opening and closing the year is a dean decision.
router.get('/admin/academic-years', authenticate, roleGuard(CONFIG), year.listAcademicYears);
router.post('/admin/academic-years', authenticate, roleGuard(CONFIG), year.createAcademicYear);
router.put('/admin/academic-years/:id', authenticate, roleGuard(CONFIG), year.updateAcademicYear);

// Dean: cadre eligibility targets (W1)
router.get('/admin/cadre-targets', authenticate, roleGuard(CONFIG), cadreTarget.listCadreTargets);
router.post('/admin/cadre-targets', authenticate, roleGuard(CONFIG), cadreTarget.createCadreTarget);
router.post('/admin/cadre-targets/seed-defaults', authenticate, roleGuard(CONFIG), cadreTarget.seedDefaultCadreTargets);
router.put('/admin/cadre-targets/:id', authenticate, roleGuard(CONFIG), cadreTarget.updateCadreTarget);
router.delete('/admin/cadre-targets/:id', authenticate, roleGuard(CONFIG), cadreTarget.deleteCadreTarget);

// (Per-cadre tier thresholds removed 2026-09-28 — the dean/principal allocate a
// faculty's tier by hand on the tracking page, so the auto-threshold sets are
// gone. The FAPA cadre TARGETS above remain the only requirement definition.)

// Appraisals
router.get('/appraisals', authenticate, appraisal.listAppraisals);
router.post('/appraisals', authenticate, appraisal.createAppraisal);
router.get('/appraisals/:id', authenticate, appraisal.getAppraisal);
router.put('/appraisals/:id', authenticate, appraisal.updateAppraisal);
router.post('/appraisals/:id/submit', authenticate, appraisal.submitAppraisal);
router.post('/appraisals/:id/withdraw', authenticate, appraisal.withdrawAppraisal);
router.get('/appraisals/:id/score', authenticate, appraisal.getScore);
router.get('/appraisals/:id/target-status', authenticate, feedback.getTargetStatus);

// Reviews — the department layer. The admin holds no appraisal content.
router.get('/reviews/pending', authenticate, roleGuard(DEPT_REVIEW), review.listPendingReviews);
router.post('/appraisals/:id/review', authenticate, roleGuard(DEPT_REVIEW), reviewerGuard, review.submitReview);
router.get('/appraisals/:id/review', authenticate, review.getReview);

// Draft carry-over (2026-09-19): the department checks a draft's proofs during
// the year, and the HoD notes provisional marks that pre-fill the real review.
// Who may read/write is decided per submission in the controller.
router.get('/reviews/drafts', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), draftReview.listDrafts);
router.get('/appraisals/:id/draft-review', authenticate, draftReview.getDraftReview);
router.put('/appraisals/:id/draft-review', authenticate, draftReview.putDraftReview);
// The faculty-safe slice of a draft review: the HoD's note, once shared.
router.get('/appraisals/:id/shared-note', authenticate, draftReview.getSharedDraftNote);

// Final review — the scrutinizer layer above the HoD, assigned by the dean.
router.get('/final-reviewers/pool', authenticate, roleGuard(CONFIG), finalReview.listScrutinizerPool);
// Path unchanged (the frontend still calls /admin/...); only the role moved.
router.post('/admin/appraisals/:id/final-reviewers', authenticate, roleGuard(CONFIG), finalReview.assignFinalReviewers);
router.get('/appraisals/:id/final-reviews', authenticate, finalReview.getFinalReviews);
router.get('/final-reviews/pending', authenticate, finalReview.getPendingFinalReviews);
router.post('/appraisals/:id/final-review', authenticate, finalReview.submitFinalReview);

// W2 — proof verification + red-list
// Owner may read their own list (it drives the "Rejected proofs" card);
// listProofs checks owner / same-dept HoD or incharge / principal itself.
router.get('/appraisals/:id/proofs', authenticate, verification.listProofs);
router.post('/appraisals/:id/proofs/verify', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), verification.verifyProof);
// Per-row HoD yes/no approval for the no-proof sections (4.1, 4.2, 5.1, 5.3, 5.4).
router.post('/appraisals/:id/item-approval', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), verification.setItemApproval);
// Faculty replaces a rejected proof before the correction deadline (owner-only).
router.post('/appraisals/:id/proofs/replace', authenticate, verification.replaceProof);
// Faculty-wise uploads overview (counts per faculty) for the Uploads page.
router.get('/proofs/overview', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), verification.proofsOverview);
router.get('/red-list', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), verification.listRedList);
router.post('/appraisals/:id/clear-hold', authenticate, roleGuard([...DEPT_REVIEW, ...SEES_ALL]), verification.clearHold);

// W3 — criteria tracking / tier / eligibility (HoD own dept; TIER institute-wide)
router.get('/tracking', authenticate, roleGuard([RoleType.HOD, ...TIER]), tracking.getTracking);
// W5 — segregated cadre+tier report export
router.get('/tracking/export', authenticate, roleGuard([RoleType.HOD, ...TIER]), tracking.exportTracking);
// W4 — quarterly snapshot manual trigger (cron runs it at quarter-end)
router.post('/admin/tracking/snapshot', authenticate, roleGuard(CONFIG), tracking.runSnapshot);
// Manual tier assignment — the dean (or a special scrutinizer) sets a faculty's
// T1/T2/T3 for the year.
router.put('/admin/faculty-tiers', authenticate, roleGuard(TIER), tracking.setFacultyTier);

// W8 — dean-configured quarterly review windows (automation fires on end date)
router.get('/admin/review-windows', authenticate, roleGuard(CONFIG), reviewWindow.listReviewWindows);
router.put('/admin/review-windows', authenticate, roleGuard(CONFIG), reviewWindow.upsertReviewWindow);
router.delete('/admin/review-windows/:id', authenticate, roleGuard(CONFIG), reviewWindow.deleteReviewWindow);
// Mass-mail gate: preview, arm/disarm, release held mail (dean + principal).
router.get('/admin/review-windows/:id/preview', authenticate, roleGuard(CONFIG), reviewWindow.previewReviewWindow);
router.post('/admin/review-windows/:id/arm', authenticate, roleGuard(CONFIG), reviewWindow.armReviewWindow);
router.post('/admin/review-windows/:id/disarm', authenticate, roleGuard(CONFIG), reviewWindow.disarmReviewWindow);
router.post('/admin/review-windows/:id/release', authenticate, roleGuard(CONFIG), reviewWindow.releaseReviewWindow);

// W6 — HoD feedback, per period (four quarters + the final annual).
router.get('/appraisals/:id/feedbacks', authenticate, feedback.listFeedbacks);
router.get('/appraisals/:id/feedback', authenticate, feedback.getFeedback);
router.put('/appraisals/:id/feedback', authenticate, roleGuard([RoleType.HOD, ...SEES_ALL]), feedback.saveFeedback);
router.post('/appraisals/:id/feedback/issue', authenticate, roleGuard([RoleType.HOD, ...SEES_ALL]), feedback.issueFeedback);
// Visibility is decided in the controller (owner vs HoD/principal), as for GET feedback.
router.get('/appraisals/:id/feedback/pdf', authenticate, feedback.downloadFeedbackPdf);

// Force actions — the dean and the principal, not the maintenance account.
router.get('/appraisals/:id/pdf', authenticate, appraisal.downloadAppraisalPdf);
router.post('/admin/appraisals/:id/unlock', authenticate, roleGuard(CONFIG), review.adminUnlock);
router.post('/admin/appraisals/:id/reopen-review', authenticate, roleGuard(CONFIG), review.adminReopenReview);
router.post('/admin/appraisals/:id/assign-reviewer', authenticate, roleGuard(CONFIG), review.adminAssignReviewer);

// FPGP v2 — feature retired; controller/service/UI code removed 2026-09-13.
// The DB models (FPGPPlan etc.) are kept so historical data survives.

// Oversight dashboard — dean + principal. Cat 6 / the /550 average goes to the
// principal only (utils/reviewVisibility decides, inside the controller).
router.get('/oversight/summary', authenticate, roleGuard(CONFIG), oversight.getOversightSummary);

// Reports — HoD for their own department, dean and principal institute-wide.
router.get('/reports/department', authenticate, roleGuard(DEPT_CONTENT_READ), report.getDeptReport);
router.get('/reports/criteria', authenticate, roleGuard(DEPT_CONTENT_READ), report.getCriteriaReport);
router.get('/reports/institute', authenticate, roleGuard(CONFIG), report.getInstituteReport);
router.get('/reports/export', authenticate, roleGuard(DEPT_CONTENT_READ), report.exportReport);
// Per-department appraisal Excel in the institute's output format. HoD exports
// their own dept (Tier/Eligibility hidden); dean/principal pick any dept and
// get those two columns. Controller enforces the dept scope.
router.get('/reports/appraisal-excel', authenticate, roleGuard(DEPT_CONTENT_READ), report.exportAppraisalExcel);
// Per-department quarterly review summary PDF (snapshot + issued HoD feedback).
// HoD exports their own dept; dean/principal pick any. Controller enforces scope.
router.get('/reports/quarterly-summary', authenticate, roleGuard(DEPT_CONTENT_READ), report.exportQuarterlyDeptPdf);
// IQAC quarterly sheet: Emp ID, Name, Targets Achieved, HoD Review — per dept + quarter.
router.get('/reports/iqac-excel', authenticate, roleGuard(DEPT_CONTENT_READ), report.exportIqacQuarterlyExcel);

// Admin: email notifications. A DEPT_ADMIN may READ the queue (scoped to their
// department's recipients in the controller); retrying and manually triggering
// sends stay ADMIN-only.
router.get('/admin/emails', authenticate, roleGuard(ACCOUNT_ADMIN), email.listEmails);
router.post('/admin/emails/:id/retry', authenticate, roleGuard(MAINTENANCE), email.retryEmail);
router.post('/admin/emails/trigger', authenticate, roleGuard(MAINTENANCE), email.manualTrigger);

// File upload (proof attachments) — any authenticated user
router.post('/uploads/proof', authenticate, handleUpload, upload.uploadProof);
router.delete('/uploads/proof', authenticate, upload.deleteProof);
router.get('/uploads/file/:filename', authenticate, upload.serveProof);

// Admin: audit log. A DEPT_ADMIN sees only entries concerning their department
// (scoped in the controller); the action list is harmless metadata.
router.get('/admin/audit', authenticate, roleGuard(ACCOUNT_ADMIN), audit.listAuditLogs);
router.get('/admin/audit/actions', authenticate, roleGuard(ACCOUNT_ADMIN), audit.listAuditActions);

export default router;
