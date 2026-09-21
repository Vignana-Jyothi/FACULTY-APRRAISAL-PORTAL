# Appraisal Form Alignment — Implementation Plan

Goal: make schema + scoring engine + UI match the official VNRVJIET FPAS
form (ref: `V_Baby_FPAS.md`). Source of truth = the form.

Target category maxima (form):
- Cat1 = 150 (1.1·50 + 1.2·80 + 1.3·20)
- Cat2 = 150 (50+10+10+10+25+10+10+5+10+10)
- Cat3 = 100 (10+20+20+20+25+5)
- Cat4 = 50 (40+10)  ✅ already correct.
- Cat5 = 50 (15+10+20+5)  ✅ scoring correct, data-shape fixes only
- Cat6 = 50 (HoD)  ✅ correct
- Grand total = 550

Work is staged; each stage ends with a verified build (`tsc` + vitest) before
the next. Backend first, frontend second, per stage where practical.

---

## Decisions (LOCKED)
1. **e-Content (1.4) + ICT (1.5):** KEEP both models/UI/scoring. Cat1 total
   still caps at 150, so the extra 10 is harmless headroom.
2. **Startups (2.10):** KEEP `Cat2Startup` as-is; ADD a new
   `Cat2IndustryLinkage` model for the real 2.10. Cat2 total caps at 150.
3. **Book chapters:** stop scoring under 2.1; score under 2.3 with books.
4. **Below-80% lecture engagement (1.1):** KEEP current 4 points.
5. **Citations (2.2):** RESHAPE `Cat2Citations` to form (totalCitations +
   h-index from Google/Scopus/WoS); score from totalCitations.

---

## STAGE 1 — Category 1 alignment  (e-Content/ICT KEPT)
**Schema**
- `Cat1Course`: add `novelPedagogyMethod String?` (the text, e.g. "Chalk and Talk").
  Keep `novelPedagogyUsed` boolean (drives the +5).

**Scoring (`scoreCategory1`)**
- 1.1 lectures: base 10 (≥96%) / 8 (90–95) / 6 (80–89) / **4** (<80, kept); +5
  if novel pedagogy. **Cap 50** (was 40).
- 1.4 e-Content, 1.5 ICT: keep as-is. Cat1 total still caps at 150.
- 1.2, 1.3 unchanged.

**Frontend** (`AppraisalEditPage`): add novel-pedagogy method text input to 1.1.

**Tests**: update `scoringEngine.test.ts` — 1.1 cap now 50.

**Verify**: backend tsc + vitest; frontend tsc.

---

## STAGE 2 — Category 2 alignment
**Schema**
- `PublicationIndex` enum: replace `SCI` with `ESCI`; add `ICI`. Final:
  `ESCI, WOS, SCOPUS, ICI, NONE`.
- Remove `Cat2Startup`; add `Cat2IndustryLinkage`
  (industryName, contactPerson, outcome).
- `Cat2Citations`: reshape to form — `totalPublications Int`,
  `pubsWithCitations Int`, `totalCitations Int`, `hIndexGoogle Int`,
  `hIndexScopus Int`, `hIndexWos Int`. (Drop scopusCount/wosCount.)

**Scoring (`scoreCategory2`)**
- 2.1 publications **cap 50**: indexed journal OR conference (ESCI/WoS/Scopus/ICI)
  = 15; non-indexed journal/conference = 5. **Remove book-chapter term here.**
- 2.2 citations **cap 10** from `totalCitations`: 3–10→2, 11–20→5, 21–40→8, >40→10.
- 2.3 books+chapters **cap 10**: Published 10, Edited 5 (flat). Include both
  `Cat2Book` and `Cat2BookChapter` here. (Decide field: add `published Boolean`
  or reuse `isEdited`.)
- 2.4 patents **cap 10**: Granted/Published 10, Applied/Filed 5.
- 2.5 sponsored **cap 25**.
- 2.7 guidance **cap 10**: Guide 10, Co-Guide 5.
- 2.10 industry linkage **cap 10**: 5 each (replaces startups).
- 2.6, 2.8, 2.9 unchanged (already correct).

**Controllers / pdf / frontend / tests**: rename startups→industryLinkage
everywhere; ESCI/ICI options in index selects; citations form fields; book/
chapter published-vs-edited input. Update tests for every new cap/bracket.

**Verify**: builds + tests.

---

## STAGE 3 — Category 3 alignment
**Schema**
- `Cat3AdvQual` → reshape to PhD status booleans: `registeredForPhD`,
  `clearedPrePhD`, `thesisSubmitted`, `awarded` (or a status enum). Drop
  postdoc/PG fields unless still wanted.
- Add `Cat3ConferenceAttended` (paperTitle, authors, conferenceName, period)
  for **3.3 Attending Conferences**.

**Scoring (`scoreCategory3`)**
- 3.1 **cap 10**: Awarded 10, Thesis Submitted 8, Registered 5, Pre-PhD 5
  (take highest applicable).
