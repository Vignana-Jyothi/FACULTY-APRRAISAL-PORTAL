import api from './client';
import type { Quarter } from './reviewWindows';

export interface DeptReviewWindow {
  id: string;
  academicYearId: string;
  departmentId: string;
  quarter: Quarter;
  startDate: string;
  endDate: string;
  enabled: boolean;
  setById: string | null;
  lastMailAt: string | null;
}

// The dean's bounds for a quarter — the HoD window must sit inside these.
export interface DeanBound {
  startDate: string;
  endDate: string;
  enabled: boolean;
}

export interface DeptReviewWindowInput {
  academicYearId: string;
  departmentId: string;
  quarter: Quarter;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  enabled?: boolean;
}

export interface DeptReviewWindowList {
  windows: DeptReviewWindow[];
  deanBounds: Partial<Record<Quarter, DeanBound>>;
}

export interface ActivityRow {
  userId: string;
  name: string;
  employeeCode: string;
  email: string | null;
  optedOut: boolean;
  hasSubmission: boolean;
  lastEditedAt: string | null;
  daysSinceEdit: number | null;
  status: string; // 'no-submission' | 'stale' | 'active' | 'submitted' | 'under_review' | ...
}

export const deptReviewWindowApi = {
  list: (academicYearId: string, departmentId?: string): Promise<DeptReviewWindowList> =>
    api.get('/dept-review-windows', { params: { academicYearId, departmentId } }).then((r) => r.data),
  upsert: (body: DeptReviewWindowInput): Promise<DeptReviewWindow> =>
    api.put('/dept-review-windows', body).then((r) => r.data),
  remove: (id: string): Promise<void> =>
    api.delete(`/dept-review-windows/${id}`).then(() => undefined),
  activity: (academicYearId: string, departmentId?: string): Promise<{ rows: ActivityRow[] }> =>
    api.get('/dept-review-windows/activity', { params: { academicYearId, departmentId } }).then((r) => r.data),
  remind: (userId: string, academicYearId: string): Promise<{ queued: boolean; message: string }> =>
    api.post('/dept-review-windows/remind', { userId, academicYearId }).then((r) => r.data),
};
