import api from './client';

export interface Actuals {
  totalScore: number;
  totalScoreSource: 'HOD' | 'SELF';
  feedback: number;
  indexedCount: number;
  journalCount: number;
  patentCount: number;
  projectCount: number;
  consultancyCount: number;
}

export interface Requirement {
  key: string;
  label: string;
  target: string;
  actual: string;
  met: boolean;
  gating: boolean;
}

export interface TrackingRow {
  submissionId: string;
  status: string;
  redListed: boolean;
  faculty: { id: string; name: string; employeeCode: string; designation: string | null };
  department: { name: string; code: string } | null;
  cadre: string | null;
  cadreLabel: string | null;
  expYears: number;
  actuals: Actuals;
  eligibility: { requirements: Requirement[]; eligible: boolean; target: any };
  // Manual decisions by the admin/dean, null until decided.
  tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
  eligible: boolean | null;
  scoreScale: 500 | 550;
  academicVerified: boolean;
  deanVerified: boolean;
  tierReason: string | null;
}

export type TierKey = 'T1' | 'T2' | 'T3' | 'T4' | 'none';

export interface Aggregates {
  total: number;
  eligible: number;
  byTier: Record<TierKey, number>;
  byCadre: Record<string, { total: number; eligible: number; tiers: Record<TierKey, number> }>;
}

export interface TrackingResponse {
  year: { id: string; label: string };
  hasTargets: boolean;
  aggregates: Aggregates;
  rows: TrackingRow[];
}

export interface SnapshotResult {
  dryRun: boolean;
  message: string;
  quarter: string;
  faculty: number;
  // Dry-run only — the real run reports just the snapshot count.
  recipients?: number;
  optedOut?: number;
  alreadySent?: number;
  noEmail?: number;
}

export const trackingApi = {
  get: (academicYearId?: string): Promise<TrackingResponse> =>
    api.get('/tracking', { params: academicYearId ? { academicYearId } : {} }).then((r) => r.data),
  // The real run emails every opted-in faculty. Without `confirm` the server
  // does a dry run and reports who WOULD be mailed.
  runSnapshot: (academicYearId?: string, confirm = false): Promise<SnapshotResult> =>
    api
      .post('/admin/tracking/snapshot', { ...(academicYearId ? { academicYearId } : {}), ...(confirm ? { confirm: true } : {}) })
      .then((r) => r.data),
  setTier: (userId: string, academicYearId: string, tier: 'T1' | 'T2' | 'T3' | 'T4' | null, tierReason?: string | null) =>
    api.put('/admin/faculty-tiers', { userId, academicYearId, tier, tierReason }).then((r) => r.data),
  setEligible: (userId: string, academicYearId: string, eligible: boolean | null) =>
    api.put('/admin/faculty-tiers', { userId, academicYearId, eligible }).then((r) => r.data),
  exportExcel: async (academicYearId: string, label: string) => {
    const blob = await api
      .get('/tracking/export', { params: { academicYearId, format: 'excel' }, responseType: 'blob' })
      .then((r) => r.data as Blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cadre-tier-${label}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
