import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { appraisalApi } from '../../api/appraisals';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Eye } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import ProofVerificationPanel from '../../components/ProofVerificationPanel';
import FeedbackSection from '../../components/FeedbackSection';
import { useAuthStore } from '../../store/authStore';
import {
  courseResultScore, lectureRowScore, projectRowScore, eContentRowScore, ictRowScore,
  publicationScore, INDEX_LABEL, authorCount, citationScore, bookRowScore, patentRowScore,
  sponsoredProjectRowScore, consultancyRowScore, guidanceRowScore, outcomeRowScore, advQualScore,
  trainingRowScore, membershipRowScore, awardRowScore, differentiatorRowScore, PER_ENTRY,
} from '../../utils/scoring';

type RowLine = { text: string; reason?: string; score: number };
type RowSection = { title: string; rows: any[]; total: number | undefined; max: number; line: (r: any) => RowLine };

const scopeLabel = (s: unknown) => (s === 'INTERNATIONAL' ? 'International' : s === 'NATIONAL' ? 'National' : '');
const quoted = (v: unknown) => `"${String(v ?? '').trim() || 'untitled'}"`;
const joined = (...bits: unknown[]) => bits.map((b) => String(b ?? '').trim()).filter(Boolean).join(' · ');

// One card per subsection from 2.6 on: each entry with the helper's reason and
// score, and the section total as the engine capped it. Same helpers the
// engines score with — never re-derive a rule here.
function RowsCard({ title, rows, total, max, line }: RowSection) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif flex items-baseline justify-between gap-2">
        <span>{title} ({rows.length})</span>
        <span className="text-xs font-normal text-ink-muted">{total ?? 0} / {max}</span>
      </h2>
      {rows.map((r, i) => {
        const l = line(r);
        return (
          <div key={r.id ?? i} className="text-xs text-ink-secondary mb-1">
            {l.text}
            {l.reason && <> — <span className={l.score ? '' : 'text-amber-700'}>{l.reason}</span></>}
            {` → ${l.score}`}
          </div>
        );
      })}
    </Card>
  );
}
import { sponsoredProjectWarnings } from '../../utils/sponsoredProjects';
import { patentWarnings } from '../../utils/patents';
import { citationWarnings } from '../../utils/citations';

