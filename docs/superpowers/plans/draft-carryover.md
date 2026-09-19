# Draft carries over the year (2026-09-19)

Replaces the discarded quarterly-submission cycle (stash "quarterly-cycle
(discarded ...)"). The lifecycle stays the single-submission one on `main`,
with these changes (owner decisions 2026-09-19):

1. **One draft for the whole year.** Faculty keep editing the same DRAFT
   through Q1-Q4. There is no quarterly submission.
2. **Submit unlocks only when the Q4 review window ends** (its `endDate`,
   enabled window of that academic year). No Q4 window configured -> the
   academic year's `endDate`. `submissionOpen` must still be true.
3. **Proofs are checked on the draft.** The department's HoD and incharge
   (REVIEWER) — and the principal — can see a draft's proofs during the year
   and verify or reject them.
   - Rejecting a proof on a DRAFT marks it REJECTED with the reason and emails
     the faculty to replace it. **No HOLD, no red list, no proof deadline** — the
     draft stays editable. Replacing the file/link makes a new pending row.
   - Verified proofs carry into the final submission (same submission, same
     rows). The existing final-approval gate still refuses approval while any
     proof is unverified.
4. **Draft review.** During the year the HoD notes provisional **Cat 1-5
   overrides and Cat 6** on the draft (`DraftReview`, one per appraisal). They
   pre-fill the one real HoD review after submission, where they become final.
   - Written by the HoD of the owner's department only.
   - Read by the department's HoD/incharge and the principal (full), the dean
     (Cat 6 stripped). **Never shown to the owner** — it is provisional.
5. Everything after submission is unchanged: HoD review -> scrutinizers ->
   final; reports/tracking/export; the armed-window quarterly email (still the
   provisional self score).

## Schema (pushed)
`DraftReview` { submissionId @unique, reviewerId, cat1..5Score, cat6 x5,
overallComment, createdAt, updatedAt } + back-relation on AppraisalSubmission.
