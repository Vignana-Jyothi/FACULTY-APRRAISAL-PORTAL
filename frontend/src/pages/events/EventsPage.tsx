import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Download, X } from 'lucide-react';
import { eventApi } from '../../api/events';
import { userApi } from '../../api/users';
import { useAuthStore } from '../../store/authStore';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import FileUpload from '../../components/FileUpload';
import { SkeletonTable } from '../../components/Skeleton';

const TYPE_LABELS: Record<string, string> = {
  FDP: 'FDP',
  GUEST_LECTURE: 'Guest Lecture',
  SEMINAR: 'Seminar',
  WORKSHOP: 'Workshop',
  INDUSTRY_VISIT: 'Industry Visit',
  HACKATHON: 'Hackathon',
  INDUCTION_PROGRAM: 'Induction Program',
  CODING_CONTEST: 'Coding Contest',
  PTM: 'PTM',
  CONFERENCE: 'Conference',
};
const SCOPE_LABELS: Record<string, string> = {
  INTERNATIONAL: 'International',
  NATIONAL: 'National',
  INTER_COLLEGE: 'Inter College',
  INTRA_COLLEGE: 'Intra College',
};
const COLLAB_LABELS: Record<string, string> = {
  INDUSTRY: 'Industry',
  INSTITUTE: 'Institute',
  PROFESSIONAL_CHAPTER: 'Professional Chapter',
};
const REPORT_FIELDS: [string, string][] = [
  ['eventName', 'Event Name'],
  ['type', 'Type'],
  ['scope', 'Scope'],
  ['eventDate', 'Date'],
  ['description', 'Description'],
  ['coordinators', 'Coordinators'],
  ['venue', 'Venue'],
  ['audienceInternal', 'Audience (Internal)'],
  ['audienceOutsiders', 'Audience (Outsiders)'],
  ['hasCollaboration', 'Collaboration'],
  ['collabType', 'Collaboration Type'],
  ['collaboratorName', 'Collaborator'],
  ['sponsorship', 'Sponsorship'],
  ['outcomes', 'Outcomes'],
  ['department', 'Department'],
];

const emptyForm = () => ({
  departmentId: '',
  eventName: '',
  type: '',
  scope: '',
  eventDate: '',
  description: '',
  outcomes: '',
  venue: '',
  coordinators: [''] as string[],
  audienceInternal: '',
  audienceOutsiders: '',
  hasCollaboration: false,
  collabType: '',
  collaboratorName: '',
  sponsorship: '',
  scheduleFileUrl: null as string | null,
  photoUrls: [] as string[],
});

const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
};