export default function ReviewAppraisalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [submission, setSubmission] = useState<any>(null);
  const [score, setScore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Category 6 and the /550 grand total belong to the department's own
  // assessment. Only the roles allowed to see core values get those blocks —
  // everyone else stays on the /500 scale. Ownership wins over role: a
  // reviewer looking at their own appraisal is treated as the owner.
  const canSeeCoreValues = useAuthStore((s) => s.canSeeCoreValues);
  const showCoreValues = canSeeCoreValues(submission?.userId ?? submission?.user?.id ?? null);

  const { register, handleSubmit, watch, reset, formState: { isSubmitting } } = useForm({
    defaultValues: {
      cat1Score: undefined as number | undefined,
      cat2Score: undefined as number | undefined,
      cat3Score: undefined as number | undefined,
      cat4Score: undefined as number | undefined,
      cat5Score: undefined as number | undefined,
      cat6Punctuality: 0, cat6Professionalism: 0, cat6Willingness: 0,
      cat6Cordiality: 0, cat6Classroom: 0,
      teachingComment: '', researchComment: '', developmentComment: '',
      governanceComment: '', supplementaryComment: '', overallComment: '',
      status: 'APPROVED',
    },
  });

  useEffect(() => {
    Promise.all([
      appraisalApi.get(id!),
      appraisalApi.getScore(id!),
    ]).then(([sub, sc]) => {
      setSubmission(sub);
      setScore(sc);
      // Seed the reviewer's marks with what the engine computed, so the form
      // starts from the evidence and the reviewer only edits what they disagree with.
      reset((prev: any) => ({
        ...prev,
        cat1Score: sc.cat1.total, cat2Score: sc.cat2.total, cat3Score: sc.cat3.total,
        cat4Score: sc.cat4.total, cat5Score: sc.cat5.total,
      }));
    }).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, [id]);

  // Live Cat 6 running total for the score card — the only part of the review
  // score the reviewer actually awards (1-5 are recomputed server-side).
  const cat6Fields = watch(['cat6Punctuality', 'cat6Professionalism', 'cat6Willingness', 'cat6Cordiality', 'cat6Classroom']);
  const cat6Total = Math.min(cat6Fields.reduce((sum: number, v: any) => sum + (Number(v) || 0), 0), 50);

  // Reviewer's own marks for 1-5 (seeded from the computed score, editable).
  const awarded = watch(['cat1Score', 'cat2Score', 'cat3Score', 'cat4Score', 'cat5Score']);
  const awardedTotal = awarded.reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);

  const onSubmit = async (data: any) => {
    // Approval cannot be revisited (the API returns "Already approved"), so make
    // the reviewer confirm the marks they are locking in.
    if (data.status === 'APPROVED') {
      const total = showCoreValues
        ? `${(awardedTotal + cat6Total).toFixed(1)} / 550`
        : `${awardedTotal.toFixed(1)} / 500`;
      const ok = window.confirm(
        `Approve this appraisal with a reviewed total of ${total}?

` +
        'A submission can only be approved once — the marks cannot be changed afterwards.'
      );
      if (!ok) return;
    }
    try {
      await appraisalApi.submitReview(id!, data);
      toast.success(`Submission ${data.status.toLowerCase()}`);
      navigate('/reviews');
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed');
    }
  };

  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";
  const labelCls = "block text-xs font-medium text-ink-secondary mb-1";

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;
  if (!submission) return <div className="text-sm text-danger-500">Not found</div>;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Review: ${submission.user?.name}`}
        subtitle={`${submission.user?.employeeCode} — Submission #${submission.submissionNumber} — ${submission.academicYear?.label}`}
        breadcrumbs={[
          { label: 'Review Queue', to: '/reviews' },
          { label: submission.user?.name },
        ]}
        actions={
          <button
            onClick={() => navigate(`/appraisal/${id}/edit`)}
            className="flex items-center gap-1 text-sm border border-surface-border px-3 py-1.5 rounded hover:bg-surface-muted"
          >
            <Eye size={14} /> View Full Form
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Submission data summary */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Score</h2>
            {score && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-muted">
                  <span>Category</span>
                  <span className="flex gap-4">
                    <span className="w-20 text-right">Self</span>
                    <span className="w-20 text-right">HoD Review</span>
                  </span>
                </div>
                {[
                  { label: 'Cat 1 — Teaching', val: score.cat1.total, max: 150, field: 'cat1Score' },
                  { label: 'Cat 2 — Research', val: score.cat2.total, max: 150, field: 'cat2Score' },
                  { label: 'Cat 3 — Development', val: score.cat3.total, max: 100, field: 'cat3Score' },
                  { label: 'Cat 4 — Governance', val: score.cat4.total, max: 50, field: 'cat4Score' },
                  { label: 'Cat 5 — Supplementary', val: score.cat5.total, max: 50, field: 'cat5Score' },
                ].map(({ label, val, max, field }, idx) => {
                  const mark = Number(awarded[idx] ?? val) || 0;
                  const changed = Math.abs(mark - val) > 0.001;
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs text-ink-secondary">
                        {label}
                        {changed && (
                          <span className="ml-1 text-[10px] text-accent-600">
                            ({mark > val ? '+' : ''}{(mark - val).toFixed(1)})
                          </span>
                        )}
                      </span>
                      <span className="flex gap-4 items-center text-xs">
                        <span className="w-20 text-right font-medium text-ink-primary">{val.toFixed(1)} / {max}</span>
                        <span className="w-20 flex items-center justify-end gap-1">
                          <input
                            type="number" min="0" max={max} step="0.5"
                            {...register(field as any, { valueAsNumber: true })}
                            className={`w-14 text-right border rounded px-1 py-0.5 text-xs bg-surface-card text-ink-primary ${changed ? 'border-accent-500' : 'border-surface-border'}`}
                          />
                          <span className="text-ink-subtle">/{max}</span>
                        </span>
                      </span>
                    </div>
                  );
                })}
                {showCoreValues && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-secondary">Cat 6 — Core Values</span>
                    <span className="flex gap-4 text-xs">
                      <span className="w-20 text-right text-ink-subtle">—</span>
                      <span className="w-20 text-right font-medium text-ink-primary pr-6">{cat6Total.toFixed(1)} / 50</span>
                    </span>
                  </div>
                )}
                <div className="border-t border-surface-border pt-2 flex items-center justify-between font-medium">
                  <span className="text-sm text-ink-secondary">Total</span>
                  <span className="flex gap-4 text-sm">
                    <span className="w-20 text-right text-primary-700">{score.selfTotal.toFixed(1)} / 500</span>
                    <span className="w-20 text-right text-primary-700 pr-6">
                      {showCoreValues
                        ? `${(awardedTotal + cat6Total).toFixed(1)} / 550`
                        : `${awardedTotal.toFixed(1)} / 500`}
                    </span>
                  </span>
                </div>
                <p className="text-[10px] text-ink-muted pt-1">
                  The review column starts from what the engine computed off the submitted evidence. Edit any
                  category you disagree with — a changed mark is highlighted with the difference.
                  {showCoreValues && ' Cat 6 is scored in the Core Values card below. Both totals are recorded.'}
                </p>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">1.1 Courses — Lectures ({submission.cat1Courses?.length ?? 0})</h2>
            {submission.cat1Courses?.map((c: any) => {
              // Same helper the scoring engines use — never re-derive 1.1 here.
              const r = lectureRowScore(c);
              return (
                <div key={c.id} className="text-xs text-ink-secondary mb-1">
                  {c.courseName} ({c.level}, {c.yearSem}) — Periods: {c.periodsConducted}/{c.periodPlanned}
                  {r.pct != null ? ` = ${r.pct}% → ${r.engagement}` : ' → 0'}
                  {r.novelty ? ` | Novel pedagogy${c.novelPedagogyMethod ? ` (${c.novelPedagogyMethod})` : ''} +5` : ''}
                  {` | Total: ${r.total}/15`}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">1.2 Attendance, Feedback &amp; Results ({submission.cat1CourseResults?.length ?? 0})</h2>
            {submission.cat1CourseResults?.map((c: any) => {
              const Y = c.classSize || 0;
              // Same helper the scoring engines use — never re-derive 1.2 here.
              const { A, B, C, total } = courseResultScore(c);
              return (
                <div key={c.id} className="text-xs text-ink-secondary mb-1">
                  {c.courseName} (Y={Y}) — A: {A.toFixed(2)} | B: {B.toFixed(2)} | C: {C.toFixed(2)} | Total: {total.toFixed(2)}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">1.3 Academic Projects Guided ({submission.cat1Projects?.length ?? 0})</h2>
            {submission.cat1Projects?.map((p: any) => {
              // Same helper the scoring engines use — never re-derive 1.3 here.
              const r = projectRowScore(p);
              const units = r.unit === 'student' ? (r.count === 1 ? 'student' : 'students') : (r.count === 1 ? 'batch' : 'batches');
              return (
                <div key={p.id} className="text-xs text-ink-secondary mb-1">
                  {p.course === 'MTECH' ? 'M.Tech' : 'B.Tech'} {p.projectType === 'MAJOR' ? 'major' : 'mini'} — {r.count} {units} × {r.rate} = {r.score}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">1.4 e-Content ({submission.cat1EContent?.length ?? 0})</h2>
            {submission.cat1EContent?.map((e: any) => {
              // Same helper the scoring engines use — never re-derive 1.4 here.
              const r = eContentRowScore(e);
              const link = /^https?:\/\//i.test(String(e.evidenceFile ?? '').trim());
              return (
                <div key={e.id} className="text-xs text-ink-secondary mb-1">
                  {e.contentName || '(untitled)'} — {e.courseName} ({e.nature}) —{' '}
                  {r.evidence
                    ? (link
                      ? <a href={e.evidenceFile.trim()} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">evidence</a>
                      : <span>file attached</span>)
                    : <span className="text-amber-700">no evidence link</span>}
                  {` → ${r.score}`}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">1.5 ICT &amp; Digital Platforms ({submission.cat1ICT?.length ?? 0})</h2>
            {submission.cat1ICT?.map((x: any) => {
              // Same helper the scoring engines use — never re-derive 1.5 here.
              const r = ictRowScore(x);
              const link = /^https?:\/\//i.test(String(x.evidenceFile ?? '').trim());
              return (
                <div key={x.id} className="text-xs text-ink-secondary mb-1">
                  {x.courseName} — {x.platform} ({x.natureOfUse}) —{' '}
                  {r.evidence
                    ? (link
                      ? <a href={x.evidenceFile.trim()} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">evidence</a>
                      : <span>file attached</span>)
                    : <span className="text-amber-700">no evidence link</span>}
                  {` → ${r.score}`}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">
              2.1 Research Papers ({(submission.cat2Journals?.length ?? 0) + (submission.cat2Conferences?.length ?? 0) + (submission.cat2ConfBookChapters?.length ?? 0)})
            </h2>
            {([
              ['A. Journals', 'journal', submission.cat2Journals, 'journalName'],
              ['B. Conference proceedings', 'conference', submission.cat2Conferences, 'conferenceName'],
              ['C. Book chapters (from conferences)', 'chapter', submission.cat2ConfBookChapters, 'conferenceName'],
            ] as const).map(([heading, kind, rows, venueKey]) => (rows?.length ? (
              <div key={kind} className="mb-2">
                <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-0.5">{heading}</div>
                {rows.map((p: any) => {
                  // Same helper the scoring engines use (index rule + authorship
                  // claim) — never re-derive 2.1 here.
                  const r = publicationScore(kind, p);
                  const n = authorCount(p);
                  const campus = p.allAuthorsFromCampus === true
                    ? `all authors VNRVJIET${p.claimedBySelf === true ? `, claimed by ${submission.user?.name ?? 'the faculty'}` : ''}`
                    : p.allAuthorsFromCampus === false ? 'with other institutions' : '';
                  const bits = [
                    INDEX_LABEL[p.indexed] ?? p.indexed, p.quartile, p.impactFactor ? `IF ${p.impactFactor}` : '',
                    p.authorPosition ? `${p.authorPosition} author` : '', n ? `${n} authors` : '', campus,
                  ].filter(Boolean).join(' · ');
                  return (
                    <div key={p.id} className="text-xs text-ink-secondary mb-1">
                      "{p.title}" — {p[venueKey]} — {bits}
                      {!r.score && <> — <span className="text-amber-700">{r.reason}</span></>} → {r.score}
                      {p.authors && <div className="text-[11px] text-ink-muted">{p.authors}</div>}
                    </div>
                  );
                })}
              </div>
            ) : null))}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">2.2 Citations (Scopus / WoS only)</h2>
            {(() => {
              const c = submission.cat2Citations;
              if (!c) return <div className="text-xs text-ink-muted">Not filled.</div>;
              return (
                <>
                  <div className="text-xs text-ink-secondary">
                    Publications / books till date: {c.totalPubsTillDate} | with citations: {c.pubsWithCitations} | total citations: {c.totalCitations} | h-index Scopus {c.hIndexScopus}, WoS {c.hIndexWos}
                    {/* Same band helper the scoring engines use — never re-derive 2.2 here. */}
                    {` → ${citationScore(c.totalCitations)}`}
                  </div>
                  {citationWarnings(c).map((w: string) => <div key={w} className="text-xs text-amber-700 mt-0.5">⚠ {w}</div>)}
                </>
              );
            })()}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">
              2.3 Books &amp; Academic Book Chapters ({(submission.cat2Books?.length ?? 0) + (submission.cat2BookChapters?.length ?? 0)})
            </h2>
            {([
              ['Books', submission.cat2Books, false],
              ['Book chapters', submission.cat2BookChapters, true],
            ] as const).map(([heading, rows, isChapter]) => (rows?.length ? (
              <div key={heading} className="mb-2">
                <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide mb-0.5">{heading}</div>
                {rows.map((b: any) => {
                  // Same helper the scoring engines use — never re-derive 2.3 here.
                  const r = bookRowScore(b);
                  const bits = [b.publisher, b.isbn ? `ISBN ${b.isbn}` : '', isChapter && b.chapterNo ? `ch. ${b.chapterNo}` : ''].filter(Boolean).join(' · ');
                  return (
                    <div key={b.id} className="text-xs text-ink-secondary mb-1">
                      "{b.title}"{bits ? ` — ${bits}` : ''} — <span className={r.score ? '' : 'text-amber-700'}>{r.reason}</span> → {r.score}
                    </div>
                  );
                })}
              </div>
            ) : null))}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">2.4 Patents / IPR ({submission.cat2Patents?.length ?? 0})</h2>
            {(submission.cat2Patents ?? []).map((p: any, i: number, all: any[]) => {
              // Same helper the scoring engines use — never re-derive 2.4 here.
              const r = patentRowScore(p);
              const type = p.iprType === 'Other' ? (p.iprTypeOther || 'Other') : (p.iprType || 'Patent');
              const bits = [type, p.country, p.appNumber ? `No. ${p.appNumber}` : '', p.inventors].filter(Boolean).join(' · ');
              return (
                <div key={p.id} className="text-xs text-ink-secondary mb-1">
                  "{p.title}" — {bits} — <span className={r.score ? '' : 'text-amber-700'}>{r.reason}</span> → {r.score}
                  {patentWarnings(all, i).map((w) => <div key={w} className="text-amber-700">⚠ {w}</div>)}
                </div>
              );
            })}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-2 pb-2 border-b border-accent-500/30 font-serif">2.5 Sponsored Research Projects ({submission.cat2Projects?.length ?? 0})</h2>
            {(submission.cat2Projects ?? []).map((p: any) => {
              // Same helper the scoring engines use — never re-derive 2.5 here.
              const r = sponsoredProjectRowScore(p);
              const when = p.status === 'APPLIED'
                ? (p.dateOfApplication ? `applied ${String(p.dateOfApplication).slice(0, 10)}` : '')
                : (p.durationPeriod || '');
              const bits = [p.fundingAgency, p.amountLakhs ? `Rs. ${p.amountLakhs} lakh` : '',
                p.role === 'Co-PI' ? 'Co-investigator' : 'Principal Investigator', when].filter(Boolean).join(' · ');
              return (
                <div key={p.id} className="text-xs text-ink-secondary mb-1">
                  "{p.title}" — {bits} — <span className={r.score ? '' : 'text-amber-700'}>{r.reason}</span> → {r.score}
                  {sponsoredProjectWarnings(p).map((w) => <div key={w} className="text-amber-700">⚠ {w}</div>)}
                </div>
              );
            })}
          </Card>

          {(() => {
            const flat = (n: number) => () => ({ score: n });
            const sections: RowSection[] = [
              { title: '2.6 Consultancy Projects', rows: submission.cat2Consultancy ?? [], total: score?.cat2.consultancy, max: 10,
                line: (c) => ({ text: `${quoted(c.name)} — ${joined(c.agency, `Rs. ${c.amountLakhs ?? 0} lakh`)}`, ...consultancyRowScore(c) }) },
              { title: '2.7 Research Guidance', rows: submission.cat2Guidance ?? [], total: score?.cat2.guidance, max: 5,
                line: (g) => ({ text: `${quoted(g.studentName)} — ${joined(g.university, g.thesisTitle)}`, ...guidanceRowScore(g) }) },
              { title: '2.8 Research Interest Groups', rows: submission.cat2ResearchGroups ?? [], total: score?.cat2.researchGroups, max: 5,
                line: (g) => ({ text: `${quoted(g.groupName)} — ${joined(g.size ? `size ${g.size}` : '', g.outcome ? `outcome: ${g.outcome}` : '')}`, ...outcomeRowScore(g.groupName, g.outcome) }) },
              { title: '2.9 Institute & Industry Linkages',
                rows: [
                  ...(submission.cat2Linkages ?? []).map((l: any) => ({ ...l, kind: 'Institute', name: l.instituteName })),
                  ...(submission.cat2IndustryLinkages ?? []).map((l: any) => ({ ...l, kind: 'Industry', name: l.industryName })),
                ],
                total: score?.cat2.linkages, max: 10,
                line: (l) => ({ text: `${l.kind}: ${quoted(l.name)} — ${joined(l.contactPerson, l.outcome ? `outcome: ${l.outcome}` : '')}`, ...outcomeRowScore(l.name, l.outcome) }) },
              { title: '2.10 Innovation / Start-ups', rows: submission.cat2Startups ?? [], total: score?.cat2.startups, max: 5,
                line: (x) => ({ text: `${quoted(x.groupName)} — ${joined(x.activity, x.outcome ? `outcome: ${x.outcome}` : '')}`, ...outcomeRowScore(x.groupName, x.outcome) }) },
              { title: '3.1 Status of Ph.D.', rows: submission.cat3AdvQual ? [submission.cat3AdvQual] : [], total: score?.cat3.advQual, max: 10,
                line: (q) => ({ text: 'Highest applicable', ...advQualScore(q) }) },
              { title: 'Conferences Attended (local, not in the PDF)', rows: submission.cat3ConferencesAttended ?? [], total: score?.cat3.conferencesAttended, max: 20,
                line: (c) => ({ text: `${quoted(c.paperTitle)} — ${joined(c.conferenceName, c.period)}`, ...flat(PER_ENTRY.conferencesAttended)() }) },
              { title: '3.2 Programmes Organised', rows: submission.cat3Organised ?? [], total: score?.cat3.organisedPrograms, max: 20,
                line: (e) => ({ text: `${quoted(e.title)} — ${joined(e.period, e.sponsor, e.status, scopeLabel(e.scope))}`, ...flat(PER_ENTRY.organisedPrograms)() }) },
              { title: '3.3 Resource Person', rows: submission.cat3ResourcePerson ?? [], total: score?.cat3.resourcePerson, max: 20,
                line: (r) => ({ text: `${quoted(r.programName)} — ${joined(r.programType, r.topic, r.duration, r.venue)}`, ...flat(PER_ENTRY.resourcePerson)() }) },
              { title: '3.4 Editorial / Review Roles', rows: submission.cat3Editorial ?? [], total: score?.cat3.editorial, max: 20,
                line: (e) => ({ text: `${e.natureOfContrib || 'Contribution'} — ${joined(e.orgOrJournal, scopeLabel(e.scope), e.dateDuration)}`, ...flat(PER_ENTRY.editorial)() }) },
              { title: '3.5 Training Attended', rows: submission.cat3Training ?? [], total: score?.cat3.training, max: 25,
                line: (t) => ({ text: `${quoted(t.name)} — ${joined(t.period, t.durationDays != null ? `${t.durationDays} days` : '')}`, ...trainingRowScore(t) }) },
              { title: '3.6 International Travel', rows: submission.cat3IntlTravel ?? [], total: score?.cat3.intlTravel, max: 5,
                line: (t) => ({ text: `${quoted(t.purpose)} — ${joined(t.placeOrUniv, t.outcome ? `outcome: ${t.outcome}` : '')}`, ...flat(PER_ENTRY.intlTravel)() }) },
              { title: '4.1 Administrative Responsibilities', rows: submission.cat4AdminResp ?? [], total: score?.cat4.adminResp, max: 40,
                line: (a) => ({ text: `${quoted(a.responsibility)} — ${joined(a.level, a.workInvolved, a.period)}`, ...flat(PER_ENTRY.adminResp)() }) },
              { title: '4.2 Student Activities', rows: submission.cat4StudentAct ?? [], total: score?.cat4.studentActivities, max: 10,
                line: (s) => ({ text: `${quoted(s.activityName)} — ${joined(s.period)}`, ...flat(PER_ENTRY.studentActivities)() }) },
              { title: '5.1 Professional Memberships', rows: submission.cat5Memberships ?? [], total: score?.cat5.memberships, max: 15,
                line: (m) => ({ text: quoted(m.association), ...membershipRowScore(m) }) },
              { title: '5.2 Awards', rows: submission.cat5Awards ?? [], total: score?.cat5.awards, max: 10,
                line: (a) => ({ text: `${quoted(a.awardType)} — ${joined(a.organization)}`, ...awardRowScore(a) }) },
              { title: '5.3 VNR VJIET Differentiators', rows: submission.cat5Differentiators ?? [], total: score?.cat5.differentiators, max: 20,
                line: (d) => ({ text: quoted(d.name), ...differentiatorRowScore(d) }) },
              { title: '5.4 Internships Arranged', rows: submission.cat5Internships ?? [], total: score?.cat5.internships, max: 5,
                line: (i) => ({ text: `${quoted(i.industryOrInst)} — ${joined(i.studentBatch ? `batch ${i.studentBatch}` : '', i.internshipDetails, i.period)}`, ...flat(PER_ENTRY.internships)() }) },
            ];
            const empty = sections.filter((s) => !s.rows.length).map((s) => s.title.split(' ')[0]);
            return (
              <>
                {sections.filter((s) => s.rows.length).map((s) => <RowsCard key={s.title} {...s} />)}
                {empty.length > 0 && (
                  <Card>
                    <div className="text-xs text-ink-muted">No entries: {empty.join(', ')}</div>
                  </Card>
                )}
              </>
            );
          })()}

          <ProofVerificationPanel submissionId={id!} />

          <FeedbackSection submissionId={id!} />

        </div>

        {/* Right: Review form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {showCoreValues && (
            <Card>
              <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Category 6 — Core Values (0-10 each)</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['cat6Punctuality', 'Punctuality'],
                  ['cat6Professionalism', 'Professionalism'],
                  ['cat6Willingness', 'Willingness'],
                  ['cat6Cordiality', 'Cordiality'],
                  ['cat6Classroom', 'Classroom Conduct'],
                ].map(([field, label]) => (
                  <div key={field}>
                    <label className={labelCls}>{label}</label>
                    <input type="number" min="0" max="10" step="0.5"
                      {...register(field as any, { valueAsNumber: true })}
                      className={inputCls} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Comments</h2>
            <p className="text-[10px] text-ink-muted mb-3">Released to faculty on approval/rejection</p>
            <div className="space-y-3">
              {[
                ['teachingComment', 'Teaching'],
                ['researchComment', 'Research'],
                ['developmentComment', 'Development'],
                ['governanceComment', 'Governance'],
                ['supplementaryComment', 'Supplementary'],
                ['overallComment', 'Overall'],
              ].map(([field, label]) => (
                <div key={field}>
                  <label className={labelCls}>{label} Comment</label>
                  <textarea rows={2} {...register(field as any)} className={inputCls} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Decision</h2>
            <p className="text-[10px] text-ink-muted mb-3">
              Approval is final — a submission can only be approved once, and the marks above are locked in as
              awarded. Check the score column before you approve.
            </p>
            <div className="flex gap-3">
              <label className="flex-1 border-2 border-emerald-200 rounded p-3 cursor-pointer has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
                <input type="radio" {...register('status')} value="APPROVED" className="sr-only" />
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                  <CheckCircle size={16} /> Approve
                </div>
              </label>
              <label className="flex-1 border-2 border-red-200 rounded p-3 cursor-pointer has-[:checked]:border-red-500 has-[:checked]:bg-red-50">
                <input type="radio" {...register('status')} value="REJECTED" className="sr-only" />
                <div className="flex items-center gap-2 text-sm font-medium text-red-700">
                  <XCircle size={16} /> Reject
                </div>
              </label>
            </div>
          </Card>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary-600 text-white py-2.5 rounded font-medium text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </form>
      </div>
    </div>
  );
}
