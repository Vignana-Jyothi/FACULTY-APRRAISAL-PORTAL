import api from './client';

export interface OversightPendingFinalReview {
  id: string;
  assignedAt: string;
  submission: { id: string; submissionNumber: number; status: string; submittedAt: string | null };
  faculty: {
    id: string;
    name: string;
    employeeCode: string;
    department: { id: string; name: string; code: string } | null;
  };
  scrutinizer: { id: string; name: string; employeeCode: string };
}

export interface OversightSummary {
  year: { id: string; label: string; submissionOpen: boolean };
  submissions: { total: number; byStatus: Record<string, number> };
  finalReviews: {
    pendingCount: number;
    pendingSubmissions: number;
    pending: OversightPendingFinalReview[];
  };
  allocation: {
    faculty: number;
    tier: { decided: number; undecided: number };
    eligibility: { decided: number; undecided: number; eligible: number };
  };
  redListed: number;
  /** /550 for the principal, /500 for the dean — the server decides. */
  averageScore: { outOf: 500 | 550; value: number | null; reviewed: number };
}

export const oversightApi = {
  summary: (academicYearId?: string): Promise<OversightSummary> =>
    api.get('/oversight/summary', { params: academicYearId ? { academicYearId } : undefined }).then((r) => r.data),
};
