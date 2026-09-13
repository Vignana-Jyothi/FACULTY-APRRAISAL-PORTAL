import { PROOF_SOURCES } from '../services/proofService';
import prisma from '../utils/prismaClient';
import { SubmissionStatus } from '@prisma/client';

/**
 * Void the marks for proofs that were rejected and never corrected.
 *
 * A submission on HOLD blocks the whole workflow: the HoD cannot approve while
 * any proof is unverified, so one ignored rejection would stall the appraisal
 * indefinitely. Once the correction deadline passes, the source behind each
 * still-rejected proof is voided — its rows score nothing — and the submission
 * returns to SUBMITTED so the review can proceed on the reduced marks.
 *
 * The faculty STAYS red-listed. The point is to unblock the workflow, not to
 * forgive the missing evidence: `redListed` remains true and the hold reason is
 * kept as the record of why the marks were cut.
 */
export async function voidExpiredProofs(
  at: Date = new Date(),
  // Tests run against the shared database and pass a future `at`; without a
  // scope they voided every held appraisal due before it — other suites' and,
  // on a restored database, real faculty's. The daily job passes no scope.
  scope?: { submissionIds?: string[] },
) {
  const due = await prisma.appraisalSubmission.findMany({
    where: {
      ...(scope?.submissionIds ? { id: { in: scope.submissionIds } } : {}),
      status: SubmissionStatus.HOLD,
      proofDeadlineAt: { not: null, lte: at },
      proofVerifications: { some: { status: 'REJECTED' } },
    },
    include: { proofVerifications: { where: { status: 'REJECTED' }, select: { section: true } } },
  });

  // Proof sections carry display labels ("2.1 Journals"); map them back to the
  // source key the scoring engines understand ("cat2Journals").
  const keyBySection = new Map(PROOF_SOURCES.map((s) => [s.section, s.key]));

  let voidedCount = 0;
  for (const sub of due) {
    const sources = [
      ...new Set(
        sub.proofVerifications
          .map((pv) => keyBySection.get(pv.section))
          .filter((k): k is string => !!k)
      ),
    ];
    if (!sources.length) continue;

    const merged = [...new Set([...sub.voidedSources, ...sources])];

    await prisma.$transaction(async (tx) => {
      await tx.appraisalSubmission.update({
        where: { id: sub.id },
        data: {
          voidedSources: merged,
          // Back into the queue so the HoD can review the reduced marks.
          // redListed deliberately left true.
          status: SubmissionStatus.SUBMITTED,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: sub.userId,
          action: 'PROOF_DEADLINE_VOIDED',
          entityType: 'AppraisalSubmission',
          entityId: sub.id,
          metadata: { sources, deadline: sub.proofDeadlineAt?.toISOString() ?? null },
        },
      });
    });
    voidedCount++;
  }

  if (voidedCount) console.log(`[cron] Proof deadline: voided sources on ${voidedCount} submission(s)`);
  return { submissions: voidedCount };
}
