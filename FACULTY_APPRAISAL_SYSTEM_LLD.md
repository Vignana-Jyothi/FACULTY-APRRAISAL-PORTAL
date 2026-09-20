# Faculty Appraisal System — Full Low-Level Design (LLD)

> ⚠️ **Historical document — June 2026. Do not build from it.** This is the
> original specification the system was first implemented from. The shipped
> system has since diverged from it in several load-bearing ways:
>
> - **Roles**: the 4 roles in §2 are now **7** — `ADMIN` (maintenance only, no
>   appraisal content), `PRINCIPAL`, `DEAN`, `SCRUTINIZER`,
>   `SPECIAL_SCRUTINIZER`, `HOD`, `REVIEWER`, `FACULTY`.
>   `backend/src/utils/roles.ts` is the single source of the role sets.
> - **Visibility**: Category 6 and the /550 grand total are gated by
>   **ownership**, not role, in `backend/src/utils/reviewVisibility.ts`. Faculty
>   do see the reviewer's Category 1–5 marks and the reviewed /500 after a
>   decision.
> - **Workflow**: one draft carries the whole academic year and may be submitted
>   only from the day after the Q4 review window ends; proof verification and a
>   provisional HoD draft review happen on that draft; an approved review then
>   goes to dean-assigned cross-department scrutinizers.
> - **FPGP**: retired 2026-09-13. The controllers, services and UI were deleted;
>   only the database models remain, so every FPGP section here is dead.
> - **Stack**: React 19 and Node 24, not React 18.
> - **Scoring**: revised table by table against the official FPAS PDF during
>   2026-08/09. Where this document and `backend/src/services/scoringEngine.ts`
>   disagree, the engine is correct.
>
> For the system as it stands, read [README.md](README.md),
> [HANDOFF.md](HANDOFF.md) and `docs/architecture.html`. The data-model and
> scoring chapters below remain useful as background on *why* things are shaped
> as they are.

---

## 0. Tech Stack (Strict)

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | PostgreSQL |
| **ORM** | Prisma |
| **Auth** | JWT (access token) + bcrypt (password hashing) |
| **File Storage** | Local `/uploads` folder (swap to S3 later) |
| **PDF Export** | Puppeteer |
| **Excel Export** | xlsx (SheetJS) |
| **Validation** | Zod (backend) + React Hook Form + Zod (frontend) |
| **Charts (FPGP)** | Recharts |
| **API Style** | REST |
| **Environment** | `.env` files for secrets, never hardcode |

---

## 1. Project Structure

```
/
├── frontend/                  # Vite + React + TypeScript
│   ├── src/
│   │   ├── api/               # Axios API client + typed request functions
│   │   ├── components/        # Shared UI components
│   │   ├── pages/
│   │   │   ├── auth/          # Login, ForgotPassword
│   │   │   ├── faculty/       # Dashboard, Appraisal form, FPGP
│   │   │   ├── reviewer/      # Review queue, Review appraisal, FPGP review
│   │   │   ├── hod/           # Same as reviewer + dept reports
│   │   │   └── admin/         # User mgmt, dept mgmt, year mgmt, all appraisals, reports
│   │   ├── hooks/             # Custom hooks (useAuth, useAppraisal, useFPGP)
│   │   ├── store/             # Zustand or React Context for auth state
│   │   ├── types/             # Shared TypeScript interfaces mirroring DB models
│   │   └── utils/             # Score calculators, formatters, constants
│   └── vite.config.ts
│
├── backend/                   # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── controllers/       # Route handlers (thin, delegate to services)
│   │   ├── services/          # Business logic, scoring engine, FPGP engine
│   │   ├── routes/            # Express routers
│   │   ├── middleware/        # auth, roleGuard, errorHandler
│   │   ├── prisma/
│   │   │   └── schema.prisma  # Full DB schema
│   │   ├── utils/             # JWT helpers, file upload handler
│   │   └── app.ts             # Express app setup
│   └── tsconfig.json
│
└── README.md
```

---

## 2. Role System

There are 4 roles in the system. A single user can hold **multiple roles simultaneously** (e.g., a faculty who is also a Reviewer).

```
FACULTY    → Default role on creation. Fill appraisal, set FPGP, view own comments (never scores).
HOD        → Assigned per-department by Admin. Review dept faculty, fill Cat 6, approve/reject, add comments.
REVIEWER   → Any faculty elevated by Admin. Same access as HOD for assigned departments. CANNOT review own appraisal.
ADMIN      → God mode. Manages users, roles, departments, academic years, views everything.
```

### Critical Role Rules
1. A **Reviewer cannot review their own appraisal** — enforce at API middleware level, not just frontend.
2. If a **HoD submits their own appraisal**, Admin must assign a separate Reviewer to evaluate it.
3. A Reviewer can be assigned to **multiple departments**.
4. Only Admin can **grant or revoke** the Reviewer role.
5. HOD role is **per-department** (a person can be HoD of only one department).

---

## 3. Database Schema (Prisma)

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ───────────────────────────────────────────────

enum RoleType {
  FACULTY
  HOD
  REVIEWER
  ADMIN
}

enum SubmissionStatus {
  DRAFT
  SUBMITTED
  UNDER_REVIEW
  APPROVED
  REJECTED
  WITHDRAWN
}

enum FPGPStatus {
  DRAFT
  ACTIVE
  REVIEWED
}

enum ProjectType {
  MINI
  MAJOR
}

enum CourseLevel {
  BTECH
  MTECH
}

enum PublicationIndex {
  SCI
  WOS
  SCOPUS
  NONE
}

