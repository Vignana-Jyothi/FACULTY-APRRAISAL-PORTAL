import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { appraisalApi } from '../../api/appraisals';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Plus, Send } from 'lucide-react';
import FileUpload from '../../components/FileUpload';
import SelectWithOther from '../../components/SelectWithOther';
import { toDateInputs } from '../../utils/dateInputs';
import { useAuthStore } from '../../store/authStore';
import {
  computeScore, lectureRowScore, projectRowScore, eContentRowScore, ictRowScore,
  publicationScore, publicationClaim, INDEX_LABEL, authorCount, citationScore, bookRowScore, patentRowScore,
  sponsoredProjectRowScore, consultancyRowScore, outcomeRowScore, trainingRowScore,
  type PublicationKind, type ScoreBreakdown,
} from '../../utils/scoring';
import { withAuthorList, publicationClaimConflict } from '../../utils/authors';
import { AuthorListField, PublicationClaimFields } from '../../components/AuthorListField';
import { sponsoredProjectWarnings } from '../../utils/sponsoredProjects';
import { patentWarnings } from '../../utils/patents';
import { citationWarnings } from '../../utils/citations';

const STEPS = ['Leave & Info', 'Teaching (Cat 1)', 'Research (Cat 2)', 'Development (Cat 3)', 'Governance (Cat 4)', 'Supplementary (Cat 5)', 'Preview & Submit'];

// Listed choices for every dropdown that also offers "Other". SelectWithOther
// appends "Other" itself and stores whatever the faculty types in the same
// field (no schema field added). None of these fields feed a score.
const NOVEL_PEDAGOGY_OPTIONS = [
  'Flipped Classroom', 'Project-Based Learning', 'Problem-Based Learning', 'Case Study / Case-Based',
  'Collaborative / Team-Based Learning', 'Active Learning (Think-Pair-Share)', 'Gamification',
  'Blended Learning', 'Experiential / Hands-on', 'Peer Learning',
];
const ECONTENT_NATURES = ['Video', 'Audio', 'PPT'];
const AUTHOR_POSITIONS = ['1st', 'Second', 'Corresponding', 'Supervisor'];
// 2.1 index values in dropdown order; labels come from INDEX_LABEL.
const INDEX_OPTIONS = ['WOS', 'SCOPUS', 'ESCI', 'ICI', 'NONE'];
const IMPACT_FACTOR_SOURCES = ['Clarivate Analytics (JCR)', 'Scopus / SCImago (SJR / CiteScore)', 'Google Scholar'];
const PRESENTATION_STATUSES = ['Accepted', 'Presented'];
const RESOURCE_PROGRAM_TYPES = ['FDP', 'Conference', 'Workshop', 'Guest Lecture', 'Webinar'];
const EDITORIAL_NATURES = ['Editorial Board', 'Review Committee', 'Org Committee', 'Reviewer'];
const ICT_PLATFORMS = ['Google Classroom', 'Moodle', 'MS Teams'];
const ICT_USES = ['Assignments', 'Quizzes', 'Recorded Lectures', 'Discussion Forums'];

// Per-entry working under a row, from the same helper the engines score with.
function RowNote({ r }: { r: { score: number; reason: string } }) {
  return (
    <div className={`col-span-full text-xs ${r.score ? 'text-ink-muted' : 'text-amber-700'}`}>
      {r.reason} → <span className="font-medium">{r.score}</span>
    </div>
  );
}

// A row is only saved if the faculty actually filled its free-text identifier
// (an alphanumeric char) — this drops the empty "Add Row" placeholders and their
// dropdown defaults so an untouched section persists nothing and scores 0.
// Mirrors the backend guard in appraisalController.dropBlankRows.
const ROW_CONTENT_FIELDS: Record<string, string[]> = {
  cat1Courses: ['courseName'],
  cat1EContent: ['contentName', 'courseName'],
  cat1ICT: ['courseName'],
  cat2Journals: ['title', 'journalName'],
  cat2Conferences: ['title', 'conferenceName'],
  cat2ConfBookChapters: ['title', 'conferenceName'],
  cat2Books: ['title'],
  cat2BookChapters: ['title'],
  cat2Patents: ['title'],
  cat2Projects: ['title', 'fundingAgency'],
  cat2Consultancy: ['name', 'agency'],
  cat2Guidance: ['studentName', 'thesisTitle'],
  cat2ResearchGroups: ['groupName'],
  cat2Linkages: ['instituteName'],
  cat2Startups: ['groupName'],
  cat2IndustryLinkages: ['industryName'],
  cat3Organised: ['title'],
  cat3ConferencesAttended: ['paperTitle', 'conferenceName'],
  cat3ResourcePerson: ['programName', 'topic'],
  cat3Editorial: ['orgOrJournal'],
  cat3Training: ['name'],
  cat3IntlTravel: ['purpose', 'placeOrUniv'],
  cat4AdminResp: ['responsibility'],
  cat4StudentAct: ['activityName'],
  cat5Memberships: ['association'],
  cat5Awards: ['awardType', 'organization'],
  cat5Differentiators: ['name'],
  cat5Internships: ['industryOrInst'],
};
const hasText = (row: any, fields: string[]) =>
  fields.some((f) => typeof row?.[f] === 'string' && /[a-z0-9]/i.test(row[f]));

// Remove blank auto-rows from a categories payload (returns a shallow copy).
function stripBlankRows(categories: any): any {
  const out = { ...categories };
  for (const [key, fields] of Object.entries(ROW_CONTENT_FIELDS)) {
    if (Array.isArray(out[key])) out[key] = out[key].filter((r: any) => hasText(r, fields));
  }
  // Projects have no free-text field — keep only rows with a positive count.
  if (Array.isArray(out.cat1Projects)) out.cat1Projects = out.cat1Projects.filter((p: any) => Number(p?.count) > 0);
  return out;
}

// Small inline live-score badge shown beside a subsection heading / category
// header. Purely presentational — value/max are pre-computed by the caller
// from the shared `computeScore` breakdown. Only the DISPLAYED value is
// rounded (float artifacts like 15.700000000000001 → 15.7); the underlying
// `live` value used for logic is never mutated.
const ScoreBadge = ({ value, max }: { value: number; max: number }) => {
  const shown = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  return (
    <span
      aria-label={`score ${shown} of ${max}`}
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-muted text-primary-700 whitespace-nowrap"
    >
      {shown} / {max}
    </span>
  );
};

