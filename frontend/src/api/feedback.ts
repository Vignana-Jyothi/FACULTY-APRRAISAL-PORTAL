import api from './client';

export type FeedbackPeriod = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'ANNUAL';

export interface FeedbackSnapshot {
  year: string;
  cadreLabel: string | null;
  eligible: boolean;
  requirements: { key: string; label: string; target: string; actual: string; met: boolean; gating: boolean }[];
  scores: { cat1: number; cat2: number; cat3: number; cat4: number; cat5: number; total: number } | null;
}

export interface FeedbackData {
  id: string;
  status: 'DRAFT' | 'ISSUED';
  strengths: string | null;
  improvements: string | null;
  growthTargets: string | null;
  snapshot: FeedbackSnapshot;
  issuedAt: string | null;
  issuedBy?: { name: string } | null;
}

export interface FeedbackResponse {
  feedback: FeedbackData | null;
  autoSnapshot?: FeedbackSnapshot | null;
  // Auto-generated narrative (from the eligibility snapshot) to pre-fill the
  // editor when no draft has been written yet.
  suggested?: { strengths: string; improvements: string; growthTargets: string } | null;
  editable: boolean;
}

export interface FeedbackInput {
  period?: FeedbackPeriod;
  strengths?: string;
  improvements?: string;
  growthTargets?: string;
}

// One row of the per-period list. status NONE = not written yet.
export interface FeedbackPeriodRow {
  period: FeedbackPeriod;
  label: string;
  status: 'NONE' | 'DRAFT' | 'ISSUED';
  strengths?: string | null;
  improvements?: string | null;
  growthTargets?: string | null;
  issuedAt?: string | null;
  issuedByName?: string | null;
}
export interface FeedbackListResponse {
  periods: FeedbackPeriodRow[];
  editable: boolean;
}

export const feedbackApi = {
  // All periods for the submission (five for an author, only issued for the owner).
  list: (submissionId: string): Promise<FeedbackListResponse> =>
    api.get(`/appraisals/${submissionId}/feedbacks`).then((r) => r.data),
  get: (submissionId: string, period: FeedbackPeriod): Promise<FeedbackResponse> =>
    api.get(`/appraisals/${submissionId}/feedback`, { params: { period } }).then((r) => r.data),
  save: (submissionId: string, body: FeedbackInput): Promise<FeedbackData> =>
    api.put(`/appraisals/${submissionId}/feedback`, body).then((r) => r.data),
  issue: (submissionId: string, body: FeedbackInput): Promise<FeedbackData> =>
    api.post(`/appraisals/${submissionId}/feedback/issue`, body).then((r) => r.data),
  // Server decides what goes in it: the owner's copy carries the narrative
  // only, a HoD's also carries the cadre/eligibility standing.
  downloadPdf: (submissionId: string, period: FeedbackPeriod) =>
    api.get(`/appraisals/${submissionId}/feedback/pdf`, { params: { period }, responseType: 'blob' }).then((r) => r.data),
};