enum PatentStatus {
  FILED
  PUBLISHED
  GRANTED
}

enum ProjectStatus {
  APPLIED
  ONGOING
  COMPLETED
}

enum ReviewerRole {
  HOD
  REVIEWER
}

enum Scope {
  NATIONAL
  INTERNATIONAL
}

enum Priority {
  HIGH
  MEDIUM
  LOW
}

// ─── CORE TABLES ─────────────────────────────────────────

model User {
  id                    String   @id @default(uuid())
  employeeCode          String   @unique
  name                  String
  email                 String   @unique
  passwordHash          String
  dob                   DateTime?
  dateOfJoining         DateTime?
  designation           String?
  ratifiedDesignation   String?
  lastPromotionDate     DateTime?
  departmentId          String?
  payBand               String?
  gradePay              String?
  grossPay              Float?
  educationalQuals      String?
  specialization        String?
  periodOfServiceYears  Int?
  periodOfServiceMonths Int?
  expBeforeTeaching     Float?
  expBeforeIndustrial   Float?
  expBeforeResearch     Float?
  phone                 String?
  contactAddress        String?
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  department            Department?          @relation(fields: [departmentId], references: [id])
  userRoles             UserRole[]
  appraisals            AppraisalSubmission[]
  fpgpPlans             FPGPPlan[]
  reviewsGiven          AppraisalReview[]
  fpgpReviewsGiven      FPGPReview[]
  auditLogs             AuditLog[]
}

model Department {
  id        String   @id @default(uuid())
  name      String   @unique
  code      String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  users         User[]
  userRoles     UserRole[]
  academicYears AcademicYearDept[]
}

model UserRole {
  id           String    @id @default(uuid())
  userId       String
  role         RoleType
  departmentId String?   // nullable — ADMIN & FACULTY don't need dept; REVIEWER can span multiple
  assignedBy   String    // adminUserId
  assignedAt   DateTime  @default(now())
  isActive     Boolean   @default(true)

  user         User       @relation(fields: [userId], references: [id])
  department   Department? @relation(fields: [departmentId], references: [id])

  @@unique([userId, role, departmentId])
}

model AcademicYear {
  id                String   @id @default(uuid())
  label             String   @unique  // e.g. "2025-26"
  startDate         DateTime
  endDate           DateTime
  submissionOpen    Boolean  @default(false)
  maxSubmissions    Int      @default(4)
  createdAt         DateTime @default(now())

  deptSettings      AcademicYearDept[]
  appraisals        AppraisalSubmission[]
}

model AcademicYearDept {
  id             String   @id @default(uuid())
  academicYearId String
  departmentId   String
  submissionOpen Boolean  @default(false)

  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id])
  department     Department   @relation(fields: [departmentId], references: [id])

  @@unique([academicYearId, departmentId])
}

// ─── APPRAISAL SUBMISSION ────────────────────────────────

model AppraisalSubmission {
  id                 String           @id @default(uuid())
  userId             String
  academicYearId     String
  submissionNumber   Int              // 1, 2, 3, or 4
  status             SubmissionStatus @default(DRAFT)
  submittedAt        DateTime?
  withdrawnAt        DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  // Leave data (Part I)
  clLeaves           Int?
  elLeaves           Int?
  hplLeaves          Int?
  odLeaves           Int?
  otherLeaves        String?
  higherQualAcquired String?

  user               User             @relation(fields: [userId], references: [id])
  academicYear       AcademicYear     @relation(fields: [academicYearId], references: [id])

  // Categories
  cat1Courses        Cat1Course[]
  cat1Projects       Cat1Project[]
  cat1EContent       Cat1EContent[]
  cat1ICT            Cat1ICT[]
  cat2Journals       Cat2Journal[]
  cat2Conferences    Cat2Conference[]
  cat2BookChapters   Cat2BookChapter[]
  cat2Books          Cat2Book[]
  cat2Citations      Cat2Citations?
  cat2Patents        Cat2Patent[]
  cat2Projects       Cat2Project[]
  cat2Consultancy    Cat2Consultancy[]
  cat2Guidance       Cat2Guidance[]
  cat2ResearchGroups Cat2ResearchGroup[]
  cat2Linkages       Cat2Linkage[]
  cat2Startups       Cat2Startup[]
  cat3AdvQual        Cat3AdvQual?
  cat3Organised      Cat3OrganisedProgram[]
  cat3ResourcePerson Cat3ResourcePerson[]
  cat3Editorial      Cat3Editorial[]
  cat3Training       Cat3Training[]
  cat3IntlTravel     Cat3IntlTravel[]
  cat4AdminResp      Cat4AdminResp[]
  cat4StudentAct     Cat4StudentActivity[]
  cat5Memberships    Cat5Membership[]
  cat5Awards         Cat5Award[]
  cat5Differentiators Cat5Differentiator[]
  cat5Internships    Cat5Internship[]

  review             AppraisalReview?
  fpgpProgress       FPGPProgress[]

  @@unique([userId, academicYearId, submissionNumber])
}

// ─── CATEGORY 1: TEACHING ────────────────────────────────

