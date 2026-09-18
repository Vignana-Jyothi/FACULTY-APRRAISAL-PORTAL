import { SubmissionStatus } from '@prisma/client';
import { stripReviewerAssessment } from './reviewVisibility';

type ReviewData = {
  cat1Score?: number | null;
  cat2Score?: number | null;
  cat3Score?: number | null;
  cat4Score?: number | null;
  cat5Score?: number | null;
  cat6Punctuality?: number | null;
  cat6Professionalism?: number | null;
  cat6Willingness?: number | null;
  cat6Cordiality?: number | null;
  cat6Classroom?: number | null;
  totalScore?: number | null;
  grandTotal?: number | null;
  teachingComment?: string | null;
  researchComment?: string | null;
  developmentComment?: string | null;
  governanceComment?: string | null;
  supplementaryComment?: string | null;
  overallComment?: string | null;
  status: SubmissionStatus;
  [key: string]: unknown;
};

const COMMENT_FIELDS = [
  'teachingComment',
  'researchComment',
  'developmentComment',
  'governanceComment',
  'supplementaryComment',
  'overallComment',
];

const SCORE_FIELDS = [
  'cat1Score', 'cat2Score', 'cat3Score', 'cat4Score', 'cat5Score',
  'cat6Punctuality', 'cat6Professionalism', 'cat6Willingness',
  'cat6Cordiality', 'cat6Classroom', 'totalScore', 'grandTotal',
];

export function serializeSubmissionForFaculty(submission: Record<string, unknown>, review: ReviewData | null) {
  if (!review) return { ...submission, review: null };

  const commentsVisible =
    review.status === SubmissionStatus.APPROVED ||
    review.status === SubmissionStatus.REJECTED;

  const safeReview: Record<string, unknown> = { ...review };

  for (const field of SCORE_FIELDS) {
    delete safeReview[field];
  }

  if (!commentsVisible) {
    for (const field of COMMENT_FIELDS) {
      delete safeReview[field];
    }
  }

  return { ...submission, review: safeReview };
}

/** Full review: the principal, and the HoD/incharge of the faculty's own department. */
export function serializeSubmissionForReviewer(submission: Record<string, unknown>, review: ReviewData | null) {
  return { ...submission, review };
}

/**
 * The reviewed appraisal out of 500, with the reviewer's assessment of the
 * person removed. This is what the dean and the scrutinizer pool get
 * — everything the department reviewer sees except Category 6 and the /550
 * grand total (utils/reviewVisibility).
 */
export function serializeSubmissionStripped(submission: Record<string, unknown>, review: ReviewData | null) {
  return { ...submission, review: stripReviewerAssessment(review) };
}
