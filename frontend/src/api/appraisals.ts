import api from './client';

export const appraisalApi = {
  list: (params?: Record<string, string>) =>
    api.get('/appraisals', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/appraisals/${id}`).then((r) => r.data),
  create: (academicYearId: string) =>
    api.post('/appraisals', { academicYearId }).then((r) => r.data),
  update: (id: string, data: any) =>
    api.put(`/appraisals/${id}`, data).then((r) => r.data),
  submit: (id: string) =>
    api.post(`/appraisals/${id}/submit`).then((r) => r.data),
  withdraw: (id: string) =>
    api.post(`/appraisals/${id}/withdraw`).then((r) => r.data),
  getScore: (id: string) =>
    api.get(`/appraisals/${id}/score`).then((r) => r.data),
  getReview: (id: string) =>
    api.get(`/appraisals/${id}/review`).then((r) => r.data),
  submitReview: (id: string, data: any) =>
    api.post(`/appraisals/${id}/review`, data).then((r) => r.data),
  downloadPdf: (id: string) =>
    api.get(`/appraisals/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
};

export const reviewApi = {
  listPending: () => api.get('/reviews/pending').then((r) => r.data),
};

export interface FinalReviewRow {
  id: string;
  submissionId: string;
  reviewerId: string;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment: string | null;
  decidedAt: string | null;
  reviewer?: { id: string; name: string; employeeCode: string };
  submission?: any;
}

/** A member of the standing scrutinizer pool, as `GET /final-reviewers/pool`
 *  returns it — already filtered to SCRUTINIZER / SPECIAL_SCRUTINIZER. */
export interface ScrutinizerPoolRow {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  department: { id: string; name: string; code: string } | null;
  roles: string[];
  special: boolean;
}

// The dean-assigned 2-reviewer layer above the HoD.
export const finalReviewApi = {
  // Dean/principal only. Replaces listing every user via the admin route,
  // which is maintenance-admin-only and 403s for the dean.
  pool: (): Promise<ScrutinizerPoolRow[]> =>
    api.get('/final-reviewers/pool').then((r) => r.data),
  assign: (id: string, reviewerIds: string[]) =>
    api.post(`/admin/appraisals/${id}/final-reviewers`, { reviewerIds }).then((r) => r.data),
  list: (id: string): Promise<FinalReviewRow[]> =>
    api.get(`/appraisals/${id}/final-reviews`).then((r) => r.data),
  pending: (): Promise<FinalReviewRow[]> =>
    api.get('/final-reviews/pending').then((r) => r.data),
  decide: (id: string, decision: 'APPROVED' | 'REJECTED', comment?: string) =>
    api.post(`/appraisals/${id}/final-review`, { decision, comment }).then((r) => r.data),
};

export const adminApi = {
  unlock: (id: string) =>
    api.post(`/admin/appraisals/${id}/unlock`).then((r) => r.data),
  // Sends a decided appraisal back to SUBMITTED for the HoD to review again.
  // Unlike unlock, the faculty is not involved and their form stays locked.
  reopenReview: (id: string, reason: string) =>
    api.post(`/admin/appraisals/${id}/reopen-review`, { reason }).then((r) => r.data),
  assignReviewer: (id: string, reviewerId: string) =>
    api.post(`/admin/appraisals/${id}/assign-reviewer`, { reviewerId }).then((r) => r.data),
};
