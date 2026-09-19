import api from './client';

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface ReviewWindow {
  id: string;
  academicYearId: string;
  quarter: Quarter;
  startDate: string;
  endDate: string;
  enabled: boolean;
  lastRunAt: string | null;
  // Mass-mail gate: the window only emails faculty once the dean arms it.
  armedAt: string | null;
  armedById: string | null;
  armedByName: string | null;
  heldAt: string | null;
  releasedAt: string | null;
}

export interface ReviewWindowInput {
  academicYearId: string;
  quarter: Quarter;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  enabled: boolean;
}

export interface ReviewWindowPreview {
  recipients: number;
  sample: { to: string; subject: string; html: string } | null;
}

export interface ReleaseResult {
  dryRun: boolean;
  recipients?: number;
  queued?: number;
  message: string;
}

export const reviewWindowApi = {
  list: (academicYearId: string): Promise<ReviewWindow[]> =>
    api.get('/admin/review-windows', { params: { academicYearId } }).then((r) => r.data),
  upsert: (body: ReviewWindowInput): Promise<ReviewWindow> =>
    api.put('/admin/review-windows', body).then((r) => r.data),
  remove: (id: string): Promise<void> => api.delete(`/admin/review-windows/${id}`).then(() => undefined),
  preview: (id: string): Promise<ReviewWindowPreview> =>
    api.get(`/admin/review-windows/${id}/preview`).then((r) => r.data),
  arm: (id: string, expectedRecipients: number): Promise<ReviewWindow> =>
    api.post(`/admin/review-windows/${id}/arm`, { expectedRecipients }).then((r) => r.data),
  disarm: (id: string): Promise<ReviewWindow> =>
    api.post(`/admin/review-windows/${id}/disarm`).then((r) => r.data),
  // Without confirm this is a dry run that only returns the recipient count.
  release: (id: string, confirm: boolean): Promise<ReleaseResult> =>
    api.post(`/admin/review-windows/${id}/release`, confirm ? { confirm: true } : {}).then((r) => r.data),
};
