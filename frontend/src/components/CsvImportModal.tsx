import { useEffect, useRef, useState } from 'react';
import { Upload, Download, X, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { userApi } from '../api/users';
import api from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lockedDepartmentId?: string;
}

type Stage = 'upload' | 'preview' | 'importing' | 'done';

export default function CsvImportModal({ open, onClose, onSuccess, lockedDepartmentId }: Props) {
  const [stage, setStage] = useState<Stage>('upload');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [departmentId, setDepartmentId] = useState(lockedDepartmentId ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  // Load departments once when the modal opens (needed to assign all imported rows).
  useEffect(() => {
    if (!open) return;
    userApi.listDepartments().then(setDepartments).catch(() => toast.error('Failed to load departments'));
  }, [open]);

  const reset = () => {
    setStage('upload');
    setCsvText('');
    setFileName('');
    setPreview(null);
    setResult(null);
    setBusy(false);
    setDepartmentId(lockedDepartmentId ?? '');
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file: File) => {
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv');
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');
    if (!isCsv && !isXlsx) {
      toast.error('File must be .csv or .xlsx');
      return;
    }
    if (isCsv) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCsvText(String(e.target?.result ?? ''));
        setFileName(file.name);
      };
      reader.readAsText(file);
      return;
    }
    // .xlsx / .xls — parse the first sheet to CSV in the browser, then reuse the
    // same CSV pipeline. SheetJS is loaded lazily so it stays out of the main bundle.
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('no sheet');
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      setCsvText(csv);
      setFileName(file.name);
    } catch {
      toast.error('Failed to read spreadsheet');
    }
  };

  const runDryRun = async () => {
    if (!csvText.trim()) {
      toast.error('No CSV content');
      return;
    }
    if (!departmentId) {
      toast.error('Select a department first');
      return;
    }
    setBusy(true);
    try {
      const r = await userApi.bulkImportUsers(csvText, departmentId, true);
      setPreview(r);
      setStage('preview');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Validation failed');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setStage('importing');
    try {
      const r = await userApi.bulkImportUsers(csvText, departmentId, false);
      setResult(r);
      setStage('done');
      if (r.createdCount > 0) {
        toast.success(`Created ${r.createdCount} user(s)`);
        onSuccess();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Import failed');
      setStage('preview');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get('/admin/users/bulk-import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'user-import-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Template download failed');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={close}>
      <div className="bg-surface-card rounded-md max-w-4xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
          <h2 className="font-bold font-serif flex items-center gap-2">
            <FileSpreadsheet size={18} /> Bulk Import Users via CSV
          </h2>
          <button onClick={close} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5">
          {/* Stage: upload */}
          {stage === 'upload' && (
            <div>
              <div className="bg-primary-50 border border-primary-200 rounded p-3 mb-4 text-xs text-primary-700">
                <strong>Format (.csv or .xlsx):</strong> First row = column headers: <code>S.NO, EMP ID, Name of the Faculty, Designation, D.O.J, Mobile Number, E - Mail ID</code>. Required: <code>EMP ID, Name, E - Mail ID</code>. D.O.J accepts <code>DD-MM-YYYY</code> or <code>YYYY-MM-DD</code>. Excel files use the first sheet.
                <br />
                All rows are imported as <strong>Faculty</strong> into the selected department with default password <code>Welcome@123</code> (users change it on first login). Promote to HoD/Reviewer/Admin individually after import.
              </div>

              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 text-sm text-primary-600 hover:underline mb-4"
              >
                <Download size={14} /> Download template CSV
              </button>

              <div className="mb-4">
                <label className="block text-xs font-medium text-ink-secondary mb-1">
                  Department <span className="text-danger-500">*</span> <span className="text-ink-muted font-normal">— applied to every row</span>
                </label>
                {lockedDepartmentId ? (
                  <div className="w-full text-sm border border-surface-border rounded px-3 py-2 bg-surface-muted text-ink-primary">
                    {departments.find((d: any) => d.id === lockedDepartmentId)?.name ?? 'Your department'}
                  </div>
                ) : (
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full text-sm border border-surface-border rounded px-3 py-2 bg-surface-card"
                  >
                    <option value="">Select department…</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>
                    ))}
                  </select>
                )}
              </div>

              <label
                className="block border-2 border-dashed border-surface-border rounded p-8 text-center cursor-pointer hover:bg-surface-muted/50 transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-surface-muted'); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove('bg-surface-muted'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('bg-surface-muted');
                  const f = e.dataTransfer.files?.[0];
                  if (f) onFile(f);
                }}
              >
                <Upload className="mx-auto text-ink-subtle mb-2" size={32} />
                <div className="text-sm text-ink-secondary mb-1">Click to browse or drag-drop a CSV or Excel file</div>
                <div className="text-xs text-ink-muted">.csv or .xlsx · Max 500 rows per import</div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                />
              </label>

              {fileName && (
                <div className="mt-3 text-sm text-ink-primary flex items-center gap-2">
                  <FileSpreadsheet size={14} className="text-primary-600" />
                  Selected: <strong>{fileName}</strong>
                  <span className="text-xs text-ink-muted">({(csvText.length / 1024).toFixed(1)} KB)</span>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={close} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
                <button
                  onClick={runDryRun}
                  disabled={!csvText.trim() || !departmentId || busy}
                  className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
                >
                  {busy ? 'Validating...' : 'Validate'}
                </button>
              </div>
            </div>
          )}

          {/* Stage: preview */}
          {stage === 'preview' && preview && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-surface-muted rounded p-3 text-center">
                  <div className="text-xs text-ink-muted">Total Rows</div>
                  <div className="text-2xl font-bold text-ink-primary">{preview.total}</div>
                </div>
                <div className="bg-emerald-50 rounded p-3 text-center">
                  <div className="text-xs text-success-500">Valid</div>
                  <div className="text-2xl font-bold text-success-500">{preview.validCount}</div>
                </div>
                <div className="bg-red-50 rounded p-3 text-center">
                  <div className="text-xs text-danger-500">Errors</div>
                  <div className="text-2xl font-bold text-danger-500">{preview.invalidCount}</div>
                </div>
              </div>

              <div className="bg-primary-50 border border-primary-200 rounded p-3 mb-4 text-xs text-primary-700">
                Importing into <strong>{preview.department}</strong> as <strong>Faculty</strong>. Default password: <code>{preview.defaultPassword}</code>.
              </div>

              <div className="border border-surface-border rounded overflow-hidden max-h-80 overflow-y-auto mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-primary-700 text-white sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Row</th>
                      <th className="text-left px-3 py-2 font-medium">Code</th>
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Email</th>
                      <th className="text-left px-3 py-2 font-medium">Dept</th>
                      <th className="text-left px-3 py-2 font-medium">Role</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {preview.preview.map((p: any) => (
                      <tr key={p.row} className={p.errors.length ? 'bg-red-50' : ''}>
                        <td className="px-3 py-1.5 text-ink-muted">{p.row}</td>
                        <td className="px-3 py-1.5 font-mono text-ink-primary">{p.data.employeeCode}</td>
                        <td className="px-3 py-1.5">{p.data.name}</td>
                        <td className="px-3 py-1.5 text-ink-muted">{p.data.email}</td>
                        <td className="px-3 py-1.5 text-ink-muted">{p.data.department}</td>
                        <td className="px-3 py-1.5 text-ink-muted">{p.data.role}</td>
                        <td className="px-3 py-1.5">
                          {p.errors.length === 0 ? (
                            <span className="text-success-500 flex items-center gap-1"><CheckCircle2 size={11} /> OK</span>
                          ) : (
                            <span className="text-danger-500 flex items-center gap-1" title={p.errors.join('\n')}>
                              <AlertCircle size={11} /> {p.errors[0]}{p.errors.length > 1 ? ` (+${p.errors.length - 1} more)` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.total > preview.preview.length && (
                <p className="text-xs text-ink-muted mb-3">Showing first {preview.preview.length} of {preview.total} rows in preview.</p>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => setStage('upload')} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Back</button>
                <button
                  onClick={runImport}
                  disabled={preview.validCount === 0 || busy}
                  className="text-sm bg-success-500 text-white px-4 py-2 rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  Import {preview.validCount} valid row(s)
                </button>
              </div>
            </div>
          )}

          {/* Stage: importing */}
          {stage === 'importing' && (
            <div className="py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
              <p className="text-sm text-ink-secondary">Creating users — please wait...</p>
            </div>
          )}

          {/* Stage: done */}
          {stage === 'done' && result && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-emerald-50 rounded p-3 text-center">
                  <div className="text-xs text-success-500">Created</div>
                  <div className="text-2xl font-bold text-success-500">{result.createdCount}</div>
                </div>
                <div className="bg-amber-50 rounded p-3 text-center">
                  <div className="text-xs text-warning-500">Skipped (errors)</div>
                  <div className="text-2xl font-bold text-warning-500">{result.skippedCount}</div>
                </div>
                <div className="bg-red-50 rounded p-3 text-center">
                  <div className="text-xs text-danger-500">Failed (DB error)</div>
                  <div className="text-2xl font-bold text-danger-500">{result.failedCount}</div>
                </div>
              </div>

              {result.failed?.length > 0 && (
                <div className="border border-red-200 rounded p-3 mb-3 bg-red-50">
                  <div className="text-xs font-semibold text-danger-500 mb-2">Failed Rows:</div>
                  {result.failed.map((f: any) => (
                    <div key={f.row} className="text-xs text-ink-primary mb-1">
                      Row {f.row} ({f.employeeCode}): <span className="text-danger-500">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.skipped?.length > 0 && (
                <details className="border border-amber-200 rounded p-3 mb-3 bg-amber-50">
                  <summary className="text-xs font-semibold text-warning-500 cursor-pointer">Skipped Rows ({result.skipped.length})</summary>
                  <div className="mt-2 max-h-40 overflow-y-auto">
                    {result.skipped.map((s: any) => (
                      <div key={s.row} className="text-xs text-ink-primary mb-1">
                        Row {s.row} ({s.employeeCode || '—'}): <span className="text-warning-500">{s.errors.join('; ')}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => { reset(); }} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Import More</button>
                <button onClick={close} className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
