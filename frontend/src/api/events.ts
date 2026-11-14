import api from './client';

export interface EventFilters { type?: string; scope?: string; dept?: string }
export interface EventReportParams extends EventFilters { fields?: string }

export const eventApi = {
  list: (params?: EventFilters) => api.get('/events', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/events/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/events', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/events/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/events/${id}`).then((r) => r.data),
  reportExcel: (params?: EventReportParams): Promise<Blob> =>
    api.get('/events/report/excel', { params, responseType: 'blob' }).then((r) => r.data),
  reportPdf: (params?: EventReportParams): Promise<Blob> =>
    api.get('/events/report/pdf', { params, responseType: 'blob' }).then((r) => r.data),
};