export default function EventsPage() {
  const { isAdmin, isDeptAdmin, hasRole } = useAuthStore();
  const authUser = useAuthStore((s) => s.user);
  const canManage = isDeptAdmin() || hasRole('HOD');
  const isCampus = isAdmin() || hasRole('DEAN') || hasRole('PRINCIPAL');
  const deptScoped = canManage && !isCampus;
  const myDeptId = authUser?.roles.find((r) => r.role === 'DEPT_ADMIN' || r.role === 'HOD')?.departmentId ?? '';

  const [events, setEvents] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [fields, setFields] = useState<Set<string>>(new Set(REPORT_FIELDS.map(([k]) => k)));
  const [downloading, setDownloading] = useState(false);

  const filterParams = () => {
    const p: any = {};
    if (typeFilter) p.type = typeFilter;
    if (scopeFilter) p.scope = scopeFilter;
    if (isCampus && deptFilter) p.dept = deptFilter;
    return p;
  };

  const load = () => {
    setLoading(true);
    eventApi.list(filterParams())
      .then(setEvents)
      .catch(() => toast.error('Failed to load events'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [typeFilter, scopeFilter, deptFilter]);
  useEffect(() => { userApi.listDepartments().then(setDepts).catch(() => {}); }, []);

  const openCreate = () => {
    setForm({ ...emptyForm(), departmentId: deptScoped ? myDeptId : '' });
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (ev: any) => {
    setForm({
      departmentId: ev.departmentId,
      eventName: ev.eventName ?? '',
      type: ev.type ?? '',
      scope: ev.scope ?? '',
      eventDate: ev.eventDate ? ev.eventDate.slice(0, 10) : '',
      description: ev.description ?? '',
      outcomes: ev.outcomes ?? '',
      venue: ev.venue ?? '',
      coordinators: ev.coordinators?.length ? [...ev.coordinators] : [''],
      audienceInternal: ev.audienceInternal != null ? String(ev.audienceInternal) : '',
      audienceOutsiders: ev.audienceOutsiders != null ? String(ev.audienceOutsiders) : '',
      hasCollaboration: !!ev.hasCollaboration,
      collabType: ev.collabType ?? '',
      collaboratorName: ev.collaboratorName ?? '',
      sponsorship: ev.sponsorship ?? '',
      scheduleFileUrl: ev.scheduleFileUrl ?? null,
      photoUrls: ev.photoUrls ?? [],
    });
    setEditId(ev.id);
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = (v: string) => (v === '' ? null : Number(v));
    const payload: any = {
      eventName: form.eventName.trim(),
      type: form.type,
      scope: form.scope || null,
      eventDate: form.eventDate || null,
      description: form.description,
      outcomes: form.outcomes,
      venue: form.venue,
      coordinators: form.coordinators.map((c) => c.trim()).filter(Boolean),
      audienceInternal: num(form.audienceInternal),
      audienceOutsiders: num(form.audienceOutsiders),
      hasCollaboration: form.hasCollaboration,
      collabType: form.hasCollaboration ? form.collabType || null : null,
      collaboratorName: form.hasCollaboration ? form.collaboratorName : null,
      sponsorship: form.hasCollaboration ? form.sponsorship : null,
      scheduleFileUrl: form.scheduleFileUrl,
      photoUrls: form.photoUrls,
    };
    try {
      if (editId) {
        await eventApi.update(editId, payload);
        toast.success('Event updated');
      } else {
        await eventApi.create({ ...payload, departmentId: form.departmentId });
        toast.success('Event created');
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const remove = async (ev: any) => {
    if (!confirm(`Delete event "${ev.eventName}"? This cannot be undone.`)) return;
    try {
      await eventApi.remove(ev.id);
      toast.success('Event deleted');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const toggleField = (k: string) =>
    setFields((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const download = async (kind: 'excel' | 'pdf') => {
    if (fields.size === 0) { toast.error('Select at least one field'); return; }
    setDownloading(true);
    try {
      const params = { ...filterParams(), fields: [...fields].join(',') };
      const blob = kind === 'excel' ? await eventApi.reportExcel(params) : await eventApi.reportPdf(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = kind === 'excel' ? 'dept-events.xlsx' : 'dept-events.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const canEditRow = (ev: any) => canManage && (isCampus || ev.departmentId === myDeptId);

  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";
  const labelCls = "block text-xs font-medium text-ink-secondary mb-1";
  const selectCls = "border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";
  const btnSecondary = "flex items-center gap-2 border border-surface-border bg-surface-card text-ink-primary px-4 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50";

  return (
    <div>
      <PageHeader
        title="Department Events"
        help="Record department events (FDPs, workshops, guest lectures…) and download reports."
        breadcrumbs={[{ label: 'Events' }]}
        actions={canManage ? (
          <button onClick={openCreate} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Event
          </button>
        ) : undefined}
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls} title="Filter by type">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className={selectCls} title="Filter by scope">
          <option value="">All scopes</option>
          {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isCampus && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className={selectCls} title="Filter by department">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </select>
        )}
        {(typeFilter || scopeFilter || deptFilter) && (
          <button
            onClick={() => { setTypeFilter(''); setScopeFilter(''); setDeptFilter(''); }}
            className="text-xs text-primary-600 hover:underline whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      <Card padding="none" className="mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary-700 text-white text-xs">
              <th className="text-left px-4 py-2.5 font-medium">Event Name</th>
              <th className="text-left px-4 py-2.5 font-medium">Type</th>
              <th className="text-left px-4 py-2.5 font-medium">Scope</th>
              <th className="text-left px-4 py-2.5 font-medium">Date</th>
              <th className="text-left px-4 py-2.5 font-medium">Venue</th>
              {isCampus && <th className="text-left px-4 py-2.5 font-medium">Department</th>}
              <th className="text-left px-4 py-2.5 font-medium">Coordinators</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {events.map((ev, i) => (
              <tr key={ev.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                <td className="px-4 py-2.5 font-medium text-ink-primary">{ev.eventName}</td>
                <td className="px-4 py-2.5 text-ink-muted">{TYPE_LABELS[ev.type] ?? ev.type}</td>
                <td className="px-4 py-2.5 text-ink-muted">{ev.scope ? SCOPE_LABELS[ev.scope] ?? ev.scope : '—'}</td>
                <td className="px-4 py-2.5 text-ink-muted whitespace-nowrap">{fmtDate(ev.eventDate)}</td>
                <td className="px-4 py-2.5 text-ink-muted">{ev.venue || '—'}</td>
                {isCampus && <td className="px-4 py-2.5 text-ink-muted">{ev.department?.code ?? '—'}</td>}
                <td className="px-4 py-2.5 text-ink-muted">{ev.coordinators?.length ? ev.coordinators.join(', ') : '—'}</td>
                <td className="px-4 py-2.5">
                  {canEditRow(ev) && (
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEdit(ev)} className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-medium">
                        <Pencil size={11} /> Edit
                      </button>
                      <button onClick={() => remove(ev)} className="flex items-center gap-1 text-xs text-danger-500 hover:text-red-700">
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && events.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-muted">No events found.</td></tr>
            )}
          </tbody>
        </table>
        {loading && events.length === 0 && (
          <div className="p-2"><SkeletonTable rows={6} cols={7} /></div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Report</h2>
        <p className="text-xs text-ink-muted mb-2">Choose the columns to include. The current filters apply.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {REPORT_FIELDS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
              <input type="checkbox" className="cursor-pointer accent-accent-500" checked={fields.has(k)} onChange={() => toggleField(k)} />
              {label}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => download('excel')} disabled={downloading} className={btnSecondary}>
            <Download size={14} /> Download Excel
          </button>
          <button onClick={() => download('pdf')} disabled={downloading} className={btnSecondary}>
            <Download size={14} /> Download PDF
          </button>
        </div>
      </Card>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-surface-card rounded-md max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
              <h2 className="font-bold font-serif flex items-center gap-2">
                {editId ? <><Pencil size={16} /> Edit Event</> : <><Plus size={16} /> New Event</>}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-white/70 hover:text-white text-lg leading-none">×</button>
            </div>
            <form onSubmit={save} className="p-5 grid grid-cols-2 gap-3 overflow-y-auto">
              <div className="col-span-2">
                <label className={labelCls}>Event Name</label>
                <input required value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={`${inputCls}`}>
                  <option value="">— Select Type —</option>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Scope</label>
                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} className={inputCls}>
                  <option value="">— Select Scope —</option>
                  {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <select
                  required
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  disabled={deptScoped || !!editId}
                  className={`${inputCls} disabled:bg-surface-muted disabled:text-ink-muted`}
                >
                  <option value="">— Select Department —</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Outcomes</label>
                <textarea rows={3} value={form.outcomes} onChange={(e) => setForm({ ...form, outcomes: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Venue</label>
                <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} className={inputCls} />
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Coordinators</label>
                <div className="space-y-2">
                  {form.coordinators.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={c}
                        onChange={(e) => setForm({ ...form, coordinators: form.coordinators.map((x, j) => (j === i ? e.target.value : x)) })}
                        placeholder="Coordinator name"
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, coordinators: form.coordinators.length > 1 ? form.coordinators.filter((_, j) => j !== i) : [''] })}
                        className="text-danger-500 hover:text-red-700 shrink-0"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, coordinators: [...form.coordinators, ''] })}
                    className="text-xs text-primary-600 hover:underline font-medium"
                  >
                    + Add coordinator
                  </button>
                </div>
              </div>

              <div>
                <label className={labelCls}>Audience — Internal</label>
                <input type="number" min={0} value={form.audienceInternal} onChange={(e) => setForm({ ...form, audienceInternal: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Audience — Outsiders</label>
                <input type="number" min={0} value={form.audienceOutsiders} onChange={(e) => setForm({ ...form, audienceOutsiders: e.target.value })} className={inputCls} />
              </div>

              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    className="cursor-pointer accent-accent-500"
                    checked={form.hasCollaboration}
                    onChange={(e) => setForm({ ...form, hasCollaboration: e.target.checked })}
                  />
                  Has collaboration
                </label>
              </div>
              {form.hasCollaboration && (
                <>
                  <div>
                    <label className={labelCls}>Collaboration Type</label>
                    <select value={form.collabType} onChange={(e) => setForm({ ...form, collabType: e.target.value })} className={inputCls}>
                      <option value="">— Select —</option>
                      {Object.entries(COLLAB_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Collaborator Name</label>
                    <input value={form.collaboratorName} onChange={(e) => setForm({ ...form, collaboratorName: e.target.value })} className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Sponsorship</label>
                    <input value={form.sponsorship} onChange={(e) => setForm({ ...form, sponsorship: e.target.value })} className={inputCls} />
                  </div>
                </>
              )}

              <div className="col-span-2">
                <label className={labelCls}>Schedule</label>
                <FileUpload
                  value={form.scheduleFileUrl}
                  onChange={(url) => setForm({ ...form, scheduleFileUrl: url })}
                  label="Upload schedule"
                />
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Photos (up to 2)</label>
                <div className="space-y-2">
                  {form.photoUrls.map((u, i) => (
                    <FileUpload
                      key={u}
                      value={u}
                      onChange={(url) => setForm((f) => ({
                        ...f,
                        photoUrls: url ? f.photoUrls.map((x, j) => (j === i ? url : x)) : f.photoUrls.filter((_, j) => j !== i),
                      }))}
                    />
                  ))}
                  {form.photoUrls.length < 2 && (
                    <FileUpload
                      key={`new-${form.photoUrls.length}`}
                      value={null}
                      label="Upload photo"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={(url) => { if (url) setForm((f) => ({ ...f, photoUrls: [...f.photoUrls, url].slice(0, 2) })); }}
                    />
                  )}
                </div>
              </div>

              <div className="col-span-2 flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
                <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">{editId ? 'Save' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