- 3.2 organising **cap 20** (unchanged).
- 3.3 attending conferences **cap 20**: 10 each (NEW).
- 3.4 resource person + editorial **combined cap 20**: 10 each across both lists.
- 3.5 training **cap 25**: ≥5 days→10, <5→5 (fix boundary at exactly 5).
- 3.6 travel **cap 5** (unchanged).

**Controllers / pdf / frontend / tests**: add 3.3 section + field array; merge
3.4 scoring cap; reshape 3.1 inputs. Update tests.

**Verify**: builds + tests.

---

## STAGE 4 — Category 5 data-shape fixes (scoring already correct)
**Schema / UI**
- 5.1 membership `status`: use fixed options
  (`national_member` / `international_member` / `national_executive`) via a
  select in the UI so entered data actually scores. (Form's free-text "Active"
  must map to one of these — confirm mapping.)
- 5.2 awards: form scores flat 10 each. Either drop `level` and score 10/award,
  or keep level optional. Proposal: flat 10 each, make `level` optional/unused.

**Tests**: adjust award test to flat-10 if changed.

**Verify**: builds + tests.

---

## STAGE 5 — Migration, end-to-end fill, regression
- Generate Prisma migration (or `db push` per current dev workflow) for all
  schema changes; regenerate client (stop backend dev server first — DLL lock).
- Re-enter the V. Baby sample through the UI end-to-end.
- Assert computed self-totals: Cat1 150, Cat2 105, Cat3 85, Cat4 50, Cat5 40
  (Cat6 by HoD). Note: sample's own 1.3 total (20) is mis-added; by rule = 17,
  so Cat1 may land 147 with correct project data — confirm expected with form owner.
- Full vitest run + both tsc.

---

## Out-of-scope / confirm later
- Whether "below 80% engagement" and exact day-count parsing for 3.5 need
  stricter input validation.
- PDF layout polish for the new/removed sections.
- Backfill/data-migration for any real (non-test) submissions — current DB is
  test data, so destructive column changes are acceptable.

---

## 2026-08-12 — Second alignment pass against the official FPAS PDF

Source of truth re-read subsection by subsection: *FACULTY ANNUAL PERFORMANCE
SELF APPRAISAL (AY 2025-2026)*. Seven discrepancies found and fixed; everything
else (1.1, 1.3, 1.4, 1.5, 2.2, 2.3, 2.5, 2.7, 2.8, 3.1-3.4, 3.6, 4.1, 4.2,
5.1-5.4) already matched.

| # | Subsection | Was | Now (per PDF) |
|---|---|---|---|
| 1 | 2.1 Publications | ESCI/ICI scored 15; non-indexed got 5 | WoS/Scopus journals 15, ESCI/ICI 10, non-indexed 0 |
| 2 | 2.4 Patents | Filed scored 5 | Granted 10, Published 5, Filed 0 |
| 3 | 2.6 Consultancy | exactly 10 L scored 10 | exactly 10 L is the 5-10 band (8); only >10 L scores 10 |
| 4 | 3.5 Training | exactly 5 days scored 10 | >5 days 10, 5 days or fewer 5 |
| 5 | 2.9 / 2.10 | institutes (cap 10) + industry (cap 10) as two subsections, start-ups unnumbered | 2.9 = institutes **and** industry sharing one cap of 10; start-ups is 2.10 (cap 5) |
| 6 | 1.2 Attendance/Results | A and C derived from student-count bands | PDF formulas: A = (avg attendance % / 100) x 5, C = (pass % / 100) x 10 |
| 7 | Cat 3 numbering | local "Conferences Attended" occupied 3.2, shifting every real subsection down one | PDF numbering restored (3.1-3.6); the local section is un-numbered |

**Product-owner decisions taken during this pass:**
- 1.2 follows the PDF formulas. The five band columns (`attnGte75`,
  `attnLt75Gte65`, `gradeOAPlus`, `gradeAB`, `gradeCD`) were dropped from
  `Cat1CourseResults` and replaced by `avgAttendancePct` + `passPercentage`.
  `classSize` is retained for display only.
- "Conferences / Seminars / Workshops Attended" is **deliberately kept scored**
  (10 per row, max 20) even though the PDF has no such subsection. It is shown
  un-numbered so it cannot be confused with a PDF subsection.
- 2.1 follows the PDF strictly, so non-indexed publications no longer earn a
  consolation score.

**Resulting maxima:** Cat 1 = 150 (40+80+20+5+5), Cat 2 = 150
(60+5+10+20+20+10+5+5+10+5), Cat 4 = 50 (40+10), Cat 5 = 50 (15+10+20+5).
Cat 3's category cap stays **100**; its subsection maxima sum to 120 only
because of the deliberate local Conferences Attended addition, and the category
cap still clamps the total.

Plan: `docs/superpowers/plans/2026-08-12-fpas-pdf-alignment.md`.
