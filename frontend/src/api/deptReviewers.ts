import api from './client';

export interface DeptRosterMember {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  isReviewer: boolean;
}

// The HoD's own-department reviewer (incharge) management. Every call is scoped
// to the HoD's department on the server.
export const deptReviewerApi = {
  list: (): Promise<DeptRosterMember[]> =>
    api.get('/department/reviewers').then((r) => r.data),
  add: (userId: string): Promise<unknown> =>
    api.post('/department/reviewers', { userId }).then((r) => r.data),
  remove: (userId: string): Promise<void> =>
    api.delete(`/department/reviewers/${userId}`).then(() => undefined),
};