export default function AppraisalEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [step, setStep] = useState(0);
  const [submission, setSubmission] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [score, setScore] = useState<any>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const { register, control, reset, getValues, setValue } = useForm({
    defaultValues: {
      clLeaves: 0, elLeaves: 0, hplLeaves: 0, odLeaves: 0, otherLeaves: '', higherQualAcquired: '',
      cat1Courses: [] as any[], cat1CourseResults: [] as any[], cat1Projects: [] as any[], cat1EContent: [] as any[], cat1ICT: [] as any[],
      cat2Journals: [] as any[], cat2Conferences: [] as any[], cat2ConfBookChapters: [] as any[], cat2BookChapters: [] as any[],
      cat2Books: [] as any[], cat2Citations: { totalPubsTillDate: 0, pubsWithCitations: 0, totalCitations: 0, hIndexGoogle: 0, hIndexScopus: 0, hIndexWos: 0 },
      cat2Patents: [] as any[], cat2Projects: [] as any[], cat2Consultancy: [] as any[],
      cat2Guidance: [] as any[], cat2ResearchGroups: [] as any[], cat2Linkages: [] as any[], cat2Startups: [] as any[], cat2IndustryLinkages: [] as any[],
      cat3AdvQual: { registeredForPhD: false, clearedPrePhD: false, thesisSubmitted: false, awarded: false, postDoc: false, pgDegree: false, pgDiploma: false },
      cat3Organised: [] as any[], cat3ConferencesAttended: [] as any[], cat3ResourcePerson: [] as any[], cat3Editorial: [] as any[],
      cat3Training: [] as any[], cat3IntlTravel: [] as any[],
      cat4AdminResp: [] as any[], cat4StudentAct: [] as any[],
      cat5Memberships: [] as any[], cat5Awards: [] as any[], cat5Differentiators: [] as any[], cat5Internships: [] as any[],
    },
  });

  // Live per-subsection scoring — recomputed from in-memory form values on
  // every change, no save/recompute round-trip needed. Blank auto-added rows
  // are stripped first (same helper used before save) so an untouched section
  // never shows a misleading non-zero badge.
  const watchedValues = useWatch({ control });
  const live: ScoreBreakdown = useMemo(
    () => computeScore(stripBlankRows(watchedValues)),
    [watchedValues],
  );

  // 3.1 Status of Ph.D. — a single controlled select whose value is DERIVED
  // from the underlying booleans (scoring reads the booleans, so they must
  // keep being written). Priority order for display when multiple are true:
  // postDoc > awarded > thesisSubmitted > pgDegree > pgDiploma > clearedPrePhD > registeredForPhD.
  const advQualKeys = ['registeredForPhD', 'clearedPrePhD', 'thesisSubmitted', 'awarded', 'postDoc', 'pgDegree', 'pgDiploma'] as const;
  const advQualLive = (watchedValues as any)?.cat3AdvQual ?? {};
  const phdStatus: string = advQualLive.postDoc ? 'postDoc'
    : advQualLive.awarded ? 'awarded'
    : advQualLive.thesisSubmitted ? 'thesisSubmitted'
    : advQualLive.pgDegree ? 'pgDegree'
    : advQualLive.pgDiploma ? 'pgDiploma'
    : advQualLive.clearedPrePhD ? 'clearedPrePhD'
    : advQualLive.registeredForPhD ? 'registeredForPhD'
    : 'none';
  const setPhdStatus = (val: string) => {
    for (const k of advQualKeys) setValue(`cat3AdvQual.${k}` as any, k === val, { shouldDirty: true });
  };

  const courses = useFieldArray({ control, name: 'cat1Courses' });
  const courseResults = useFieldArray({ control, name: 'cat1CourseResults' });
  const projects = useFieldArray({ control, name: 'cat1Projects' });
  const eContent = useFieldArray({ control, name: 'cat1EContent' });
  const ict = useFieldArray({ control, name: 'cat1ICT' });
  const journals = useFieldArray({ control, name: 'cat2Journals' });
  const conferences = useFieldArray({ control, name: 'cat2Conferences' });
  const confBookChapters = useFieldArray({ control, name: 'cat2ConfBookChapters' });
  const bookChapters = useFieldArray({ control, name: 'cat2BookChapters' });
  const books = useFieldArray({ control, name: 'cat2Books' });
  const patents = useFieldArray({ control, name: 'cat2Patents' });
  const cat2Proj = useFieldArray({ control, name: 'cat2Projects' });
  const consultancy = useFieldArray({ control, name: 'cat2Consultancy' });
  const guidance = useFieldArray({ control, name: 'cat2Guidance' });
  const researchGroups = useFieldArray({ control, name: 'cat2ResearchGroups' });
  const linkages = useFieldArray({ control, name: 'cat2Linkages' });
  const startups = useFieldArray({ control, name: 'cat2Startups' });
  const industryLinkages = useFieldArray({ control, name: 'cat2IndustryLinkages' });
  const organised = useFieldArray({ control, name: 'cat3Organised' });
  const conferencesAttended = useFieldArray({ control, name: 'cat3ConferencesAttended' });
  const resourcePerson = useFieldArray({ control, name: 'cat3ResourcePerson' });
  const editorial = useFieldArray({ control, name: 'cat3Editorial' });
  const training = useFieldArray({ control, name: 'cat3Training' });
  const intlTravel = useFieldArray({ control, name: 'cat3IntlTravel' });
  const adminResp = useFieldArray({ control, name: 'cat4AdminResp' });
  const studentAct = useFieldArray({ control, name: 'cat4StudentAct' });
  const memberships = useFieldArray({ control, name: 'cat5Memberships' });
  const awards = useFieldArray({ control, name: 'cat5Awards' });
  const differentiators = useFieldArray({ control, name: 'cat5Differentiators' });
  const internships = useFieldArray({ control, name: 'cat5Internships' });

  // False until the draft is in the form. A save before then would PUT the
  // empty defaults and wipe every section of the draft.
  const loadedRef = useRef(false);

  useEffect(() => {
    appraisalApi.get(id!).then((sub) => {
      setSubmission(sub);
      reset({
        clLeaves: sub.clLeaves ?? 0,
        elLeaves: sub.elLeaves ?? 0,
        hplLeaves: sub.hplLeaves ?? 0,
        odLeaves: sub.odLeaves ?? 0,
        otherLeaves: sub.otherLeaves ?? '',
        higherQualAcquired: sub.higherQualAcquired ?? '',
        cat1Courses: sub.cat1Courses ?? [],
        cat1CourseResults: sub.cat1CourseResults ?? [],
        cat1Projects: sub.cat1Projects ?? [],
        cat1EContent: sub.cat1EContent ?? [],
        cat1ICT: sub.cat1ICT ?? [],
        // Date boxes need YYYY-MM-DD; the API sends timestamps (see toDateInputs).
        // 2.1 rows also get an author list, seeded from older free-text authors.
        cat2Journals: withAuthorList(toDateInputs(sub.cat2Journals)),
        cat2Conferences: withAuthorList(toDateInputs(sub.cat2Conferences)),
        cat2ConfBookChapters: withAuthorList(toDateInputs(sub.cat2ConfBookChapters)),
        cat2BookChapters: sub.cat2BookChapters ?? [],
        cat2Books: sub.cat2Books ?? [],
        cat2Citations: sub.cat2Citations ?? { totalPubsTillDate: 0, pubsWithCitations: 0, totalCitations: 0, hIndexGoogle: 0, hIndexScopus: 0, hIndexWos: 0 },
        cat2Patents: toDateInputs(sub.cat2Patents),
        cat2Projects: toDateInputs(sub.cat2Projects),
        cat2Consultancy: sub.cat2Consultancy ?? [],
        cat2Guidance: sub.cat2Guidance ?? [],
        cat2ResearchGroups: sub.cat2ResearchGroups ?? [],
        cat2Linkages: sub.cat2Linkages ?? [],
        cat2Startups: sub.cat2Startups ?? [],
        cat2IndustryLinkages: sub.cat2IndustryLinkages ?? [],
        cat3AdvQual: sub.cat3AdvQual ?? { registeredForPhD: false, clearedPrePhD: false, thesisSubmitted: false, awarded: false, postDoc: false, pgDegree: false, pgDiploma: false },
        cat3Organised: sub.cat3Organised ?? [],
        cat3ConferencesAttended: sub.cat3ConferencesAttended ?? [],
        cat3ResourcePerson: sub.cat3ResourcePerson ?? [],
        cat3Editorial: sub.cat3Editorial ?? [],
        cat3Training: sub.cat3Training ?? [],
        cat3IntlTravel: sub.cat3IntlTravel ?? [],
        cat4AdminResp: sub.cat4AdminResp ?? [],
        cat4StudentAct: sub.cat4StudentAct ?? [],
        cat5Memberships: sub.cat5Memberships ?? [],
        cat5Awards: sub.cat5Awards ?? [],
        cat5Differentiators: sub.cat5Differentiators ?? [],
        cat5Internships: sub.cat5Internships ?? [],
      });
      loadedRef.current = true;
    }).catch(() => toast.error('Failed to load submission'));
  }, [id]);

  // Recursive NaN scrubber — number inputs left blank produce NaN. Replace with 0.
  const deNan = (v: any): any => {
    if (Array.isArray(v)) return v.map(deNan);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const k of Object.keys(v)) out[k] = deNan(v[k]);
      return out;
    }
    if (typeof v === 'number' && Number.isNaN(v)) return 0;
    return v;
  };

  // Serialize saves — prevent overlapping requests racing.
  const saveLock = useRef<Promise<void>>(Promise.resolve());

  const saveData = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!loadedRef.current) {
      if (silent) return;
      toast.error('Still loading your draft — try again in a moment');
      throw Object.assign(new Error('not loaded'), { shown: true });
    }
    // Wait for previous save to finish before starting next.
    const prev = saveLock.current;
    let release: () => void = () => {};
    saveLock.current = new Promise<void>((res) => { release = res; });
    try {
      await prev;
      if (!silent) setSaving(true);
      const values = deNan(getValues());
      // A 2.1 paper claimed by another co-author cannot be saved (the server
      // refuses it too). Say so even on a silent autosave, or a step change
      // would just stall.
      const conflict = publicationClaimConflict(values);
      if (conflict) {
        toast.error(conflict);
        throw Object.assign(new Error(conflict), { shown: true });
      }
      const { clLeaves, elLeaves, hplLeaves, odLeaves, otherLeaves, higherQualAcquired, ...categories } = values;
      await appraisalApi.update(id!, {
        leaveData: { clLeaves, elLeaves, hplLeaves, odLeaves, otherLeaves, higherQualAcquired },
        categories: stripBlankRows(categories),
      });
      if (!silent) toast.success('Saved');
    } catch (e: any) {
      // Only show toast for manual saves; silent autosave errors logged to console.
      if (!silent && !e?.shown) toast.error(e?.response?.data?.error ?? 'Save failed');
      else console.warn('Autosave failed', e);
      throw e;
    } finally {
      if (!silent) setSaving(false);
      release();
    }
  };

  // goToStep: autosave then switch. Awaits previous save via saveLock.
  // Skip autosave when submission is read-only (backend will reject anyway).
  const goToStep = async (next: number) => {
    if (next === step) return;
    if (!readOnly) {
      try {
        await saveData({ silent: true });
      } catch {
        return; // Stay on current step; user can fix.
      }
    }
    setStep(next);
  };

  const submitAppraisal = async () => {
    try {
      await saveData();
    } catch {
      return; // the save failure is already on screen; do not submit
    }
    try {
      await appraisalApi.submit(id!);
      toast.success('Submitted successfully!');
      navigate('/dashboard');
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Submit failed');
    }
  };

  const loadScore = async () => {
    setScoreLoading(true);
    try {
      if (!readOnly) await saveData({ silent: true });
      const s = await appraisalApi.getScore(id!);
      setScore(s);
    } catch {
      toast.error('Failed to compute score');
    } finally {
      setScoreLoading(false);
    }
  };

  useEffect(() => {
    if (step === 6 && id) loadScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, id]);

  // Read-only when not a draft, OR when the viewer is not the owner
  // (HoD/Reviewer/Admin see the full form but can never edit it).
  const isOwner = !!submission && submission.userId === currentUser?.id;
  const readOnly = !!submission && (submission.status !== 'DRAFT' || !isOwner);

  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500";
  const labelCls = "block text-xs font-medium text-ink-secondary mb-1";

  // Proof-file upload cell bound to a react-hook-form field path
  const proofField = (name: string, label = 'Proof') => (
    <div>
      <label className={labelCls}>{label}</label>
      <Controller
        control={control}
        name={name as any}
        render={({ field }) => (
          <FileUpload value={field.value} onChange={field.onChange} readOnly={readOnly} />
        )}
      />
    </div>
  );

  // Dropdown whose "Other" opens a text box, bound to a form field path.
  const selectOther = (
    name: string, options: readonly string[], placeholder?: string, otherPlaceholder?: string,
    onPicked?: (value: string) => void,
  ) => (
    <Controller
      control={control}
      name={name as any}
      render={({ field }) => (
        <SelectWithOther
          value={field.value}
          onChange={(v) => { field.onChange(v); onPicked?.(v); }}
          options={options}
          placeholder={placeholder}
          otherPlaceholder={otherPlaceholder}
          className={inputCls}
        />
      )}
    />
  );

  // 2.1 controls shared by journals (A), conference proceedings (B) and
  // conference book chapters (C).
  const indexSelect = (name: string) => (
    <select {...register(name as any)} className={inputCls}>
      {INDEX_OPTIONS.map((v) => <option key={v} value={v}>{INDEX_LABEL[v]}</option>)}
    </select>
  );
  const quartileSelect = (name: string) => (
    <select {...register(name as any)} className={inputCls}>
      <option value="">N/A</option>
      {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <option key={q} value={q}>{q}</option>)}
    </select>
  );
  // Per-row 2.1 working, from the same helper the engines score with: the
  // authorship claim first, then the index rule.
  const publicationLine = (kind: PublicationKind, row: any) => {
    const ix = row?.indexed ?? 'NONE';
    const { score } = publicationScore(kind, row);
    const claim = publicationClaim(row);
    const n = authorCount(row);
    const reason = !claim.ok
      ? claim.reason
      : score
        ? `Indexed in ${INDEX_LABEL[ix] ?? ix}`
        : kind === 'journal' && (ix === 'ESCI' || ix === 'ICI')
          ? `${ix} journals score 0 — only SCI / SCIE / WoS or Scopus journals score`
          : 'Not indexed';
    return (
      <div className={`mt-2 text-xs ${score ? 'text-ink-muted' : 'text-amber-700'}`}>
        {n ? `${n} author${n === 1 ? '' : 's'} · ` : ''}{reason} → <span className="font-medium">{score}</span>
      </div>
    );
  };

  // 2.1 author list + campus/claim questions for one row (`base` is its form
  // path, e.g. "cat2Journals.0"). Writes the list, the campus answer and
  // whether the owner claims it; the legacy `authors` text follows the list.
  const authorBlock = (base: string, row: any) => {
    const authors: string[] = Array.isArray(row?.authorList) ? row.authorList : [];
    const set = (field: string, value: unknown) => setValue(`${base}.${field}` as any, value as any, { shouldDirty: true });
    return (
      <div className="col-span-2 space-y-2">
        <div>
          <label className={labelCls}>List of Authors (in the order printed)</label>
          <AuthorListField
            authors={authors}
            readOnly={readOnly}
            inputCls={inputCls}
            onChange={(list) => {
              set('authorList', list);
              set('authors', list.map((a) => a.trim()).filter(Boolean).join(', '));
            }}
          />
        </div>
        <PublicationClaimFields
          name={base}
          ownerName={submission?.user?.name ?? ''}
          allFromCampus={row?.allAuthorsFromCampus ?? null}
          claimedBySelf={row?.claimedBySelf ?? null}
          readOnly={readOnly}
          onChange={(all, self) => { set('allAuthorsFromCampus', all); set('claimedBySelf', self); }}
        />
      </div>
    );
  };

  // 2.3 controls. No publisher level is null ('' is not a Scope), and an
  // unchosen row scores 0 — it used to default to International.
  const scopeSelect = (name: string) => (
    <select {...register(name as any, { setValueAs: (v) => (v === '' || v == null ? null : v) })} className={inputCls}>
      <option value="">Select…</option>
      <option value="INTERNATIONAL">International</option>
      <option value="NATIONAL">National</option>
    </select>
  );
  const editedSelect = (name: string, editorLabel: string) => (
    <select {...register(name as any, { setValueAs: (v) => v === true || v === 'true' })} className={inputCls}>
      <option value="false">Published (Author)</option>
      <option value="true">{editorLabel}</option>
    </select>
  );
  const normTitle = (t: unknown) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Per-row 2.3 working, from the same helper the engines score with. A chapter
  // also entered under 2.1-C would count twice, so it is flagged.
  const bookLine = (row: any, isChapter: boolean) => {
    const r = bookRowScore(row);
    const title = normTitle(row?.title);
    const dup = isChapter && !!title && ((watchedValues as any)?.cat2ConfBookChapters ?? []).some((c: any) => normTitle(c?.title) === title);
    return (
      <div className={`mt-2 text-xs ${r.score ? 'text-ink-muted' : 'text-amber-700'}`}>
        {r.reason} → <span className="font-medium">{r.score}</span>
        {dup && <span className="block text-amber-700 mt-0.5">⚠ Also entered under 2.1-C (book chapters from conferences) — a chapter should count in one place only.</span>}
      </div>
    );
  };

  const addRowBtn = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 mt-2">
      <Plus size={14} /> {label}
    </button>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate(-1)} className="text-ink-subtle hover:text-ink-secondary">
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-xl font-bold text-ink-primary">
          {readOnly ? 'View' : 'Edit'} Submission #{submission?.submissionNumber}
        </h1>
        {submission && (
          <span className={`ml-3 px-2 py-0.5 rounded-full text-xs font-medium ${
            submission.status === 'DRAFT' ? 'bg-amber-100 text-amber-800' :
            submission.status === 'SUBMITTED' ? 'bg-primary-100 text-primary-800' :
            submission.status === 'UNDER_REVIEW' ? 'bg-purple-100 text-purple-800' :
            submission.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
            submission.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
            'bg-surface-muted text-ink-primary'
          }`}>
            {submission.status}
          </span>
        )}
        {submission && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-secondary">
            Live Self-Appraisal Total
            <ScoreBadge value={live.selfTotal} max={500} />
          </span>
        )}
      </div>

      {readOnly && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
          This submission is <strong>{submission.status}</strong> and read-only.
          {submission.status === 'REJECTED' && ' Reviewer rejected — create a new draft to resubmit corrections.'}
          {submission.status === 'SUBMITTED' && ' Awaiting reviewer pickup. You may withdraw from the dashboard.'}
          {submission.status === 'UNDER_REVIEW' && ' Reviewer is evaluating. Comments will unlock once approved/rejected.'}
        </div>
      )}

      {/* Step indicators */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <button
            key={i}
            onClick={() => goToStep(i)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${
              i === step ? 'bg-primary-600 text-white' : 'bg-surface-muted text-ink-secondary hover:bg-surface-border'
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <form className="bg-white border border-surface-border rounded-md p-6">
        <fieldset disabled={readOnly} className={readOnly ? 'opacity-90' : ''}>
        {/* Step 0: Leave & Info */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-ink-primary mb-3">Part I — Leave Details</h2>
            <div className="grid grid-cols-2 gap-4">
              {(['clLeaves', 'elLeaves', 'hplLeaves', 'odLeaves'] as const).map((f) => (
                <div key={f}>
                  <label className={labelCls}>{f.replace('Leaves', '').toUpperCase()} Leaves</label>
                  <input type="number" {...register(f, { valueAsNumber: true })} className={inputCls} />
                </div>
              ))}
            </div>
            <div>
              <label className={labelCls}>Other Leaves</label>
              <input {...register('otherLeaves')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Higher Qualification Acquired</label>
              <input {...register('higherQualAcquired')} className={inputCls} />
            </div>
          </div>
        )}

        {/* Step 1: Teaching */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-secondary">Category 1 — Teaching</h2>
              <ScoreBadge value={live.cat1.total} max={150} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">1.1 Courses Taught — Lectures</h2>
                <ScoreBadge value={live.cat1.lectures} max={40} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Per course: engagement (periods conducted ÷ planned) 96–100% → 10, 90–95% → 8, 80–89% → 6, below 80% → 4, plus 5 if a novel pedagogical method was used for at least 25% of the periods. Section max 40.</p>
              <p className="text-xs text-ink-muted mb-3">Lecture delivery score from periods conducted vs planned (+ novel pedagogy).</p>
              {courses.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>Course Name</label>
                      <input {...register(`cat1Courses.${i}.courseName`)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Level</label>
                      <select {...register(`cat1Courses.${i}.level`)} className={inputCls}>
                        <option value="BTECH">BTech</option>
                        <option value="MTECH">MTech</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Year/Sem</label>
                      <input {...register(`cat1Courses.${i}.yearSem`)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Periods Planned</label>
                      <input type="number" {...register(`cat1Courses.${i}.periodPlanned`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Periods Conducted</label>
                      <input type="number" {...register(`cat1Courses.${i}.periodsConducted`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Novel Pedagogy Method</label>
                      {/* Picking a method means it was used — tick the box with it. */}
                      {selectOther(`cat1Courses.${i}.novelPedagogyMethod`, NOVEL_PEDAGOGY_OPTIONS, 'Select...', 'Specify method',
                        (v) => { if (v) setValue(`cat1Courses.${i}.novelPedagogyUsed`, true, { shouldDirty: true }); })}
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm text-ink-secondary">
                        {/* Unticking clears the method, or the method alone would still earn the 5. */}
                        <input type="checkbox" {...register(`cat1Courses.${i}.novelPedagogyUsed`, {
                          onChange: (e) => { if (!e.target.checked) setValue(`cat1Courses.${i}.novelPedagogyMethod`, '', { shouldDirty: true }); },
                        })} />
                        Novel Pedagogy Used
                      </label>
                    </div>
                  </div>
                  {(() => {
                    // Same helper the engines score with — the working, per course.
                    const row = (watchedValues as any)?.cat1Courses?.[i] ?? {};
                    const r = lectureRowScore(row);
                    const needsMethod = !!row.novelPedagogyUsed && !String(row.novelPedagogyMethod ?? '').trim();
                    return (
                      <div className="mt-2 text-xs text-ink-muted">
                        {r.pct == null ? 'Enter periods planned and conducted to score this course.' : `Engagement ${r.pct}% → ${r.engagement}`}
                        {r.novelty ? ' · Novel pedagogy +5' : ''}
                        {' · '}<span className="font-medium text-ink-secondary">Course total {r.total}/15</span>
                        {needsMethod && <span className="block text-amber-700 mt-1">Pick the novel pedagogy method you used.</span>}
                      </div>
                    );
                  })()}
                  <button type="button" onClick={() => courses.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Course', () => courses.append({ courseName: '', level: 'BTECH', yearSem: '', periodPlanned: 0, periodsConducted: 0, novelPedagogyUsed: false, novelPedagogyMethod: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">1.2 Courses Taught — Attendance, Feedback &amp; Results</h2>
                <ScoreBadge value={live.cat1.attendanceFeedback} max={80} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Per course max 20 — Attendance = (avg attendance % ÷ 100) × 5, Feedback out of 5, Results = (pass % ÷ 100) × 10. Section max 80.</p>
              {courseResults.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2">
                      <label className={labelCls}>Name of the Course</label>
                      <input {...register(`cat1CourseResults.${i}.courseName`)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Class Size (Y)</label>
                      <input type="number" {...register(`cat1CourseResults.${i}.classSize`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Feedback Received (0-5)</label>
                      <input type="number" step="0.01" {...register(`cat1CourseResults.${i}.feedbackReceived`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Avg. Attendance %</label>
                      <input type="number" step="0.01" min="0" max="100" {...register(`cat1CourseResults.${i}.avgAttendancePct`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Pass %</label>
                      <input type="number" step="0.01" min="0" max="100" {...register(`cat1CourseResults.${i}.passPercentage`, { valueAsNumber: true })} className={inputCls} />
                    </div>
                  </div>
                  <button type="button" onClick={() => courseResults.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Course Result', () => courseResults.append({ courseName: '', classSize: 0, avgAttendancePct: 0, feedbackReceived: 0, passPercentage: 0 }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">1.3 Academic Projects Guided</h2>
                <ScoreBadge value={live.cat1.projects} max={20} />
              </div>
              <p className="text-xs text-ink-muted mb-3">B.Tech: mini project 2, major project 5 for each batch. M.Tech: mini project 3, major project 5 for each student. Section max 20.</p>
              {projects.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div>
                    <label className={labelCls}>Course Level</label>
                    <select {...register(`cat1Projects.${i}.course`)} className={inputCls}>
                      <option value="BTECH">BTech</option>
                      <option value="MTECH">MTech</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Project Type</label>
                    <select {...register(`cat1Projects.${i}.projectType`)} className={inputCls}>
                      <option value="MINI">Mini</option>
                      <option value="MAJOR">Major</option>
                    </select>
                  </div>
                  {(() => {
                    // Same helper the engines score with — the working, per row.
                    const row = (watchedValues as any)?.cat1Projects?.[i] ?? {};
                    const r = projectRowScore(row);
                    return (
                      <>
                        <div>
                          <label className={labelCls}>Number of Projects Guided ({row.course === 'MTECH' ? 'students' : 'batches'})</label>
                          <input type="number" min={0} step={1} {...register(`cat1Projects.${i}.count`, { valueAsNumber: true })} className={inputCls} />
                        </div>
                        <button type="button" onClick={() => projects.remove(i)} className="text-red-400 text-xs">Remove</button>
                        <div className="col-span-3 text-xs text-ink-muted -mt-1">
                          {r.rate} per {r.unit} × {r.count} = <span className="font-medium text-ink-secondary">{r.score}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
              {addRowBtn('Add Project Row', () => projects.append({ course: 'BTECH', projectType: 'MINI', count: 0 }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">1.4 e-Content Development / Other Instructional Material</h2>
                <ScoreBadge value={live.cat1.eContent} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">2 marks for each e-content or other instructional material developed, with evidence — paste the link to it. Content is internally audited. Section max 5.</p>
              {eContent.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Course Name (B.Tech/M.Tech)</label><input {...register(`cat1EContent.${i}.courseName`)} className={inputCls} placeholder="e.g. Data Structures — B.Tech" /></div>
                    <div><label className={labelCls}>Name of the Content</label><input {...register(`cat1EContent.${i}.contentName`)} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Nature of the Content</label>
                      {selectOther(`cat1EContent.${i}.nature`, ECONTENT_NATURES, undefined, 'Specify nature')}
                    </div>
                    <div>
                      <label className={labelCls}>Evidence Link (URL)</label>
                      <input {...register(`cat1EContent.${i}.evidenceFile`)} className={inputCls} placeholder="https://..." />
                    </div>
                  </div>
                  {(() => {
                    // Same helper the engines score with — no evidence link, no marks.
                    const r = eContentRowScore((watchedValues as any)?.cat1EContent?.[i] ?? {});
                    return r.evidence
                      ? <div className="mt-2 text-xs text-ink-muted">Evidence link given → <span className="font-medium text-ink-secondary">2</span></div>
                      : <div className="mt-2 text-xs text-amber-700">Add the evidence link (https://…) to score this item — currently 0.</div>;
                  })()}
                  <button type="button" onClick={() => eContent.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add e-Content', () => eContent.append({ courseName: '', contentName: '', nature: 'Video', evidenceFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">1.5 Use of ICT &amp; Digital Platforms</h2>
                <ScoreBadge value={live.cat1.ict} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">LMS usage (Google Classroom, Moodle, MS Teams, etc.), online quizzes, digital assignments, flipped classrooms — 2 marks for each course with documentary evidence (paste the link). Section max 5.</p>
              {ict.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Course Name (B.Tech/M.Tech)</label><input {...register(`cat1ICT.${i}.courseName`)} className={inputCls} placeholder="e.g. Data Structures — B.Tech" /></div>
                    <div>
                      <label className={labelCls}>Platform / Tool Used</label>
                      {selectOther(`cat1ICT.${i}.platform`, ICT_PLATFORMS, undefined, 'Specify platform or tool')}
                    </div>
                    <div>
                      <label className={labelCls}>Nature of Use</label>
                      {selectOther(`cat1ICT.${i}.natureOfUse`, ICT_USES, undefined, 'Specify how it was used')}
                    </div>
                    <div>
                      <label className={labelCls}>Evidence Link (URL)</label>
                      <input {...register(`cat1ICT.${i}.evidenceFile`)} className={inputCls} placeholder="https://..." />
                    </div>
                  </div>
                  {(() => {
                    // Same helper the engines score with — no evidence link, no marks.
                    const r = ictRowScore((watchedValues as any)?.cat1ICT?.[i] ?? {});
                    return r.evidence
                      ? <div className="mt-2 text-xs text-ink-muted">Evidence link given → <span className="font-medium text-ink-secondary">2</span></div>
                      : <div className="mt-2 text-xs text-amber-700">Add the evidence link (https://…) to score this course — currently 0.</div>;
                  })()}
                  <button type="button" onClick={() => ict.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add ICT Usage', () => ict.append({ courseName: '', platform: 'Google Classroom', natureOfUse: 'Assignments', evidenceFile: '' }))}
            </div>
          </div>
        )}

        {/* Step 2: Research */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-secondary">Category 2 — Research</h2>
              <ScoreBadge value={live.cat2.total} max={150} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.1-A Journal Publications</h2>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-ink-muted">(2.1 combined: A + B + C)</span>
                  <ScoreBadge value={live.cat2.publications} max={60} />
                </span>
              </div>
              <p className="text-xs text-ink-muted mb-3">2.1 Research Papers Published in Journals / Conferences / Book Chapters — max 60 across A, B and C. 15 for each paper in an SCI / SCIE / WoS or Scopus journal (ESCI, ICI and unindexed journals score 0). 10 for each indexed conference paper or indexed book chapter from a conference.</p>
              {journals.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Publication</label><input {...register(`cat2Journals.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Name of the Journal</label><input {...register(`cat2Journals.${i}.journalName`)} className={inputCls} /></div>
                    {authorBlock(`cat2Journals.${i}`, (watchedValues as any)?.cat2Journals?.[i])}
                    <div>
                      <label className={labelCls}>Author Position (First / Second / Corresponding / Supervisor)</label>
                      {selectOther(`cat2Journals.${i}.authorPosition`, AUTHOR_POSITIONS, undefined, 'Specify position')}
                    </div>
                    <div><label className={labelCls}>Volume</label><input {...register(`cat2Journals.${i}.volume`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Issue No</label><input {...register(`cat2Journals.${i}.issueNo`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Page Nos</label><input {...register(`cat2Journals.${i}.pageNos`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Date of Publication</label><input type="date" {...register(`cat2Journals.${i}.dateOfPub`)} className={inputCls} /></div>
                    <div><label className={labelCls}>ISSN No.</label><input {...register(`cat2Journals.${i}.issn`)} className={inputCls} /></div>
                    <div><label className={labelCls}>DOI</label><input {...register(`cat2Journals.${i}.doi`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Impact Factor</label><input type="number" step="0.01" {...register(`cat2Journals.${i}.impactFactor`, { valueAsNumber: true })} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Impact Factor Source</label>
                      {selectOther(`cat2Journals.${i}.impactFactorSource`, IMPACT_FACTOR_SOURCES, 'Select...', 'Specify source')}
                    </div>
                    <div><label className={labelCls}>Indexed in</label>{indexSelect(`cat2Journals.${i}.indexed`)}</div>
                    <div><label className={labelCls}>Quartile (if applicable)</label>{quartileSelect(`cat2Journals.${i}.quartile`)}</div>
                    {proofField(`cat2Journals.${i}.proofFile`, '1st Page Proof')}
                    {proofField(`cat2Journals.${i}.indexProofFile`, 'Index Proof')}
                  </div>
                  {publicationLine('journal', (watchedValues as any)?.cat2Journals?.[i])}
                  <button type="button" onClick={() => journals.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Journal', () => journals.append({ title: '', journalName: '', authors: '', authorList: [''], allAuthorsFromCampus: null, claimedBySelf: null, authorPosition: '1st', indexed: 'NONE', impactFactor: 0, impactFactorSource: '', volume: '', issueNo: '', pageNos: '', dateOfPub: '', quartile: '', proofFile: '', indexProofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.1-B Conference Proceedings</h2>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-ink-muted">(2.1 combined: A + B + C)</span>
                  <ScoreBadge value={live.cat2.publications} max={60} />
                </span>
              </div>
              {conferences.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Publication</label><input {...register(`cat2Conferences.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Name of the Conference Proceedings</label><input {...register(`cat2Conferences.${i}.conferenceName`)} className={inputCls} /></div>
                    {authorBlock(`cat2Conferences.${i}`, (watchedValues as any)?.cat2Conferences?.[i])}
                    <div>
                      <label className={labelCls}>Author Position (First / Second / Corresponding / Supervisor)</label>
                      {selectOther(`cat2Conferences.${i}.authorPosition`, AUTHOR_POSITIONS, undefined, 'Specify position')}
                    </div>
                    <div><label className={labelCls}>Volume</label><input {...register(`cat2Conferences.${i}.volume`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Issue No</label><input {...register(`cat2Conferences.${i}.issueNo`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Page Nos</label><input {...register(`cat2Conferences.${i}.pageNos`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Date of Publication</label><input type="date" {...register(`cat2Conferences.${i}.dateOfPub`)} className={inputCls} /></div>
                    <div><label className={labelCls}>ISSN / ISBN</label><input {...register(`cat2Conferences.${i}.issn`)} className={inputCls} /></div>
                    <div><label className={labelCls}>DOI</label><input {...register(`cat2Conferences.${i}.doi`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Impact Factor</label><input type="number" step="0.01" {...register(`cat2Conferences.${i}.impactFactor`, { valueAsNumber: true })} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Presentation Status</label>
                      {selectOther(`cat2Conferences.${i}.presentationStatus`, PRESENTATION_STATUSES, 'Select...', 'Specify status')}
                    </div>
                    <div><label className={labelCls}>Indexed in</label>{indexSelect(`cat2Conferences.${i}.indexed`)}</div>
                    <div><label className={labelCls}>Quartile (if applicable)</label>{quartileSelect(`cat2Conferences.${i}.quartile`)}</div>
                    {proofField(`cat2Conferences.${i}.proofFile`)}
                  </div>
                  {publicationLine('conference', (watchedValues as any)?.cat2Conferences?.[i])}
                  <button type="button" onClick={() => conferences.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Conference', () => conferences.append({ title: '', conferenceName: '', authors: '', authorList: [''], allAuthorsFromCampus: null, claimedBySelf: null, authorPosition: '1st', volume: '', issueNo: '', pageNos: '', dateOfPub: '', issn: '', doi: '', impactFactor: 0, indexed: 'NONE', quartile: '', presentationStatus: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.1-C Book Chapters (from Conferences)</h2>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-ink-muted">(2.1 combined: A + B + C)</span>
                  <ScoreBadge value={live.cat2.publications} max={60} />
                </span>
              </div>
              <p className="text-xs text-ink-muted mb-3">Book chapters derived from a conference proceeding — 10 each when indexed, part of 2.1. Other book chapters belong in 2.3.</p>
              {confBookChapters.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Chapter</label><input {...register(`cat2ConfBookChapters.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Name of the Conference Proceedings</label><input {...register(`cat2ConfBookChapters.${i}.conferenceName`)} className={inputCls} /></div>
                    {authorBlock(`cat2ConfBookChapters.${i}`, (watchedValues as any)?.cat2ConfBookChapters?.[i])}
                    <div>
                      <label className={labelCls}>Author Position (First / Second / Corresponding / Supervisor)</label>
                      {selectOther(`cat2ConfBookChapters.${i}.authorPosition`, AUTHOR_POSITIONS, undefined, 'Specify position')}
                    </div>
                    <div><label className={labelCls}>Volume</label><input {...register(`cat2ConfBookChapters.${i}.volume`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Issue No</label><input {...register(`cat2ConfBookChapters.${i}.issueNo`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Page Nos</label><input {...register(`cat2ConfBookChapters.${i}.pageNos`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Date of Publication</label><input type="date" {...register(`cat2ConfBookChapters.${i}.dateOfPub`)} className={inputCls} /></div>
                    <div><label className={labelCls}>ISSN / ISBN</label><input {...register(`cat2ConfBookChapters.${i}.issn`)} className={inputCls} /></div>
                    <div><label className={labelCls}>DOI</label><input {...register(`cat2ConfBookChapters.${i}.doi`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Impact Factor</label><input type="number" step="0.01" {...register(`cat2ConfBookChapters.${i}.impactFactor`, { valueAsNumber: true })} className={inputCls} /></div>
                    <div><label className={labelCls}>Indexed in</label>{indexSelect(`cat2ConfBookChapters.${i}.indexed`)}</div>
                    <div><label className={labelCls}>Quartile (if applicable)</label>{quartileSelect(`cat2ConfBookChapters.${i}.quartile`)}</div>
                    {proofField(`cat2ConfBookChapters.${i}.proofFile`)}
                  </div>
                  {publicationLine('chapter', (watchedValues as any)?.cat2ConfBookChapters?.[i])}
                  <button type="button" onClick={() => confBookChapters.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Conference Book Chapter', () => confBookChapters.append({ title: '', conferenceName: '', authors: '', authorList: [''], allAuthorsFromCampus: null, claimedBySelf: null, authorPosition: '1st', volume: '', issueNo: '', pageNos: '', dateOfPub: '', issn: '', doi: '', impactFactor: 0, indexed: 'NONE', quartile: '', proofFile: '' }))}
            </div>


            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.2 Citations of Research Publications / Books</h2>
                <ScoreBadge value={live.cat2.citations} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Only Scopus / WoS citations are considered. Score from cumulative citations: 3–10 → 1, 11–50 → 2, 51–100 → 3, more than 100 → 5. Max 5.</p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>No. of Publications / Books till date</label><input type="number" min={0} step={1} {...register('cat2Citations.totalPubsTillDate', { valueAsNumber: true })} className={inputCls} /></div>
                <div><label className={labelCls}>No. of Publications / Books with Citations</label><input type="number" min={0} step={1} {...register('cat2Citations.pubsWithCitations', { valueAsNumber: true })} className={inputCls} /></div>
                <div><label className={labelCls}>Total No. of Citations (Scopus / WoS only)</label><input type="number" min={0} step={1} {...register('cat2Citations.totalCitations', { valueAsNumber: true })} className={inputCls} /></div>
                <div><label className={labelCls}>h-Index (Scopus)</label><input type="number" min={0} step={1} {...register('cat2Citations.hIndexScopus', { valueAsNumber: true })} className={inputCls} /></div>
                <div><label className={labelCls}>h-Index (WoS)</label><input type="number" min={0} step={1} {...register('cat2Citations.hIndexWos', { valueAsNumber: true })} className={inputCls} /></div>
              </div>
              {(() => {
                // Same band helper the engines score with; warnings never block or change the score.
                const c = (watchedValues as any)?.cat2Citations ?? {};
                const total = Number.isFinite(c.totalCitations) ? c.totalCitations : 0;
                return (
                  <>
                    <div className="mt-2 text-xs text-ink-muted">{total} citations → <span className="font-medium text-ink-secondary">{citationScore(total)}</span></div>
                    {citationWarnings(c).map((w) => <div key={w} className="mt-1 text-xs text-amber-700">⚠ {w}</div>)}
                  </>
                );
              })()}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.3 Books and Academic Book Chapters Published / Edited</h2>
                <ScoreBadge value={live.cat2.books} max={10} />
              </div>
              <p className="text-xs text-ink-muted mb-3">International publisher: author 10, editor 5. National publisher: author 5, editor 3. Books and chapters share one maximum of 10. Choose National or International for every entry — a row without it scores 0.</p>

              <h3 className="text-sm font-semibold text-ink-secondary mb-2">Books</h3>
              {books.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Book</label><input {...register(`cat2Books.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Authors (as appeared on the book)</label><input {...register(`cat2Books.${i}.authors`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Publisher Details</label><input {...register(`cat2Books.${i}.publisher`)} className={inputCls} /></div>
                    <div><label className={labelCls}>ISBN No.</label><input {...register(`cat2Books.${i}.isbn`)} className={inputCls} /></div>
                    <div><label className={labelCls}>National / International</label>{scopeSelect(`cat2Books.${i}.scope`)}</div>
                    <div><label className={labelCls}>Published / Edited</label>{editedSelect(`cat2Books.${i}.isEdited`, 'Edited (Editor)')}</div>
                    {proofField(`cat2Books.${i}.proofFile`, 'Cover / Proof')}
                  </div>
                  {bookLine((watchedValues as any)?.cat2Books?.[i], false)}
                  <button type="button" onClick={() => books.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Book', () => books.append({ title: '', authors: '', publisher: '', isbn: '', isEdited: false, scope: null, proofFile: '' }))}

              <h3 className="text-sm font-semibold text-ink-secondary mt-5 mb-2">Academic Book Chapters</h3>
              {bookChapters.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Chapter / Article</label><input {...register(`cat2BookChapters.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Authors (as appeared on the chapter)</label><input {...register(`cat2BookChapters.${i}.authors`)} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Author Position</label>
                      {selectOther(`cat2BookChapters.${i}.authorPosition`, AUTHOR_POSITIONS, undefined, 'Specify position')}
                    </div>
                    <div><label className={labelCls}>Publisher Details</label><input {...register(`cat2BookChapters.${i}.publisher`)} className={inputCls} /></div>
                    <div><label className={labelCls}>ISBN No.</label><input {...register(`cat2BookChapters.${i}.isbn`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Details of Chapter Contributed (chapter no. etc.)</label><input {...register(`cat2BookChapters.${i}.chapterNo`)} className={inputCls} /></div>
                    <div><label className={labelCls}>National / International</label>{scopeSelect(`cat2BookChapters.${i}.scope`)}</div>
                    <div><label className={labelCls}>Published / Edited</label>{editedSelect(`cat2BookChapters.${i}.isEdited`, 'Edited (Editor of the book)')}</div>
                    {proofField(`cat2BookChapters.${i}.proofFile`, 'Cover / Proof')}
                  </div>
                  {bookLine((watchedValues as any)?.cat2BookChapters?.[i], true)}
                  <button type="button" onClick={() => bookChapters.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Book Chapter', () => bookChapters.append({ title: '', authors: '', authorPosition: '1st', publisher: '', isbn: '', chapterNo: '', isEdited: false, scope: null, proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.4 Patents / Transfer of Technology / Trade Marks / Copyrights / Any Other IPR</h2>
                <ScoreBadge value={live.cat2.patents} max={20} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Published 5, Granted 10 — for any kind of IPR. A filing alone scores 0. Transfer of Technology: choose Type of IPR → Other and describe it. Max 20.</p>
              {patents.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Patent / Design / etc.</label><input {...register(`cat2Patents.${i}.title`)} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Country</label>
                      <select {...register(`cat2Patents.${i}.country`)} className={inputCls}>
                        <option value="India">India</option>
                        <option value="US">US</option>
                      </select>
                    </div>
                    <div><label className={labelCls}>Name of the Inventor(s)</label><input {...register(`cat2Patents.${i}.inventors`)} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Status (Filed / Published / Granted)</label>
                      {(() => {
                        const reg = register(`cat2Patents.${i}.status`);
                        return (
                          <select
                            {...reg}
                            className={inputCls}
                            onChange={(e) => {
                              reg.onChange(e); // keep RHF's own handler
                              const v = e.target.value;
                              // Drop dates the row no longer shows so a downgraded
                              // status can't persist a stale publication/grant date.
                              if (v !== 'GRANTED') setValue(`cat2Patents.${i}.dateOfGrant`, '', { shouldDirty: true });
                              if (v === 'FILED') setValue(`cat2Patents.${i}.dateOfPub`, '', { shouldDirty: true });
                            }}
                          >
                            <option value="FILED">Filed</option><option value="PUBLISHED">Published</option><option value="GRANTED">Granted</option>
                          </select>
                        );
                      })()}
                    </div>
                    <div>
                      <label className={labelCls}>Type of IPR</label>
                      <select {...register(`cat2Patents.${i}.iprType`)} className={inputCls}>
                        <option value="">Select...</option>
                        <option value="Patent">Patent</option>
                        <option value="Copyright">Copyright</option>
                        <option value="Trademark">Trademark</option>
                        <option value="Design">Design</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    {(watchedValues as any)?.cat2Patents?.[i]?.iprType === 'Other' && (
                      <div><label className={labelCls}>IPR Type — specify</label><input {...register(`cat2Patents.${i}.iprTypeOther`)} className={inputCls} /></div>
                    )}
                    <div>
                      <label className={labelCls}>Patent Type</label>
                      <select {...register(`cat2Patents.${i}.patentType`)} className={inputCls}>
                        <option value="">Select...</option>
                        <option value="Utility">Utility</option>
                        <option value="Process">Process</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm text-ink-secondary">
                        <input type="checkbox" {...register(`cat2Patents.${i}.applicantIsInstitute`)} />
                        Institute is the applicant
                      </label>
                    </div>
                    <div><label className={labelCls}>Application / Patent Number</label><input {...register(`cat2Patents.${i}.appNumber`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Date of Filing</label><input type="date" {...register(`cat2Patents.${i}.dateOfFiling`)} className={inputCls} /></div>
                    {['PUBLISHED', 'GRANTED'].includes((watchedValues as any)?.cat2Patents?.[i]?.status) && (
                      <div><label className={labelCls}>Date of Publication</label><input type="date" {...register(`cat2Patents.${i}.dateOfPub`)} className={inputCls} /></div>
                    )}
                    {(watchedValues as any)?.cat2Patents?.[i]?.status === 'GRANTED' && (
                      <div><label className={labelCls}>Date of Grant</label><input type="date" {...register(`cat2Patents.${i}.dateOfGrant`)} className={inputCls} /></div>
                    )}
                    <div><label className={labelCls}>Valid Duration</label><input {...register(`cat2Patents.${i}.validDuration`)} className={inputCls} /></div>
                    {proofField(`cat2Patents.${i}.proofFile`)}
                  </div>
                  {(() => {
                    // Same helper the engines score with; warnings never block or change the score.
                    const all = (watchedValues as any)?.cat2Patents ?? [];
                    const r = patentRowScore(all[i]);
                    return (
                      <div className={`mt-2 text-xs ${r.score ? 'text-ink-muted' : 'text-amber-700'}`}>
                        {r.reason} → <span className="font-medium">{r.score}</span>
                        {patentWarnings(all, i).map((w) => <span key={w} className="block text-amber-700 mt-0.5">⚠ {w}</span>)}
                      </div>
                    );
                  })()}
                  <button type="button" onClick={() => patents.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Patent', () => patents.append({ title: '', country: 'India', inventors: '', status: 'FILED', iprType: '', iprTypeOther: '', patentType: '', applicantIsInstitute: false, appNumber: '', dateOfFiling: '', dateOfPub: '', dateOfGrant: '', validDuration: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.5 Sponsored Research Projects</h2>
                <ScoreBadge value={live.cat2.sponsoredProjects} max={20} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Ongoing 20 and Applied 5 for each project, up to a maximum of 20. Completed projects are listed for the record but do not score.</p>
              {cat2Proj.fields.map((field, i) => {
                const row = (watchedValues as any)?.cat2Projects?.[i] ?? {};
                const r = sponsoredProjectRowScore(row);
                const statusReg = register(`cat2Projects.${i}.status`);
                return (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Title of the Project</label><input {...register(`cat2Projects.${i}.title`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Funding Agency</label><input {...register(`cat2Projects.${i}.fundingAgency`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Amount (Rs. Lakhs)</label><input type="number" min={0} step="0.1" {...register(`cat2Projects.${i}.amountLakhs`, { valueAsNumber: true })} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Principal Investigator / Co-investigator</label>
                      <select {...register(`cat2Projects.${i}.role`)} className={inputCls}>
                        <option value="PI">Principal Investigator</option><option value="Co-PI">Co-investigator</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Status (Applied / Ongoing / Completed)</label>
                      <select
                        {...statusReg}
                        className={inputCls}
                        onChange={(e) => {
                          statusReg.onChange(e); // keep RHF's own handler
                          // The PDF asks for the application date only for Applied projects and the
                          // duration only for Ongoing / Completed ones — drop whichever no longer shows.
                          if (e.target.value === 'APPLIED') {
                            setValue(`cat2Projects.${i}.durationPeriod`, '', { shouldDirty: true });
                            setValue(`cat2Projects.${i}.dateOfGrant`, '', { shouldDirty: true });
                          } else {
                            setValue(`cat2Projects.${i}.dateOfApplication`, '', { shouldDirty: true });
                          }
                        }}
                      >
                        <option value="APPLIED">Applied</option><option value="ONGOING">Ongoing</option><option value="COMPLETED">Completed</option>
                      </select>
                    </div>
                    {row.status === 'APPLIED' ? (
                      <div><label className={labelCls}>Date of Application</label><input type="date" {...register(`cat2Projects.${i}.dateOfApplication`)} className={inputCls} /></div>
                    ) : (
                      <>
                        <div><label className={labelCls}>Project Duration &amp; Period</label><input {...register(`cat2Projects.${i}.durationPeriod`)} className={inputCls} placeholder="e.g. 3 years, Apr 2024 – Mar 2027" /></div>
                        <div><label className={labelCls}>Date of Grant / Sanction</label><input type="date" {...register(`cat2Projects.${i}.dateOfGrant`)} className={inputCls} /></div>
                      </>
                    )}
                    {proofField(`cat2Projects.${i}.proofFile`)}
                  </div>
                  {/* Same helper the engines score with; warnings never block or change the score. */}
                  <div className={`mt-2 text-xs ${r.score ? 'text-ink-muted' : 'text-amber-700'}`}>
                    {r.reason} → <span className="font-medium">{r.score}</span>
                    {sponsoredProjectWarnings(row).map((w) => <span key={w} className="block text-amber-700 mt-0.5">⚠ {w}</span>)}
                  </div>
                  <button type="button" onClick={() => cat2Proj.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
                );
              })}
              {addRowBtn('Add Project', () => cat2Proj.append({ title: '', fundingAgency: '', amountLakhs: 0, role: 'PI', status: 'APPLIED', durationPeriod: '', dateOfApplication: '', dateOfGrant: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.6 Consultancy Projects</h2>
                <ScoreBadge value={live.cat2.consultancy} max={10} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Per project, by amount: up to Rs. 1 lakh 2, up to 2 lakh 4, up to 5 lakh 6, up to 10 lakh 8, above 10 lakh 10. Max 10.</p>
              {consultancy.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Name of Consultancy Project</label><input {...register(`cat2Consultancy.${i}.name`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Consulting / Sponsoring Agency</label><input {...register(`cat2Consultancy.${i}.agency`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Amount (Rs. Lakhs)</label><input type="number" min={0} step="0.1" {...register(`cat2Consultancy.${i}.amountLakhs`, { valueAsNumber: true })} className={inputCls} /></div>
                  {proofField(`cat2Consultancy.${i}.proofFile`)}
                  <button type="button" onClick={() => consultancy.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={consultancyRowScore((watchedValues as any)?.cat2Consultancy?.[i])} />
                </div>
              ))}
              {addRowBtn('Add Consultancy', () => consultancy.append({ name: '', agency: '', amountLakhs: 0, proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.7 Research Guidance (PhD)</h2>
                <ScoreBadge value={live.cat2.guidance} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Ph.D. guide 5 per candidate, co-guide 3. Max 5.</p>
              {guidance.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Research Scholar Name</label><input {...register(`cat2Guidance.${i}.studentName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>University</label><input {...register(`cat2Guidance.${i}.university`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Thesis Title</label><input {...register(`cat2Guidance.${i}.thesisTitle`)} className={inputCls} /></div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-ink-secondary">
                      <input type="checkbox" {...register(`cat2Guidance.${i}.isGuide`)} />
                      Supervisor (unchecked = Co-Supervisor)
                    </label>
                  </div>
                  {proofField(`cat2Guidance.${i}.proofFile`)}
                  <button type="button" onClick={() => guidance.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Guidance', () => guidance.append({ studentName: '', university: '', thesisTitle: '', isGuide: true, proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.8 Research Interest Groups</h2>
                <ScoreBadge value={live.cat2.researchGroups} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">5 for participation with a tangible outcome — an entry with no outcome scores 0. Max 5.</p>
              {researchGroups.fields.map((field, i) => {
                const row = (watchedValues as any)?.cat2ResearchGroups?.[i] ?? {};
                return (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Group Name</label><input {...register(`cat2ResearchGroups.${i}.groupName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Size</label><input type="number" {...register(`cat2ResearchGroups.${i}.size`, { valueAsNumber: true })} className={inputCls} /></div>
                  <div><label className={labelCls}>Outcome (required to score)</label><input {...register(`cat2ResearchGroups.${i}.outcome`)} className={inputCls} /></div>
                  {proofField(`cat2ResearchGroups.${i}.proofFile`)}
                  <button type="button" onClick={() => researchGroups.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={outcomeRowScore(row.groupName, row.outcome)} />
                </div>
                );
              })}
              {addRowBtn('Add Research Group', () => researchGroups.append({ groupName: '', size: 1, outcome: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.9 Academic / Research Institution Collaborations</h2>
                <ScoreBadge value={live.cat2.linkages} max={10} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Record any collaboration with an outside university, research lab or institute here. 5 per collaboration with an outcome (joint paper / project / shared facilities / student projects) — no outcome scores 0. Max 10 together with industry linkages below.</p>
              {linkages.fields.map((field, i) => {
                const row = (watchedValues as any)?.cat2Linkages?.[i] ?? {};
                return (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Institution Name</label><input {...register(`cat2Linkages.${i}.instituteName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Contact Person</label><input {...register(`cat2Linkages.${i}.contactPerson`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Outcome (required to score)</label><input {...register(`cat2Linkages.${i}.outcome`)} className={inputCls} /></div>
                  {proofField(`cat2Linkages.${i}.proofFile`)}
                  <button type="button" onClick={() => linkages.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={outcomeRowScore(row.instituteName, row.outcome)} />
                </div>
                );
              })}
              {addRowBtn('Add Institution Collaboration', () => linkages.append({ instituteName: '', contactPerson: '', outcome: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.9 Industry Linkages (contd.)</h2>
                <ScoreBadge value={live.cat2.linkages} max={10} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Collaborations with a company or industry body. Scored together with the institution collaborations above — 5 per linkage with an outcome, 10 max across both.</p>
              {industryLinkages.fields.map((field, i) => {
                const row = (watchedValues as any)?.cat2IndustryLinkages?.[i] ?? {};
                return (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Industry Name</label><input {...register(`cat2IndustryLinkages.${i}.industryName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Contact Person</label><input {...register(`cat2IndustryLinkages.${i}.contactPerson`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Outcome (required to score)</label><input {...register(`cat2IndustryLinkages.${i}.outcome`)} className={inputCls} /></div>
                  {proofField(`cat2IndustryLinkages.${i}.proofFile`)}
                  <button type="button" onClick={() => industryLinkages.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={outcomeRowScore(row.industryName, row.outcome)} />
                </div>
                );
              })}
              {addRowBtn('Add Industry Linkage', () => industryLinkages.append({ industryName: '', contactPerson: '', outcome: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">2.10 Innovation / Start-ups</h2>
                <ScoreBadge value={live.cat2.startups} max={5} />
              </div>
              <p className="text-xs text-ink-muted mb-3">5 per activity with an outcome — no outcome scores 0. Max 5.</p>
              {startups.fields.map((field, i) => {
                const row = (watchedValues as any)?.cat2Startups?.[i] ?? {};
                return (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Group Name</label><input {...register(`cat2Startups.${i}.groupName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Activity</label><input {...register(`cat2Startups.${i}.activity`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Outcome (required to score)</label><input {...register(`cat2Startups.${i}.outcome`)} className={inputCls} /></div>
                  {proofField(`cat2Startups.${i}.proofFile`)}
                  <button type="button" onClick={() => startups.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={outcomeRowScore(row.groupName, row.outcome)} />
                </div>
                );
              })}
              {addRowBtn('Add Startup', () => startups.append({ groupName: '', activity: '', outcome: '', proofFile: '' }))}
            </div>
          </div>
        )}

        {/* Step 3: Faculty Development */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-secondary">Category 3 — Faculty Development</h2>
              <ScoreBadge value={live.cat3.total} max={100} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.1 Status of Ph.D.</h2>
                <ScoreBadge value={live.cat3.advQual} max={10} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Highest applicable: Post-Doctoral / Awarded / Thesis Submitted / PG Degree / PG Diploma → 10, Cleared Pre-PhD → 8, Registered for Ph.D. → 5.</p>
              <div>
                <label className={labelCls}>Status of Ph.D.</label>
                <select value={phdStatus} onChange={(e) => setPhdStatus(e.target.value)} className={inputCls}>
                  <option value="none">None</option>
                  <option value="registeredForPhD">Registered for Ph.D.</option>
                  <option value="clearedPrePhD">Cleared Pre-PhD</option>
                  <option value="thesisSubmitted">Thesis Submitted</option>
                  <option value="awarded">Ph.D. Awarded</option>
                  <option value="postDoc">Post-Doctoral</option>
                  <option value="pgDegree">PG Degree</option>
                  <option value="pgDiploma">PG Diploma</option>
                </select>
              </div>
              <div className="mt-3">{proofField('cat3AdvQual.proofFile', 'Degree / Proof')}</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">Conferences / Seminars / Workshops Attended</h2>
                <ScoreBadge value={live.cat3.conferencesAttended} max={20} />
              </div>
              <p className="text-xs text-ink-muted mb-3">Score 10 per entry, max 20.</p>
              {conferencesAttended.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Paper Title</label><input {...register(`cat3ConferencesAttended.${i}.paperTitle`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Authors</label><input {...register(`cat3ConferencesAttended.${i}.authors`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Conference / Seminar / Workshop</label><input {...register(`cat3ConferencesAttended.${i}.conferenceName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Period</label><input {...register(`cat3ConferencesAttended.${i}.period`)} className={inputCls} /></div>
                  {proofField(`cat3ConferencesAttended.${i}.proofFile`, 'Certificate')}
                  <button type="button" onClick={() => conferencesAttended.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Conference Attended', () => conferencesAttended.append({ paperTitle: '', authors: '', conferenceName: '', period: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.2 Programs Organised</h2>
                <ScoreBadge value={live.cat3.organisedPrograms} max={20} />
              </div>
              {organised.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Title</label><input {...register(`cat3Organised.${i}.title`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Period</label><input {...register(`cat3Organised.${i}.period`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Sponsor</label><input {...register(`cat3Organised.${i}.sponsor`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Scope</label>
                    <select {...register(`cat3Organised.${i}.scope`)} className={inputCls}>
                      <option value="NATIONAL">National</option><option value="INTERNATIONAL">International</option>
                    </select>
                  </div>
                  <div><label className={labelCls}>Status</label>
                    <select {...register(`cat3Organised.${i}.status`)} className={inputCls}>
                      <option value="Completed">Completed</option><option value="Ongoing">Ongoing</option>
                    </select>
                  </div>
                  {proofField(`cat3Organised.${i}.proofFile`)}
                  <button type="button" onClick={() => organised.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Program', () => organised.append({ title: '', period: '', sponsor: '', scope: 'NATIONAL', status: 'Completed', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.3 Resource Person</h2>
                <ScoreBadge value={live.cat3.resourcePerson} max={20} />
              </div>
              {resourcePerson.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Program Type</label>
                      {selectOther(`cat3ResourcePerson.${i}.programType`, RESOURCE_PROGRAM_TYPES, undefined, 'Specify program type')}
                    </div>
                    <div><label className={labelCls}>Program Name</label><input {...register(`cat3ResourcePerson.${i}.programName`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Topic</label><input {...register(`cat3ResourcePerson.${i}.topic`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Duration</label><input {...register(`cat3ResourcePerson.${i}.duration`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Venue</label><input {...register(`cat3ResourcePerson.${i}.venue`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Organised By</label><input {...register(`cat3ResourcePerson.${i}.organisedBy`)} className={inputCls} /></div>
                    {proofField(`cat3ResourcePerson.${i}.proofFile`, 'Certificate')}
                  </div>
                  <button type="button" onClick={() => resourcePerson.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Resource Person Role', () => resourcePerson.append({ programType: 'FDP', programName: '', topic: '', duration: '', venue: '', organisedBy: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.4 Editorial / Review Roles</h2>
                <ScoreBadge value={live.cat3.editorial} max={20} />
              </div>
              {editorial.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Nature of Contribution</label>
                      {selectOther(`cat3Editorial.${i}.natureOfContrib`, EDITORIAL_NATURES, undefined, 'e.g. Program Chair')}
                    </div>
                    <div><label className={labelCls}>Organization / Journal</label><input {...register(`cat3Editorial.${i}.orgOrJournal`)} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Scope</label>
                      <select {...register(`cat3Editorial.${i}.scope`)} className={inputCls}>
                        <option value="NATIONAL">National</option><option value="INTERNATIONAL">International</option>
                      </select>
                    </div>
                    <div><label className={labelCls}>Date / Duration</label><input {...register(`cat3Editorial.${i}.dateDuration`)} className={inputCls} /></div>
                    {proofField(`cat3Editorial.${i}.proofFile`)}
                  </div>
                  <button type="button" onClick={() => editorial.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Editorial Role', () => editorial.append({ natureOfContrib: 'Editorial Board', orgOrJournal: '', scope: 'NATIONAL', dateDuration: '', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.5 Training Attended</h2>
                <ScoreBadge value={live.cat3.training} max={25} />
              </div>
              {/* Was "5 for 5 days or fewer" — wrong since 2026-08-28: under 5 days scores 0. */}
              <p className="text-xs text-ink-muted mb-3">10 for more than 5 days, 5 for exactly 5 days; shorter programmes don&apos;t score. Max 25.</p>
              {training.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Name</label><input {...register(`cat3Training.${i}.name`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Period</label><input {...register(`cat3Training.${i}.period`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Duration (Days)</label><input type="number" min={0} {...register(`cat3Training.${i}.durationDays`, { valueAsNumber: true })} className={inputCls} /></div>
                  {proofField(`cat3Training.${i}.proofFile`, 'Certificate')}
                  <button type="button" onClick={() => training.remove(i)} className="text-red-400 text-xs">Remove</button>
                  <RowNote r={trainingRowScore((watchedValues as any)?.cat3Training?.[i])} />
                </div>
              ))}
              {addRowBtn('Add Training', () => training.append({ name: '', period: '', durationDays: 5 }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">3.6 International Travel</h2>
                <ScoreBadge value={live.cat3.intlTravel} max={5} />
              </div>
              {intlTravel.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Purpose</label><input {...register(`cat3IntlTravel.${i}.purpose`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Place / University</label><input {...register(`cat3IntlTravel.${i}.placeOrUniv`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Outcome</label><input {...register(`cat3IntlTravel.${i}.outcome`)} className={inputCls} /></div>
                  <div>
                    <label className={labelCls}>Funding Source</label>
                    <select {...register(`cat3IntlTravel.${i}.fundingSource`)} className={inputCls}>
                      <option value="">Select...</option>
                      <option value="Self-funded">Self-funded</option>
                      <option value="Institute">Institute</option>
                      <option value="Sponsor">Sponsor</option>
                    </select>
                  </div>
                  {proofField(`cat3IntlTravel.${i}.proofFile`)}
                  <button type="button" onClick={() => intlTravel.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Travel', () => intlTravel.append({ purpose: '', placeOrUniv: '', outcome: '', fundingSource: '', proofFile: '' }))}
            </div>
          </div>
        )}

        {/* Step 4: Governance */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-secondary">Category 4 — Governance</h2>
              <ScoreBadge value={live.cat4.total} max={50} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">4.1 Admin Responsibilities</h2>
                <ScoreBadge value={live.cat4.adminResp} max={40} />
              </div>
              {adminResp.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Responsibility</label><input {...register(`cat4AdminResp.${i}.responsibility`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Level</label>
                    <select {...register(`cat4AdminResp.${i}.level`)} className={inputCls}>
                      <option>Institute</option><option>Department</option>
                    </select>
                  </div>
                  <div><label className={labelCls}>Work Involved</label><input {...register(`cat4AdminResp.${i}.workInvolved`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Period</label><input {...register(`cat4AdminResp.${i}.period`)} className={inputCls} /></div>
                  {proofField(`cat4AdminResp.${i}.proofFile`)}
                  <button type="button" onClick={() => adminResp.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Responsibility', () => adminResp.append({ responsibility: '', level: 'Department', workInvolved: '', period: '1 Semester', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">4.2 Student Activities</h2>
                <ScoreBadge value={live.cat4.studentActivities} max={10} />
              </div>
              {studentAct.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Activity</label><input {...register(`cat4StudentAct.${i}.activityName`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Period</label><input {...register(`cat4StudentAct.${i}.period`)} className={inputCls} /></div>
                  {proofField(`cat4StudentAct.${i}.proofFile`)}
                  <button type="button" onClick={() => studentAct.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Activity', () => studentAct.append({ activityName: '', period: '', proofFile: '' }))}
            </div>
          </div>
        )}

        {/* Step 5: Supplementary */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-secondary">Category 5 — Supplementary</h2>
              <ScoreBadge value={live.cat5.total} max={50} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">5.1 Professional Association</h2>
                <ScoreBadge value={live.cat5.memberships} max={15} />
              </div>
              {memberships.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-2 gap-3 mb-2">
                  <div><label className={labelCls}>Association</label><input {...register(`cat5Memberships.${i}.association`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Status</label>
                    <select {...register(`cat5Memberships.${i}.status`)} className={inputCls}>
                      <option value="national_member">National Member</option>
                      <option value="international_member">International Member</option>
                      <option value="national_executive">National Executive</option>
                      <option value="life_member">Life Membership</option>
                    </select>
                  </div>
                  {proofField(`cat5Memberships.${i}.proofFile`, 'Certificate')}
                  <button type="button" onClick={() => memberships.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Membership', () => memberships.append({ association: '', status: 'national_member', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">5.2 Awards</h2>
                <ScoreBadge value={live.cat5.awards} max={10} />
              </div>
              {awards.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Award Title</label><input {...register(`cat5Awards.${i}.awardType`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Organization</label><input {...register(`cat5Awards.${i}.organization`)} className={inputCls} /></div>
                  <div><label className={labelCls}>Level</label>
                    <select {...register(`cat5Awards.${i}.level`)} className={inputCls}>
                      <option value="international">International</option>
                      <option value="national">National</option>
                      <option value="state">State</option>
                    </select>
                  </div>
                  {proofField(`cat5Awards.${i}.proofFile`, 'Certificate')}
                  <button type="button" onClick={() => awards.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Award', () => awards.append({ awardType: '', organization: '', level: 'national' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">5.3 Differentiators</h2>
                <ScoreBadge value={live.cat5.differentiators} max={20} />
              </div>
              {differentiators.fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-3 gap-3 mb-2">
                  <div><label className={labelCls}>Name</label><input {...register(`cat5Differentiators.${i}.name`)} className={inputCls} /></div>
                  <div>
                    <label className={labelCls}>Role</label>
                    <select {...register(`cat5Differentiators.${i}.role`)} className={inputCls}>
                      <option value="participating">Participating</option>
                      <option value="leading">Leading</option>
                      <option value="initiating">Initiating, shaping &amp; executing</option>
                    </select>
                  </div>
                  {proofField(`cat5Differentiators.${i}.proofFile`)}
                  <button type="button" onClick={() => differentiators.remove(i)} className="text-red-400 text-xs">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Differentiator', () => differentiators.append({ name: '', role: 'participating', proofFile: '' }))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-ink-primary">5.4 Student Internships Arranged</h2>
                <ScoreBadge value={live.cat5.internships} max={5} />
              </div>
              {internships.fields.map((field, i) => (
                <div key={field.id} className="border border-surface-border rounded p-3 mb-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={labelCls}>Industry / Institute</label><input {...register(`cat5Internships.${i}.industryOrInst`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Student Batch</label><input {...register(`cat5Internships.${i}.studentBatch`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Internship Details</label><input {...register(`cat5Internships.${i}.internshipDetails`)} className={inputCls} /></div>
                    <div><label className={labelCls}>Period</label><input {...register(`cat5Internships.${i}.period`)} className={inputCls} /></div>
                    {proofField(`cat5Internships.${i}.proofFile`)}
                  </div>
                  <button type="button" onClick={() => internships.remove(i)} className="text-red-400 text-xs mt-2">Remove</button>
                </div>
              ))}
              {addRowBtn('Add Internship', () => internships.append({ industryOrInst: '', studentBatch: '', internshipDetails: '', period: '', proofFile: '' }))}
            </div>
          </div>
        )}

        {/* Step 6: Preview */}
        {step === 6 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-semibold text-ink-primary mb-1">Preview & Submit</h2>
              <p className="text-sm text-ink-secondary">Auto-saved + scored. Review breakdown below before submitting.</p>
            </div>

            {/* Row counts */}
            <div>
              <h3 className="text-sm font-semibold text-ink-secondary mb-2">Entry Counts</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {([
                  ['Cat 1 Courses', courses.fields.length],
                  ['Cat 1 Projects', projects.fields.length],
                  ['Cat 1 e-Content', eContent.fields.length],
                  ['Cat 1 ICT', ict.fields.length],
                  ['Cat 2 Journals', journals.fields.length],
                  ['Cat 2 Conferences', conferences.fields.length],
                  ['Cat 2 Conf Book Chapters', confBookChapters.fields.length],
                  ['Cat 2 Book Chapters', bookChapters.fields.length],
                  ['Cat 2 Books', books.fields.length],
                  ['Cat 2 Patents', patents.fields.length],
                  ['Cat 2 Sponsored Projects', cat2Proj.fields.length],
                  ['Cat 2 Consultancy', consultancy.fields.length],
                  ['Cat 2 PhD Guidance', guidance.fields.length],
                  ['Cat 2 Research Groups', researchGroups.fields.length],
                  ['Cat 2 Linkages', linkages.fields.length],
                  ['Cat 2 Startups', startups.fields.length],
                  ['Cat 3 Programs Organised', organised.fields.length],
                  ['Cat 3 Resource Person', resourcePerson.fields.length],
                  ['Cat 3 Editorial', editorial.fields.length],
                  ['Cat 3 Training', training.fields.length],
                  ['Cat 3 Intl Travel', intlTravel.fields.length],
                  ['Cat 4 Admin Resp', adminResp.fields.length],
                  ['Cat 4 Student Activities', studentAct.fields.length],
                  ['Cat 5 Memberships', memberships.fields.length],
                  ['Cat 5 Awards', awards.fields.length],
                  ['Cat 5 Differentiators', differentiators.fields.length],
                  ['Cat 5 Internships', internships.fields.length],
                ] as [string, number][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between border border-surface-border rounded px-2 py-1.5">
                    <span className="text-ink-secondary">{k}</span>
                    <span className="font-semibold text-ink-primary">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Score breakdown */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink-secondary">Self-Appraisal Score Breakdown</h3>
                <button type="button" onClick={loadScore} disabled={scoreLoading}
                  className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50">
                  {scoreLoading ? 'Computing...' : 'Recompute'}
                </button>
              </div>

              {scoreLoading && !score && <p className="text-sm text-ink-muted">Computing score...</p>}

              {score && (
                <div className="space-y-3">
                  {([
                    ['Category 1 — Teaching', score.cat1, 150, [
                      ['1.1 Lectures', score.cat1.lectures, 40],
                      ['1.2 Attendance/Feedback/Results', score.cat1.attendanceFeedback, 80],
                      ['1.3 Projects', score.cat1.projects, 20],
                      ['1.4 e-Content', score.cat1.eContent, 5],
                      ['1.5 ICT', score.cat1.ict, 5],
                    ]],
                    ['Category 2 — Research', score.cat2, 150, [
                      ['2.1 Publications', score.cat2.publications, 60],
                      ['2.2 Citations', score.cat2.citations, 5],
                      ['2.3 Books & Book Chapters', score.cat2.books, 10],
                      ['2.4 Patents', score.cat2.patents, 20],
                      ['2.5 Sponsored Projects', score.cat2.sponsoredProjects, 20],
                      ['2.6 Consultancy', score.cat2.consultancy, 10],
                      ['2.7 Guidance', score.cat2.guidance, 5],
                      ['2.8 Research Groups', score.cat2.researchGroups, 5],
                      ['2.9 Institute & Industry Linkages', score.cat2.linkages, 10],
                      ['2.10 Innovation / Start-ups', score.cat2.startups, 5],
                    ]],
                    ['Category 3 — Faculty Development', score.cat3, 100, [
                      ['3.1 Advanced Qualification', score.cat3.advQual, 10],
                      ['3.2 Programs Organised', score.cat3.organisedPrograms, 20],
                      ['Conferences Attended', score.cat3.conferencesAttended, 20],
                      ['3.3 Resource Person', score.cat3.resourcePerson, 20],
                      ['3.4 Editorial', score.cat3.editorial, 20],
                      ['3.5 Training', score.cat3.training, 25],
                      ['3.6 International Travel', score.cat3.intlTravel, 5],
                    ]],
                    ['Category 4 — Governance', score.cat4, 50, [
                      ['4.1 Admin Responsibilities', score.cat4.adminResp, 40],
                      ['4.2 Student Activities', score.cat4.studentActivities, 10],
                    ]],
                    ['Category 5 — Supplementary', score.cat5, 50, [
                      ['5.1 Memberships', score.cat5.memberships, 15],
                      ['5.2 Awards', score.cat5.awards, 10],
                      ['5.3 Differentiators', score.cat5.differentiators, 20],
                      ['5.4 Internships', score.cat5.internships, 5],
                    ]],
                  ] as [string, any, number, [string, number, number][]][]).map(([catLabel, catObj, catMax, rows]) => (
                    <div key={catLabel} className="border border-surface-border rounded overflow-hidden">
                      <div className="flex justify-between items-center bg-surface-muted px-3 py-2 border-b border-surface-border">
                        <span className="text-sm font-semibold text-ink-primary">{catLabel}</span>
                        <span className="text-sm font-bold text-primary-700">{catObj.total} / {catMax}</span>
                      </div>
                      <div className="divide-y divide-surface-border">
                        {rows.map(([rk, rv, rm]) => (
                          <div key={rk} className="flex justify-between px-3 py-1.5 text-xs">
                            <span className="text-ink-secondary">{rk}</span>
                            <span className="font-medium text-ink-primary">{rv} / {rm}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="bg-primary-50 border border-primary-200 rounded p-3 flex justify-between items-center">
                    <span className="text-sm font-semibold text-primary-900">Self-Appraisal Total (Cat 1-5)</span>
                    <span className="text-lg font-bold text-primary-900">{score.selfTotal} / 500</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    Category 6 (Core Values, max 50) and final Grand Total are filled by HoD/Reviewer and not visible to you per policy.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
              Once submitted, you cannot edit until the reviewer responds.
            </div>
          </div>
        )}

        </fieldset>

        {/* Navigation */}
        <div className="flex justify-between mt-6 pt-4 border-t border-surface-border">
          <button
            type="button"
            onClick={() => goToStep(Math.max(0, step - 1))}
            disabled={step === 0 || saving}
            className="flex items-center gap-2 text-sm text-ink-secondary hover:text-ink-primary disabled:opacity-30"
          >
            <ArrowLeft size={14} /> Previous
          </button>

          <div className="flex gap-2">
            {!readOnly && (
              <button
                type="button"
                onClick={() => saveData().catch(() => { /* already shown as a toast */ })}
                disabled={saving}
                className="text-sm border border-surface-border px-4 py-2 rounded hover:bg-surface-muted disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                disabled={saving}
                className="flex items-center gap-2 text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
              >
                Next <ArrowRight size={14} />
              </button>
            ) : !readOnly ? (
              <button
                type="button"
                onClick={submitAppraisal}
                className="flex items-center gap-2 text-sm bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                <Send size={14} /> Submit Appraisal
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
