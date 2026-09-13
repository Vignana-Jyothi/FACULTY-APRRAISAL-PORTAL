import prisma from '../utils/prismaClient';

// Proof-bearing category rows and how to label them. The section map is derived
// from these on demand — proofs are plain URL strings (uploaded file OR pasted
// link, e.g. Google Drive) held on the category rows, so both are handled the
// same way here.
type Source = {
  key: string;
  section: string;
  title: (r: any) => string | undefined | null;
  fields: [string, string][]; // [rowField, humanLabel]
};

export const PROOF_SOURCES: Source[] = [
  // Section labels must match the form's numbering (1.2 was split in two, which
  // left these one number high). proofDeadline maps stored labels back to keys,
  // so change a label only while no rejected proof still carries the old one.
  { key: 'cat1EContent', section: '1.4 e-Content', title: (r) => r.contentName || r.courseName, fields: [['evidenceFile', 'Evidence']] },
  { key: 'cat1ICT', section: '1.5 ICT Tools', title: (r) => r.platform || r.courseName, fields: [['evidenceFile', 'Evidence']] },
  { key: 'cat2Journals', section: '2.1-A Journals', title: (r) => r.title, fields: [['proofFile', 'Proof'], ['indexProofFile', 'Index proof']] },
  { key: 'cat2Conferences', section: '2.1-B Conferences', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2ConfBookChapters', section: '2.1-C Conference Book Chapters', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2BookChapters', section: '2.3 Book Chapters', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Books', section: '2.3 Books', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Patents', section: '2.4 Patents / IPR', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Projects', section: '2.5 Sponsored Projects', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Consultancy', section: '2.6 Consultancy', title: (r) => r.name, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Guidance', section: '2.7 Research Guidance', title: (r) => r.studentName || r.thesisTitle, fields: [['proofFile', 'Proof']] },
  { key: 'cat2ResearchGroups', section: '2.8 Research Groups', title: (r) => r.groupName, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Linkages', section: '2.9 Institute Linkages', title: (r) => r.instituteName, fields: [['proofFile', 'Proof']] },
  { key: 'cat2IndustryLinkages', section: '2.9 Industry Linkage', title: (r) => r.industryName, fields: [['proofFile', 'Proof']] },
  { key: 'cat2Startups', section: '2.10 Innovation / Start-ups', title: (r) => r.groupName, fields: [['proofFile', 'Proof']] },
  { key: 'cat3AdvQual', section: '3.1 Status of Ph.D.', title: () => 'Status of Ph.D.', fields: [['proofFile', 'Proof']] },
  { key: 'cat3Organised', section: '3.2 Organised Programs', title: (r) => r.title, fields: [['proofFile', 'Proof']] },
  // Conferences Attended is a local addition with no PDF number, so it carries
  // none. A relabel reaches rows already stored on the next sync
  // (syncProofVerifications rewrites the section), so only a REJECTED row
  // awaiting the deadline sweep can be caught out by it.
  { key: 'cat3ConferencesAttended', section: 'Conferences Attended (Cat 3)', title: (r) => r.paperTitle || r.conferenceName, fields: [['proofFile', 'Proof']] },
  { key: 'cat3ResourcePerson', section: '3.3 Resource Person', title: (r) => r.programName || r.topic, fields: [['proofFile', 'Proof']] },
  { key: 'cat3Editorial', section: '3.4 Editorial / Review Roles', title: (r) => r.orgOrJournal, fields: [['proofFile', 'Proof']] },
  { key: 'cat3IntlTravel', section: '3.6 International Travel', title: (r) => r.purpose || r.placeOrUniv, fields: [['proofFile', 'Proof']] },
  { key: 'cat4AdminResp', section: '4.1 Administrative Responsibilities', title: (r) => r.responsibility, fields: [['proofFile', 'Proof']] },
  { key: 'cat4StudentAct', section: '4.2 Student Activities', title: (r) => r.activityName, fields: [['proofFile', 'Proof']] },
  { key: 'cat5Memberships', section: '5.1 Professional Memberships', title: (r) => r.association, fields: [['proofFile', 'Proof']] },
  { key: 'cat5Differentiators', section: '5.3 Differentiators', title: (r) => r.name, fields: [['proofFile', 'Proof']] },
  { key: 'cat5Internships', section: '5.4 Internships', title: (r) => r.industryOrInst || r.internshipDetails, fields: [['proofFile', 'Proof']] },
  { key: 'cat3Training', section: '3.5 Training Attended', title: (r) => r.name, fields: [['proofFile', 'Proof']] },
  { key: 'cat5Awards', section: '5.2 Awards', title: (r) => r.awardType, fields: [['proofFile', 'Proof']] },
];

// Relations needed to enumerate proofs.
export const PROOF_INCLUDE = {
  cat1EContent: true,
  cat1ICT: true,
  cat2Journals: true,
  cat2Conferences: true,
  cat2ConfBookChapters: true,
  cat2BookChapters: true,
  cat2Books: true,
  cat2Patents: true,
  cat2Projects: true,
  cat2Consultancy: true,
  cat2Guidance: true,
  cat2ResearchGroups: true,
  cat2Linkages: true,
  cat2IndustryLinkages: true,
  cat2Startups: true,
  cat3AdvQual: true,
  cat3Organised: true,
  cat3ConferencesAttended: true,
  cat3ResourcePerson: true,
  cat3Editorial: true,
  cat3IntlTravel: true,
  cat4AdminResp: true,
  cat4StudentAct: true,
  cat5Memberships: true,
  cat5Differentiators: true,
  cat5Internships: true,
  cat3Training: true,
  cat5Awards: true,
} as const;

export interface ProofItem {
  section: string;
  item: string;
  field: string;
  url: string;
}

// Walk a submission (loaded with PROOF_INCLUDE) and collect every proof URL.
export function enumerateProofs(sub: any): ProofItem[] {
  const items: ProofItem[] = [];
  for (const src of PROOF_SOURCES) {
    const rows = sub[src.key];
    if (!rows) continue;
    const list = Array.isArray(rows) ? rows : [rows];
    for (const r of list) {
      for (const [rowField, label] of src.fields) {
        const url = r[rowField];
        if (typeof url === 'string' && url.trim()) {
          items.push({ section: src.section, item: (src.title(r) || '(untitled)').toString(), field: label, url: url.trim() });
        }
      }
    }
  }
  return items;
}

// Reconcile ProofVerification rows with the submission's current proofs:
// create PENDING rows for new URLs, refresh section/item/field on existing
// ones (keeping their verification status), and prune rows whose URL is gone.
// Returns the fresh set of rows.
export async function syncProofVerifications(submissionId: string) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: submissionId },
    include: PROOF_INCLUDE,
  });
  if (!sub) return [];

  const items = enumerateProofs(sub);
  const currentUrls = new Set(items.map((i) => i.url));
  const existing = await prisma.proofVerification.findMany({ where: { submissionId } });
  const existingByUrl = new Map(existing.map((e) => [e.url, e]));

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const prev = existingByUrl.get(item.url);
      if (prev) {
        if (prev.section !== item.section || prev.item !== item.item || prev.field !== item.field) {
          await tx.proofVerification.update({
            where: { id: prev.id },
            data: { section: item.section, item: item.item, field: item.field },
          });
        }
      } else {
        await tx.proofVerification.create({
          data: { submissionId, section: item.section, item: item.item, field: item.field, url: item.url },
        });
      }
    }
    // Prune proofs that were removed/replaced.
    const stale = existing.filter((e) => !currentUrls.has(e.url));
    if (stale.length) {
      await tx.proofVerification.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  });

  return prisma.proofVerification.findMany({
    where: { submissionId },
    orderBy: [{ section: 'asc' }, { item: 'asc' }],
    include: { verifiedBy: { select: { id: true, name: true } } },
  });
}

// Gate: true when the submission has no unverified proof. Syncs first so a
// newly-added proof can't slip through. Zero proofs = vacuously verified.
export async function allProofsVerified(submissionId: string): Promise<boolean> {
  const rows = await syncProofVerifications(submissionId);
  return rows.every((r) => r.status === 'VERIFIED');
}
