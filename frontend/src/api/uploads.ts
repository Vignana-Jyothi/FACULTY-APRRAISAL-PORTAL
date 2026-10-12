import api from './client';

export interface UploadLimits {
  maxMb: number;
  maxBytes: number;
  allowedMime: string[];
}

// Fetched once per session — the limit is server configuration, not something
// the client should hardcode and drift from.
let limitsPromise: Promise<UploadLimits> | null = null;

export const uploadApi = {
  limits: (): Promise<UploadLimits> => {
    if (!limitsPromise) {
      limitsPromise = api.get('/config/uploads')
        .then((r) => r.data as UploadLimits)
        .catch((e) => { limitsPromise = null; throw e; });
    }
    return limitsPromise;
  },

  uploadProof: (file: File, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/uploads/proof', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    }).then((r) => r.data as { url: string; originalName: string; size: number; mimeType: string });
  },
  deleteProof: (url: string) =>
    api.delete('/uploads/proof', { data: { url } }).then((r) => r.data),

  // Fetch a proof via the authenticated route and return an object URL.
  // Caller must URL.revokeObjectURL() when done.
  viewProof: async (url: string) => {
    const filename = url.split('/').pop() ?? url;
    const blob = await api.get(`/uploads/file/${encodeURIComponent(filename)}`, { responseType: 'blob' }).then((r) => r.data as Blob);
    return URL.createObjectURL(blob);
  },

  // Download a proof to disk via the authenticated route, keeping its filename.
  downloadProof: async (url: string) => {
    const filename = url.split('/').pop() ?? 'proof';
    const blob = await api.get(`/uploads/file/${encodeURIComponent(filename)}`, { responseType: 'blob' }).then((r) => r.data as Blob);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  },
};
