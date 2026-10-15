import { useEffect, useRef, useState } from 'react';
import { Upload, FileText, X, Eye, Loader2, Link as LinkIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadApi } from '../api/uploads';

interface Props {
  value: string | null | undefined;          // current file URL
  onChange: (url: string | null) => void;
  readOnly?: boolean;
  accept?: string;
  label?: string;
}

const DEFAULT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url) && !url.includes('/uploads/');
}

function fileName(url: string): string {
  if (isExternal(url)) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'link'; }
  }
  // strip uuid prefix "<uuid>-name.ext" → "name.ext"
  const base = url.split('/').pop() ?? url;
  const dash = base.indexOf('-', 36); // uuid is 36 chars
  return dash > 0 ? base.slice(dash + 1) : base;
}

export default function FileUpload({ value, onChange, readOnly, accept = DEFAULT_ACCEPT, label }: Props) {
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [linkMode, setLinkMode] = useState(false);
  const [link, setLink] = useState('');
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { uploadApi.limits().then((l) => setMaxMb(l.maxMb)).catch(() => {}); }, []);

  // Human-readable accepted formats from the accept list (".pdf,.jpg" -> "PDF, JPG").
  const formats = [...new Set(accept.split(',').map((s) => s.trim().replace(/^\./, '').toUpperCase()).filter(Boolean))].join(', ');

  const saveLink = () => {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast.error('Enter a valid link (https://…)');
      return;
    }
    onChange(url);
    setLink('');
    setLinkMode(false);
    toast.success('Link saved');
  };

  const onPick = async (file: File) => {
    // Check the size before uploading. The server enforces this too, but there
    // is no reason to push 40 MB up the wire only to be refused at the far end.
    // Links are exempt — they never pass through the upload path at all.
    try {
      const { maxBytes, maxMb } = await uploadApi.limits();
      if (file.size > maxBytes) {
        toast.error(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${maxMb} MB. ` +
          'Upload a smaller file, or use Link to point at it instead.'
        );
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
    } catch {
      // Limits unavailable — let the server be the judge rather than blocking.
    }

    setUploading(true);
    setPct(0);
    try {
      const res = await uploadApi.uploadProof(file, setPct);
      onChange(res.url);
      toast.success('Proof uploaded');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    const url = value;
    onChange(null);
    if (url) uploadApi.deleteProof(url).catch(() => {}); // best-effort
  };

  // Open the proof — external links directly, internal files via the
  // authenticated route (not a direct URL).
  const openProof = async () => {
    if (!value) return;
    if (isExternal(value)) {
      window.open(value, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const objectUrl = await uploadApi.viewProof(value);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e: any) {
      toast.error(e?.response?.status === 403 ? 'Not authorized to view this file' : 'Could not open file');
    }
  };

  // Read-only: just a view link (or dash)
  if (readOnly) {
    if (!value) return <span className="text-xs text-ink-subtle">—</span>;
    return (
      <button type="button" onClick={openProof}
         className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
        <Eye size={11} /> View proof
      </button>
    );
  }

  // Uploaded state
  if (value && !uploading) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <FileText size={13} className="text-primary-600 shrink-0" />
        <button type="button" onClick={openProof}
           className="text-primary-600 hover:underline truncate max-w-[140px] text-left" title={fileName(value)}>
          {fileName(value)}
        </button>
        <button type="button" onClick={remove} className="text-danger-500 hover:text-red-700 shrink-0" title="Remove">
          <X size={13} />
        </button>
      </div>
    );
  }

  // Uploading
  if (uploading) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 size={13} className="animate-spin" /> Uploading {pct}%
      </div>
    );
  }

  // Link-paste mode (e.g. Google Drive share link)
  if (linkMode) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } }}
          placeholder="Paste link (Google Drive…)"
          className="text-xs border border-surface-border rounded px-2 py-1 w-48 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button type="button" onClick={saveLink} className="text-xs text-primary-600 hover:underline">Save</button>
        <button type="button" onClick={() => { setLinkMode(false); setLink(''); }} className="text-xs text-ink-muted hover:underline">Cancel</button>
      </div>
    );
  }

  // Empty — upload button + paste-link option
  return (
    <div className="flex flex-col gap-1">
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 text-xs border border-surface-border rounded px-2.5 py-1 text-ink-secondary hover:bg-surface-muted hover:border-primary-300"
      >
        <Upload size={12} /> {label ?? 'Upload proof'}
      </button>
      <button
        type="button"
        onClick={() => setLinkMode(true)}
        className="inline-flex items-center gap-1.5 text-xs border border-surface-border rounded px-2.5 py-1 text-ink-secondary hover:bg-surface-muted hover:border-primary-300"
      >
        <LinkIcon size={12} /> Link
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
      />
    </div>
      <p className="text-[11px] text-ink-muted">
        {formats}{maxMb ? ` · max ${maxMb} MB` : ''} — or paste a link for a larger file
      </p>
    </div>
  );
}