model Cat1Course {
  id                 String  @id @default(uuid())
  submissionId       String
  courseName         String
  level              CourseLevel
  yearSem            String
  novelPedagogyUsed  Boolean @default(false)
  periodPlanned      Int
  periodsConducted   Int
  avgAttendance      Float   // percentage
  feedbackScore      Float   // 0-5 (B score)
  passPercentage     Float   // percentage

  submission         AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat1Project {
  id           String      @id @default(uuid())
  submissionId String
  course       CourseLevel
  projectType  ProjectType
  count        Int

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat1EContent {
  id           String  @id @default(uuid())
  submissionId String
  courseName   String
  contentName  String
  nature       String  // Video/Audio/PPT/Other
  evidenceFile String? // file path

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat1ICT {
  id           String  @id @default(uuid())
  submissionId String
  courseName   String
  platform     String  // Google Classroom / Moodle / MS Teams / etc.
  natureOfUse  String  // Assignments / Quizzes / Recorded Lectures / Discussion Forums
  evidenceFile String?

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

// ─── CATEGORY 2: RESEARCH ────────────────────────────────

model Cat2Journal {
  id             String           @id @default(uuid())
  submissionId   String
  title          String
  journalName    String
  authors        String           // comma-separated as listed in paper
  authorPosition String           // First/Second/Corresponding/Supervisor
  volume         String?
  issueNo        String?
  pageNos        String?
  dateOfPub      DateTime?
  issn           String?
  doi            String?
  impactFactor   Float?
  indexed        PublicationIndex @default(NONE)
  quartile       String?          // Q1/Q2/Q3/Q4

  submission     AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Conference {
  id             String           @id @default(uuid())
  submissionId   String
  title          String
  conferenceName String
  authors        String
  authorPosition String
  dateOfPub      DateTime?
  issn           String?
  doi            String?
  indexed        PublicationIndex @default(NONE)

  submission     AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2BookChapter {
  id             String  @id @default(uuid())
  submissionId   String
  title          String
  authors        String
  authorPosition String
  publisher      String?
  isbn           String?
  chapterNo      String?
  isEdited       Boolean @default(false)
  scope          Scope   @default(INTERNATIONAL)

  submission     AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Book {
  id           String  @id @default(uuid())
  submissionId String
  title        String
  authors      String
  publisher    String?
  isbn         String?
  isEdited     Boolean @default(false)
  scope        Scope   @default(INTERNATIONAL)

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Citations {
  id              String @id @default(uuid())
  submissionId    String @unique
  scopusCount     Int    @default(0)
  wosCount        Int    @default(0)
  hIndex          Int    @default(0)
  pubsWithCitations Int  @default(0)
  totalPubsTillDate Int  @default(0)

  submission      AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Patent {
  id            String       @id @default(uuid())
  submissionId  String
  title         String
  country       String
  inventors     String
  appNumber     String?
  status        PatentStatus
  dateOfPub     DateTime?
  dateOfGrant   DateTime?
  validDuration String?

  submission    AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Project {
  id               String        @id @default(uuid())
  submissionId     String
  title            String
  fundingAgency    String
  amountLakhs      Float
  role             String        // PI / Co-PI
  status           ProjectStatus
  durationPeriod   String?
  dateOfApplication DateTime?

  submission       AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Consultancy {
  id           String @id @default(uuid())
  submissionId String
  name         String
  agency       String
  amountLakhs  Float

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Guidance {
  id           String @id @default(uuid())
  submissionId String
  studentName  String
  university   String
  thesisTitle  String
  isGuide      Boolean @default(true) // true=Guide, false=Co-Guide

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2ResearchGroup {
  id           String @id @default(uuid())
  submissionId String
  groupName    String
  size         Int
  outcome      String

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Linkage {
  id                String @id @default(uuid())
  submissionId      String
  instituteName     String
  contactPerson     String
  outcome           String

  submission        AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat2Startup {
  id           String @id @default(uuid())
  submissionId String
  groupName    String
  activity     String
  outcome      String

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

// ─── CATEGORY 3: FACULTY DEVELOPMENT ────────────────────

model Cat3AdvQual {
  id                 String  @id @default(uuid())
  submissionId       String  @unique
  pursuingPostDoc    Boolean @default(false)
  phdStatus          String? // "thesis_submitted" | "pre_phd_completed" | "coursework_completed" | null
  pursuingPGDegree   Boolean @default(false)
  pursuingPGDiploma  Boolean @default(false)

  submission         AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat3OrganisedProgram {
  id           String @id @default(uuid())
  submissionId String
  title        String
  period       String
  sponsor      String?
  status       String  // Completed / Ongoing
  scope        Scope

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat3ResourcePerson {
  id           String @id @default(uuid())
  submissionId String
  programType  String  // FDP / Conference / Workshop / Guest Lecture / Webinar / etc.
  programName  String
  topic        String
  duration     String
  venue        String
  organisedBy  String

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat3Editorial {
  id              String @id @default(uuid())
  submissionId    String
  natureOfContrib String  // Editorial Board / Review Committee / Org Committee / etc.
  orgOrJournal    String
  scope           Scope
  dateDuration    String

  submission      AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat3Training {
  id           String   @id @default(uuid())
  submissionId String
  name         String   // FDP / STTP / ATAL / NPTEL / etc.
  period       String
  durationDays Int      // used to compute score: >5 days = 10, exactly 5 = 5

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat3IntlTravel {
  id           String @id @default(uuid())
  submissionId String
  purpose      String
  placeOrUniv  String
  outcome      String

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

// ─── CATEGORY 4: GOVERNANCE ──────────────────────────────

model Cat4AdminResp {
  id             String @id @default(uuid())
  submissionId   String
  responsibility String
  level          String  // "Institute" | "Department"
  workInvolved   String
  period         String  // "1 Semester" | "2 Semesters"

  submission     AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat4StudentActivity {
  id           String @id @default(uuid())
  submissionId String
  activityName String
  period       String

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

// ─── CATEGORY 5: SUPPLEMENTARY ───────────────────────────

model Cat5Membership {
  id           String @id @default(uuid())
  submissionId String
  association  String
  status       String  // "national_member" | "international_member" | "national_executive"

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat5Award {
  id           String @id @default(uuid())
  submissionId String
  awardType    String
  organization String
  level        String  // "international" | "national" | "state"

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat5Differentiator {
  id           String @id @default(uuid())
  submissionId String
  name         String
  role         String  // "participating" | "leading" | "initiating"

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model Cat5Internship {
  id                String @id @default(uuid())
  submissionId      String
  industryOrInst    String
  studentBatch      String
  internshipDetails String
  period            String

  submission        AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

// ─── APPRAISAL REVIEW (HoD / Reviewer fills this) ───────

model AppraisalReview {
  id           String      @id @default(uuid())
  submissionId String      @unique
  reviewerId   String      // userId of HoD or Reviewer
  reviewerRole ReviewerRole

  // ── SCORES — NEVER SENT TO FACULTY IN API RESPONSES ──
  cat1Score    Float?
  cat2Score    Float?
  cat3Score    Float?
  cat4Score    Float?
  cat5Score    Float?

  // Category 6 — Core Values (HoD fills, 10 each, max 50)
  cat6Punctuality    Float?  // max 10
  cat6Professionalism Float? // max 10
  cat6Willingness    Float?  // max 10
  cat6Cordiality     Float?  // max 10
  cat6Classroom      Float?  // max 10

  totalScore   Float?        // sum of cat1–5 (max 500)
  grandTotal   Float?        // totalScore + cat6 (max 550)

  // ── COMMENTS — RELEASED TO FACULTY WHEN STATUS = REVIEWED/APPROVED ──
  teachingComment      String?
  researchComment      String?
  developmentComment   String?
  governanceComment    String?
  supplementaryComment String?
  overallComment       String?

  status       SubmissionStatus  // APPROVED | REJECTED
  reviewedAt   DateTime @default(now())

  submission   AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  reviewer     User                @relation(fields: [reviewerId], references: [id])
}

// ─── FPGP: FACULTY PERFORMANCE GROWTH PLAN ───────────────

model FPGPPlan {
  id             String     @id @default(uuid())
  userId         String
  academicYearId String
  status         FPGPStatus @default(DRAFT)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  user           User         @relation(fields: [userId], references: [id])
  targets        FPGPTarget[]
  reviews        FPGPReview[]

  @@unique([userId, academicYearId])
}

model FPGPTarget {
  id                 String   @id @default(uuid())
  fpgpId             String
  category           String   // "Teaching" | "Research" | "FacultyDev" | "Governance" | "Supplementary"
  subSection         String   // e.g. "2.1 Journal Publications", "3.5 Training Attended"
  targetDescription  String
  targetValue        Float    // numeric goal
  unit               String   // "papers" | "patents" | "projects" | "hours" | "batches" | etc.
  deadline           DateTime?
  priority           Priority @default(MEDIUM)

  fpgpPlan           FPGPPlan      @relation(fields: [fpgpId], references: [id], onDelete: Cascade)
  progress           FPGPProgress[]
}

model FPGPProgress {
  id               String   @id @default(uuid())
  targetId         String
  submissionId     String   // which appraisal submission this was computed from
  currentValue     Float    // auto-calculated from appraisal data
  achievementPct   Float    // (currentValue / targetValue) * 100
  computedAt       DateTime @default(now())

  target           FPGPTarget          @relation(fields: [targetId], references: [id], onDelete: Cascade)
  submission       AppraisalSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
}

model FPGPReview {
  id           String      @id @default(uuid())
  fpgpId       String
  reviewerId   String
  reviewerRole ReviewerRole
  comments     String
  reviewedAt   DateTime    @default(now())

  fpgpPlan     FPGPPlan @relation(fields: [fpgpId], references: [id], onDelete: Cascade)
  reviewer     User     @relation(fields: [reviewerId], references: [id])
}

// ─── AUDIT LOG ───────────────────────────────────────────

model AuditLog {
  id         String   @id @default(uuid())
  userId     String
  action     String   // e.g. "SUBMISSION_SUBMITTED", "ROLE_ASSIGNED", "REVIEW_APPROVED"
  entityType String   // e.g. "AppraisalSubmission", "UserRole"
  entityId   String
  metadata   Json?    // additional context
  createdAt  DateTime @default(now())

  user       User @relation(fields: [userId], references: [id])
}
```

---

## 4. Scoring Engine

> **Location:** `backend/src/services/scoringEngine.ts`
> This service takes a full `AppraisalSubmission` with all relations loaded and returns a `ScoreBreakdown` object. It is called on every save and on review.

### 4.1 Category 1 — Teaching (Max: 150)

#### 1.1 Lectures (Max: 40)
```
For each course:
  engagementPct = (periodsConducted / periodPlanned) * 100
  if engagementPct >= 96: base = 10
  else if engagementPct >= 90: base = 8
  else if engagementPct >= 80: base = 6
  else: base = 4

  noveltyBonus = novelPedagogyUsed ? 5 : 0

  courseScore = base + noveltyBonus

score_1_1 = min(sum of all courseScores, 40)
```

#### 1.2 Attendance / Feedback / Results (Max: 80)
```
For each course (max 20 per course):
  A = (avgAttendance / 100) * 5          // max 5
  B = feedbackScore                       // 0-5, entered directly
  C = (passPercentage / 100) * 10        // max 10
  courseScore = min(A + B + C, 20)

score_1_2 = min(sum of all courseScores, 80)
```

#### 1.3 Academic Projects Guided (Max: 20)
```
For each Cat1Project row:
  if course == BTECH && projectType == MINI:   pts = 2 * count
  if course == BTECH && projectType == MAJOR:  pts = 5 * count
  if course == MTECH && projectType == MINI:   pts = 3 * count
  if course == MTECH && projectType == MAJOR:  pts = 5 * count

score_1_3 = min(sum of all pts, 20)
```

#### 1.4 e-Content (Max: 5)
```
score_1_4 = min(cat1EContent.length * 2, 5)
```

#### 1.5 ICT Usage (Max: 5)
```
score_1_5 = min(cat1ICT.length * 2, 5)
// HoD can manually override this score up to 5 during review
```

```
CATEGORY_1_TOTAL = min(score_1_1 + score_1_2 + score_1_3 + score_1_4 + score_1_5, 150)
```

---

### 4.2 Category 2 — Research (Max: 150)

#### 2.1 Publications (Max: 60)
```
For each journal:
  if indexed in [SCI, WOS, SCOPUS]: pts = 15
  else: pts = 0

For each conference:
  if indexed != NONE: pts = 10
  else: pts = 0

For each bookChapter:
  if indexed != NONE: pts = 10
  else: pts = 0

score_2_1 = min(total pts, 60)
```

#### 2.2 Citations (Max: 5)
```
totalCitations = scopusCount + wosCount
if totalCitations >= 101: score_2_2 = 5
else if totalCitations >= 51: score_2_2 = 3
else if totalCitations >= 11: score_2_2 = 2
else if totalCitations >= 3: score_2_2 = 1
else: score_2_2 = 0
```

#### 2.3 Books (Max: 10)
```
For each Cat2Book:
  if scope == INTERNATIONAL && !isEdited: pts = 10
  if scope == INTERNATIONAL && isEdited:  pts = 5
  if scope == NATIONAL && !isEdited:      pts = 5
  if scope == NATIONAL && isEdited:       pts = 3

score_2_3 = min(sum of pts, 10)
```

#### 2.4 Patents (Max: 20)
```
For each patent:
  if status == GRANTED:   pts = 10
  if status == PUBLISHED: pts = 5
  if status == FILED:     pts = 0

score_2_4 = min(sum of pts, 20)
```

#### 2.5 Sponsored Projects (Max: 20)
```
For each project:
  if status == ONGOING:   pts = 20
  if status == APPLIED:   pts = 5
  if status == COMPLETED: pts = 0  // completed not mentioned in rules

score_2_5 = min(max of all individual pts, 20)
// NOTE: "Ongoing" alone already maxes the score. Sum is still capped at 20.
```

#### 2.6 Consultancy (Max: 10)
```
For each consultancy:
  if amountLakhs < 1:    pts = 2
  if amountLakhs < 2:    pts = 4
  if amountLakhs < 5:    pts = 6
  if amountLakhs < 10:   pts = 8
  if amountLakhs >= 10:  pts = 10

score_2_6 = min(sum of pts, 10)
```

#### 2.7 Research Guidance (Max: 5)
```
For each guidance:
  if isGuide == true:  pts = 5
  if isGuide == false: pts = 3  // Co-Guide

score_2_7 = min(sum of pts, 5)
```

#### 2.8 Research Interest Groups (Max: 5)
```
score_2_8 = cat2ResearchGroups.length > 0 ? 5 : 0
// Full 5 only if there are tangible outcomes (HoD verifies)
```

#### 2.9 Institute Linkages (Max: 10)
```
score_2_9 = min(cat2Linkages.length * 5, 10)
```

#### 2.10 Startups / Innovation (Max: 5)
```
score_2_10 = min(cat2Startups.length * 5, 5)
```

```
CATEGORY_2_TOTAL = min(
  score_2_1 + score_2_2 + score_2_3 + score_2_4 + score_2_5 +
  score_2_6 + score_2_7 + score_2_8 + score_2_9 + score_2_10,
  150
)
```

---

### 4.3 Category 3 — Faculty Development (Max: 100)

#### 3.1 Advanced Qualification (Max: 10)
```
if pursuingPostDoc || pursuingPGDegree || pursuingPGDiploma: pts = 10
else if phdStatus == "thesis_submitted": pts = 10
else if phdStatus == "pre_phd_completed": pts = 8
else if phdStatus == "coursework_completed": pts = 5
else: pts = 0

score_3_1 = pts  // only one applies — take the max if multiple
```

#### 3.2 Organised Programs (Max: 20)
```
score_3_2 = min(cat3OrganisedPrograms.length * 10, 20)
```

#### 3.3 Resource Person (Max: 20)
```
score_3_3 = min(cat3ResourcePerson.length * 10, 20)
```

#### 3.4 Editorial / Review Roles (Max: 20)
```
score_3_4 = min(cat3Editorial.length * 10, 20)
```

#### 3.5 Training Attended (Max: 25)
```
For each training:
  if durationDays > 5: pts = 10
  if durationDays == 5: pts = 5
  if durationDays < 5: pts = 0

score_3_5 = min(sum of pts, 25)
```

#### 3.6 International Travel (Max: 5)
```
score_3_6 = min(cat3IntlTravel.length * 5, 5)
```

```
CATEGORY_3_TOTAL = min(
  score_3_1 + score_3_2 + score_3_3 + score_3_4 + score_3_5 + score_3_6,
  100
)
```

---

### 4.4 Category 4 — Governance (Max: 50)

#### 4.1 Admin Responsibilities (Max: 40)
```
score_4_1 = min(cat4AdminResp.length * 10, 40)
```

#### 4.2 Student Activities (Max: 10)
```
score_4_2 = min(cat4StudentActivities.length * 5, 10)
```

```
CATEGORY_4_TOTAL = min(score_4_1 + score_4_2, 50)
```

---

### 4.5 Category 5 — Supplementary (Max: 50)

#### 5.1 Memberships (Max: 15)
```
For each membership:
  if status == "national_member":      pts = 5
  if status == "international_member": pts = 10
  if status == "national_executive":   pts = 10

score_5_1 = min(sum of pts, 15)
```

#### 5.2 Awards (Max: 10)
```
For each award:
  if level == "international" || level == "national": pts = 10
  if level == "state": pts = 5

score_5_2 = min(sum of pts, 10)
```

#### 5.3 Differentiators (Max: 20)
```
For each differentiator:
  if role == "participating": pts = 3
  if role == "leading":       pts = 7
  if role == "initiating":    pts = 10

score_5_3 = min(sum of pts, 20)
```

#### 5.4 Internships (Max: 5)
```
score_5_4 = min(cat5Internships.length * 5, 5)
```

```
CATEGORY_5_TOTAL = min(score_5_1 + score_5_2 + score_5_3 + score_5_4, 50)
```

---

### 4.6 Category 6 — Core Values (Max: 50) — HoD fills only
```
CATEGORY_6_TOTAL = min(
  cat6Punctuality + cat6Professionalism + cat6Willingness + cat6Cordiality + cat6Classroom,
  50
)
// Each field: 0-10. HoD/Reviewer enters manually.
```

---

### 4.7 Grand Total
```
SELF_APPRAISAL_TOTAL = CAT1 + CAT2 + CAT3 + CAT4 + CAT5   // max 500
GRAND_TOTAL          = SELF_APPRAISAL_TOTAL + CAT6          // max 550
```

---

## 5. Data Visibility Rules (ENFORCE IN BACKEND — NEVER TRUST FRONTEND)

| Data Field | FACULTY | HOD / REVIEWER | ADMIN |
|-----------|---------|---------------|-------|
| Own appraisal form data | ✅ Full | ✅ Full | ✅ Full |
| Auto-calculated self-appraisal score (Cat 1–5) | ✅ Own only | ✅ All | ✅ All |
| Reviewer-assigned scores (Cat 1–6) | ❌ **NEVER** | ✅ Full | ✅ Full |
| Grand Total | ❌ **NEVER** | ✅ Full | ✅ Full |
| HoD/Reviewer comments | ✅ **Only when status = REVIEWED or APPROVED** | ✅ Full | ✅ Full |
| Other faculty appraisals | ❌ Never | ✅ Own dept only | ✅ All |
| FPGP targets & growth | ✅ Own only | ✅ Assigned dept | ✅ All |
| FPGP reviewer feedback | ✅ Read-only | ✅ Full | ✅ Full |

### API Serialization Rule
Create two serializers in `backend/src/utils/serializers.ts`:
- `serializeSubmissionForFaculty(submission, review)` → strips all score fields from review, includes comments only if status is REVIEWED/APPROVED
- `serializeSubmissionForReviewer(submission, review)` → full data
- `serializeSubmissionForAdmin(submission, review)` → full data

Always call the correct serializer based on `req.user.roles` before sending response.

---

## 6. Submission Lifecycle

```
DRAFT
  │  (faculty fills form, auto-saves)
  ▼
SUBMITTED ──────────────────────────────────────────────────────┐
  │  (faculty clicks Submit)                                     │
  │  (block if submission window closed OR already 4 this year) │
  ▼                                                              │
UNDER_REVIEW                                                     │
  │  (HoD/Reviewer opens and begins reviewing)                  │
  │                                                              │
  ├──► APPROVED                                                  │
  │      Comments unlock for faculty                            │
  │      Category 6 scores saved                                │
  │                                                              │
  └──► REJECTED                                                  │
         Comments unlock for faculty                            │
         Faculty can edit and resubmit ──────────────────────►┘
         (counts as a new submission number, still bounded by 4)

WITHDRAWN  ← faculty can withdraw only when status = SUBMITTED (not yet UNDER_REVIEW)
```

### Business Rules
1. Faculty can have at most **4 submissions per academic year** (enforced at DB with unique constraint + count check).
2. Once `UNDER_REVIEW`, faculty **cannot edit** until status changes to REJECTED.
3. Once `APPROVED`, the submission is **permanently read-only**.
4. Admin can **force-unlock** any submission by resetting status to DRAFT.
5. A submission window is **per academic year** (Admin opens/closes it). Block submissions outside the window.
6. Every status change must be logged in `AuditLog`.

---

## 7. FPGP Module (Faculty Performance Growth Plan)

### 7.1 What It Is
A goal-setting + progress-tracking module. Faculty set targets at the **start of the year**, and the system **auto-calculates progress** by reading data from appraisal submissions submitted throughout the year.

### 7.2 FPGP Lifecycle
```
DRAFT   → Faculty is building the plan, not yet committed
ACTIVE  → Plan is locked. Targets cannot be edited once activated. Progress begins tracking.
REVIEWED → HoD/Reviewer has added feedback on the plan
```

### 7.3 Progress Auto-Calculation
> **Location:** `backend/src/services/fpgpEngine.ts`

When faculty submit an appraisal (`status → SUBMITTED`), trigger `recalculateFPGPProgress(userId, academicYearId)`.

This function:
1. Loads the active `FPGPPlan` for the user + academic year
2. Aggregates all submissions for that user + year (all 4)
3. For each `FPGPTarget`, maps `subSection` to actual data and computes `currentValue`

**SubSection → Data Mapping:**
```
"1.1 Lectures"                → average engagement % across all courses
"1.2 Course Results"          → average pass percentage across all courses
"1.3 Projects Guided"         → total project count across all submissions
"2.1 Journal Publications"    → total journal entries count
"2.1 Conference Papers"       → total conference entries count
"2.2 Citations"               → max citations value (scopus + wos)
"2.4 Patents"                 → total patents count
"2.5 Sponsored Projects"      → total projects count with ONGOING status
"3.2 Organised Programs"      → total organised programs count
"3.3 Resource Person"         → total resource person roles count
"3.5 Training Programs"       → total training programs attended
"3.6 International Travel"    → total international travels count
// Add more mappings as needed
```

4. Upsert `FPGPProgress` records with new `currentValue` and `achievementPct`
5. This triggers re-render of the Growth Dashboard on the frontend

### 7.4 Growth Dashboard Data (API Response)
```typescript
interface FPGPGrowthData {
  plan: FPGPPlan;
  targets: Array<{
    target: FPGPTarget;
    currentValue: number;
    achievementPct: number;
    progressHistory: Array<{       // one entry per submission
      submissionNumber: number;
      submittedAt: Date;
      value: number;
    }>;
    gapToTarget: number;           // targetValue - currentValue
    isAchieved: boolean;
  }>;
  categoryRollup: Array<{          // for radar chart
    category: string;
    avgAchievementPct: number;
  }>;
  submissionTimeline: Array<{      // for timeline chart
    submissionNumber: number;
    submittedAt: Date;
    selfAppraisalScore: number;    // auto-calculated Cat1-5 score
  }>;
  yearOverYear: Array<{            // for historical comparison
    academicYear: string;
    avgAchievementPct: number;
    totalSelfScore: number;
  }>;
  hodFeedback: FPGPReview[];       // read-only for faculty
}
```

---

## 8. API Endpoints

### Auth
```
POST /api/auth/login              Body: { employeeCode, password }
POST /api/auth/logout
POST /api/auth/refresh
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

### User / Profile
```
GET  /api/users/me
PUT  /api/users/me/profile
```

### Admin — User Management
```
GET    /api/admin/users                   Query: ?dept=&role=&search=
POST   /api/admin/users                   Create user
PUT    /api/admin/users/:id
DELETE /api/admin/users/:id               Soft delete (isActive=false)
POST   /api/admin/users/:id/roles         Body: { role, departmentId }
DELETE /api/admin/users/:id/roles/:roleId Revoke role
```

### Admin — Department & Academic Year
```
GET  /api/admin/departments
POST /api/admin/departments
PUT  /api/admin/departments/:id

GET  /api/admin/academic-years
POST /api/admin/academic-years            Create year + open window
PUT  /api/admin/academic-years/:id        Open/close submission window
```

### Appraisals
```
GET  /api/appraisals                      Faculty: own | HoD/Reviewer: dept | Admin: all
                                          Query: ?year=&status=&dept=&userId=
POST /api/appraisals                      Create new draft (checks window + 4/year cap)
GET  /api/appraisals/:id                  Role-gated serialization
PUT  /api/appraisals/:id                  Update draft (block if not DRAFT)
POST /api/appraisals/:id/submit           DRAFT → SUBMITTED
POST /api/appraisals/:id/withdraw         SUBMITTED → WITHDRAWN
GET  /api/appraisals/:id/score            Returns ScoreBreakdown (self-appraisal only for faculty)
```

### Review (HoD + Reviewer)
```
GET  /api/reviews/pending                 List submissions assigned to me
POST /api/appraisals/:id/review           Body: { cat1-6 scores, comments, status: APPROVED|REJECTED }
                                          GUARD: reviewer.userId !== submission.userId
GET  /api/appraisals/:id/review           Full review detail (role-gated, never exposes scores to faculty)
```

### Admin — Force Actions
```
POST /api/admin/appraisals/:id/unlock     Reset to DRAFT
POST /api/admin/appraisals/:id/assign-reviewer   Body: { reviewerId }
```

### FPGP
```
GET  /api/fpgp/me?year=2025-26            Own active plan
POST /api/fpgp                            Create new plan
PUT  /api/fpgp/:id                        Update targets (only if DRAFT)
POST /api/fpgp/:id/activate               DRAFT → ACTIVE (locks targets)
GET  /api/fpgp/:id/growth                 Full growth dashboard data
GET  /api/fpgp/department?year=2025-26    HoD: all dept faculty FPGP summaries
POST /api/fpgp/:id/review                 HoD/Reviewer adds feedback
```

### Reports
```
GET  /api/reports/department?year=&dept=  HoD + Admin
GET  /api/reports/institute?year=         Admin only
GET  /api/reports/export?format=pdf|excel&year=&dept=
```

---

## 9. Middleware Stack

```typescript
// backend/src/middleware/

// 1. auth.ts
// Verifies JWT, attaches req.user = { id, roles: UserRole[] }
export const authenticate = (req, res, next) => { ... }

// 2. roleGuard.ts
// Usage: roleGuard(['HOD', 'ADMIN'])
// Checks req.user.roles contains at least one of the allowed roles
export const roleGuard = (allowedRoles: RoleType[]) => (req, res, next) => { ... }

// 3. submissionOwner.ts
// Ensures faculty can only access their own submissions
export const submissionOwner = (req, res, next) => { ... }

// 4. reviewerGuard.ts
// Ensures reviewer cannot review their own submission
export const reviewerGuard = (req, res, next) => {
  if (submission.userId === req.user.id) {
    return res.status(403).json({ error: "Cannot review your own submission" })
  }
  next()
}

// 5. submissionWindowGuard.ts
// Blocks POST /appraisals if window is closed or 4/year cap reached
export const submissionWindowGuard = (req, res, next) => { ... }
```

---

## 10. Frontend Pages & Components

### Faculty Portal
```
/login                          Login page

/dashboard                      Submission history cards, FPGP summary widget,
                                 current year status, upcoming deadline banner

/appraisal/new                  Multi-step form:
                                  Step 1: Part I (Personal Info / Leave Details)
                                  Step 2: Category 1 (Teaching)
                                    - Tab 1.1: Courses (dynamic table rows)
                                    - Tab 1.2: Projects
                                    - Tab 1.3: e-Content + ICT
                                  Step 3: Category 2 (Research)
                                    - Tab 2.1: Journals / Conferences / Book Chapters
                                    - Tab 2.2: Books + Citations
                                    - Tab 2.3: Patents + Projects
                                    - Tab 2.4: Consultancy + Guidance + Groups
                                  Step 4: Category 3 (Faculty Development)
                                  Step 5: Category 4 (Governance)
                                  Step 6: Category 5 (Supplementary)
                                  Step 7: Preview + Score Summary + Submit

/appraisal/:id                  Read-only view. Shows comments if REVIEWED/APPROVED.
                                 Score summary shown (self-appraisal only, never HoD scores).

/fpgp                           FPGP landing: active plan + growth dashboard
/fpgp/set-targets               Target setting form (only editable if DRAFT)
/fpgp/growth                    Growth dashboard:
                                  - Radar chart (category-wise achievement %)
                                  - Progress bars (per target: planned vs actual)
                                  - Sparklines (per target over 4 submissions)
                                  - Submission timeline (score trend)
                                  - Year-over-year comparison
                                  - HoD feedback section (read-only)

/profile                        Personal info editor
```

### HoD / Reviewer Portal
```
/dashboard                      Pending reviews count, dept FPGP overview

/reviews                        Table: submitted appraisals pending review
                                 Filters: department, academic year, faculty name

/reviews/:submissionId          Review page:
                                  - Full appraisal data (read-only left panel)
                                  - Auto-calculated self-score visible
                                  - Category 6 scoring inputs (10 each)
                                  - Comment fields per category
                                  - Overall comment
                                  - Approve / Reject buttons

/fpgp/department                All dept faculty FPGP summaries, click to view individual
/fpgp/:fpgpId/review            View faculty's targets + add FPGP feedback

/reports/department             Department score distribution, charts, export
```

### Admin Portal
```
/admin/dashboard                Institute stats, submission status overview

/admin/users                    User list + search/filter
/admin/users/new                Create user form
/admin/users/:id                Edit user, assign/revoke Reviewer role

/admin/departments              List + create departments

/admin/academic-years           List years, open/close submission windows
/admin/academic-years/new       Create new academic year

/admin/appraisals               All appraisals (filter by dept/year/status)
/admin/appraisals/:id           Full view + force-unlock + reassign reviewer

/admin/fpgp                     Institute-wide FPGP overview

/admin/reports                  Export PDF/Excel, rank lists, category analytics
```

---

## 11. Environment Variables

```env
# backend/.env
DATABASE_URL=postgresql://user:password@localhost:5432/faculty_appraisal
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_SECRET=your-refresh-secret
REFRESH_TOKEN_EXPIRES_IN=7d
PORT=5000
UPLOAD_DIR=./uploads
FRONTEND_URL=http://localhost:5173

# frontend/.env
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## 12. Seed Data (for development)

Create `backend/prisma/seed.ts` that generates:
- 1 Admin user (employeeCode: `ADMIN001`, password: `admin123`)
- 3 Departments: CSE, ECE, EEE
- 1 HoD per department
- 5 Faculty per department
- 2 Reviewer roles (faculty elevated to reviewers)
- 1 Academic year: `2025-26` with submission window open
- Sample appraisal submissions in various states

---

## 13. Key Implementation Notes for Claude Code

1. **Scoring engine is called server-side only.** Never trust client-submitted scores. Always recompute on the backend.
2. **Use Prisma transactions** when changing submission status + creating AuditLog entry — they must be atomic.
3. **FPGP recalculation** is triggered automatically when a submission status changes to `SUBMITTED`. Put it in the submission service, not in a controller.
4. **Score fields in `AppraisalReview`** must NEVER appear in any API response going to a faculty user. Use serializers, not just `select` in Prisma — be explicit.
5. **Comments are null until reviewed** — the frontend should show a "pending review" placeholder when `review.overallComment` is null or submission status is not REVIEWED/APPROVED.
6. **Multi-step form state** — use React Hook Form with Zod validation per step. Store draft data in local state and auto-save to backend as DRAFT on step navigation.
7. **Role checks are layered** — check in middleware (route level) AND in service (data level). Never rely on just one.
8. **The 4-submissions-per-year cap** is enforced by the `@@unique([userId, academicYearId, submissionNumber])` constraint plus a count check in the service before insert.
9. **All dynamic table rows** in the appraisal form (courses, publications, patents, etc.) use `useFieldArray` from React Hook Form.
10. **FPGP Growth Dashboard** fetches `/api/fpgp/:id/growth` which returns pre-aggregated data. Do not compute trends on the frontend.
```
