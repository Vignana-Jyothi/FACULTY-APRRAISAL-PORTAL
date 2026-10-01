import api from './client';

export const userApi = {
  getMe: () => api.get('/users/me').then((r) => r.data),
  updateProfile: (data: any) => api.put('/users/me/profile', data).then((r) => r.data),
  requestPasswordOtp: (currentPassword: string) =>
    api.post('/users/me/password-otp', { currentPassword }).then((r) => r.data),
  changePasswordWithOtp: (otp: string, newPassword: string) =>
    api.post('/users/me/change-password', { otp, newPassword }).then((r) => r.data),
  listUsers: (params?: Record<string, string>) =>
    api.get('/admin/users', { params }).then((r) => r.data),
  createUser: (data: any) => api.post('/admin/users', data).then((r) => r.data),
  updateUser: (id: string, data: any) => api.put(`/admin/users/${id}`, data).then((r) => r.data),
  // Soft delete — deactivates the account and stands down its roles. Appraisals,
  // the reviews this user gave, and the audit trail are all kept.
  deactivateUser: (id: string) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  reactivateUser: (id: string) =>
    api.post(`/admin/users/${id}/reactivate`).then((r) => r.data),
  // Operator-set password reset. Sets a temporary password the user must change
  // at next sign-in and kills their existing sessions. Scoped to the caller's
  // department for a DEPT_ADMIN, any user for the institute admin.
  resetPassword: (id: string, newPassword: string) =>
    api.post(`/admin/users/${id}/reset-password`, { newPassword }).then((r) => r.data),
  assignRole: (id: string, role: string, departmentId?: string) =>
    api.post(`/admin/users/${id}/roles`, { role, departmentId }).then((r) => r.data),
  revokeRole: (userId: string, roleId: string) =>
    api.delete(`/admin/users/${userId}/roles/${roleId}`).then((r) => r.data),
  // includeInactive is honoured for admins only — it keeps roles attached to a
  // switched-off department visible so they can still be revoked.
  listDepartments: (includeInactive?: boolean) =>
    api
      .get('/departments', includeInactive ? { params: { includeInactive: 'true' } } : undefined)
      .then((r) => r.data),
  listAcademicYears: () => api.get('/academic-years').then((r) => r.data),
  listAdminAcademicYears: () => api.get('/admin/academic-years').then((r) => r.data),
  createAcademicYear: (data: any) => api.post('/admin/academic-years', data).then((r) => r.data),
  updateAcademicYear: (id: string, data: any) =>
    api.put(`/admin/academic-years/${id}`, data).then((r) => r.data),
  createDepartment: (data: any) => api.post('/admin/departments', data).then((r) => r.data),
  updateDepartment: (id: string, data: any) =>
    api.put(`/admin/departments/${id}`, data).then((r) => r.data),
  // Soft delete — deactivates the department; nothing attached to it is removed.
  deleteDepartment: (id: string) =>
    api.delete(`/admin/departments/${id}`).then((r) => r.data),
  reactivateDepartment: (id: string) =>
    api.post(`/admin/departments/${id}/reactivate`).then((r) => r.data),
  bulkImportUsers: (csv: string, departmentId: string, dryRun: boolean) =>
    api.post('/admin/users/bulk-import', { csv, departmentId, dryRun }).then((r) => r.data),
  bulkImportTemplateUrl: () => '/api/admin/users/bulk-import/template',
};
