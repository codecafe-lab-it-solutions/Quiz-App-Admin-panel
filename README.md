# RGIPT LMS (Quiz & Attendance)

A Next.js (App Router) + MySQL + Prisma application providing a full Admin Panel and the complete
Authentication / Admin / Faculty / Student REST API surface for a quiz-based attendance system.
Faculty and Student web/mobile clients are out of scope for this pass — only their APIs are built.

**Faculty and Student master data, and Faculty↔Course / Student↔Course mapping, are not owned by
this app.** They're read live from an existing university legacy database (the `isr_*` tables) —
see "Legacy database integration" below before touching anything under `src/lib/legacy-db.ts` or
the Faculty/Students/Mapping admin screens.

## Tech stack

- Next.js 14 (App Router) + TypeScript
- MySQL via Prisma ORM
- JWT auth (access + refresh) with custom middleware — no NextAuth
- Tailwind CSS + shadcn/ui-style components
- Zod for request and form validation
- SheetJS (`xlsx`) for report Excel export
- `jspdf` + `jspdf-autotable` for PDF export
- Recharts-ready dashboard (KPI cards, live tracking board)
- bcryptjs for password hashing

## Getting started

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL and JWT secrets
npx prisma migrate dev    # creates the MySQL schema
npx prisma db seed        # creates the super-admin login
npm run dev
```

The app runs at `http://localhost:3000`. The admin panel is at `/login` → `/admin/dashboard`.

`prisma migrate dev` also creates the five legacy `isr_*` tables (via `CREATE TABLE IF NOT EXISTS`,
best-guess structure — see "Legacy database integration" below) if they don't already exist, so a
fresh local setup has somewhere to query even before real data is imported. Faculty/Student login
will simply return no matches until `isr_login_tbl` etc. are populated with real (or seeded) rows.

### Seed admin login

`prisma/seed.ts` creates one super-admin account using `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from your `.env` (defaults to `admin@example.com` / `ChangeMe123!` if unset). Change the password
after first login — there's no self-service reset flow in this pass, use Settings → Admin Users,
or another super-admin account, to rotate it.

## Legacy database integration

Faculty/Student identity and course mapping come from six tables owned by an external university
system, read live via Prisma (never written to by this app except the admin-CRUD/status paths noted
below):

| Table | Purpose |
|---|---|
| `isr_login_tbl` | Credentials (both faculty and student), keyed by `user_roll`, `user_type` = `FAC`/`STU`, `status` = 1-Active/2-Inactive (gates login, admin-toggleable) |
| `isr_faculty_tbl` | Faculty name + profile (`dept`, `emp_code`, `fac_status`, `address`), keyed by `roll` |
| `isr_stu_data_tbl` | Student name + `mobile`, keyed by `stu_roll` |
| `isr_stu_main_tbl` | Student `major`/`batch`/`sem_now`/`reg_status`/`attn_ok`/`stu_status`, keyed by `roll` |
| `isr_sub_available_tbl` | Faculty↔course mapping, filtered by the admin-configurable "current" `sub_list` (Settings → Semester Config) |
| `isr_curriculum_tbl` | Course catalog (title, credits, branch) — resolves a bare `sub_code` into the human-readable course info the faculty Course List / roster screens display |
| `isr_reg_<batch>_tbl` | Student↔course registration, one physical table per batch — **only** queried through the `BatchTableRegistry` allow-list (Settings → Semester Config), never by building a table name from user input. Columns: `stu_roll`, `sub_code`, `sub_list` — every read/write is scoped to the current `sub_list` |

All access is centralized in `src/lib/legacy-db.ts` — every query is one small exported function, so
a column-name correction is a one-file fix. One thing remains explicitly unconfirmed and flagged
with `// TODO` at its point of use:

- **Password hash scheme** in `isr_login_tbl.user_password` — `verifyLegacyPassword()` currently
  assumes bcrypt. If real logins fail, this is the first thing to check.

`isr_reg_<batch>_tbl`'s roll column is confirmed as `stu_roll` (not `roll`, unlike every other
`isr_*` table) and every row carries `sub_list`, so `getStudentCourses`/`getCourseRegistrations`/
`createStudentCourseMapping` all take an explicit `subList` parameter now instead of reading
unscoped.

The **"section"** concept referenced in the original spec has no confirmed legacy source yet —
`sectionId` is nullable everywhere in the quiz-domain schema and the UI only renders it where data
exists, marked `// TODO: section source pending confirmation`.

`SemesterConfig` (single-row `current_sub_list`) and `BatchTableRegistry` (batch → physical table
allow-list) are the only two tables this app owns for the integration — everything else under
`isr_*` is read-only.

## Environment variables

See `.env.example`:

- `DATABASE_URL` — MySQL connection string
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — sign/verify secrets, use long random values in production
- `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` — token lifetimes (default 15m / 7d)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — used only by the seed script
- `NEXT_PUBLIC_APP_URL` — base URL, reserved for future use in generated report links

## Project layout

```
prisma/               schema.prisma, seed.ts
src/app/(auth)/login   Single login page (admin-only redirect for now)
src/app/admin/         Admin panel screens (dashboard, faculty, students, mapping,
                        master-data, reports, settings incl. Semester Config)
src/app/api/auth/      Login/refresh/logout for admin, faculty, student (faculty/student
                        authenticate against the legacy isr_login_tbl, see below)
src/app/api/admin/     Admin REST API (read-only faculty/students/mapping, master-data CRUD,
                        semester config, reports)
src/app/api/faculty/   Faculty REST API (quiz lifecycle, questions, allotment, results)
src/app/api/student/   Student REST API (quiz discovery, geofence, attempt, anti-cheat, results)
src/components/ui/     shadcn-style primitives (button, dialog, table, select, ...)
src/components/admin/  Admin-panel-specific composites (DataTable, FilterBar, MapPicker, ...)
src/lib/                db client, auth/JWT helpers, legacy-db.ts (all legacy-table reads),
                        config.ts (semester config helpers), geofence math, excel/pdf builders,
                        zod validators, standard API response wrapper
src/middleware.ts       Edge-safe JWT verification gating /admin/*, /api/admin/*, /api/faculty/*,
                        /api/student/*
postman_collection.json Importable Postman collection covering every endpoint below
```

## Authentication model

- Access tokens (15m) and refresh tokens (7d) are signed JWTs carrying `{ sub, role, email, name }`
  (`adminRole` too for admins). `sub` is a numeric id for admins, and the legacy `roll` string for
  faculty/student. Passwords are hashed with bcrypt (cost 10) for admin; faculty/student passwords
  are verified against the legacy hash via `verifyLegacyPassword()` (scheme unconfirmed, see
  "Legacy database integration").
- On admin login, the refresh token is also stored **hashed** against the `admins` row so `logout`
  can invalidate it and `refresh` can verify the presented token still matches the latest issued
  one. Faculty/student have no app-owned row to persist this on (their identity lives in the
  read-only legacy tables), so their sessions rely on JWT expiry rather than server-side revocation.
- Login/refresh responses return both tokens in the JSON body (for mobile/API clients that attach
  `Authorization: Bearer <token>`) **and** set them as httpOnly cookies (so the web admin panel
  works via `credentials: 'include'` without manual token plumbing). Either channel is accepted by
  every protected route.
- `middleware.ts` runs on the Edge runtime (via `jose`, since `jsonwebtoken` needs Node crypto) and
  gates `/admin/*` pages plus `/api/admin/*`, `/api/faculty/*`, `/api/student/*` routes by role
  prefix, redirecting unauthenticated page requests to `/login` and returning 401/403 JSON for API
  requests. Every API route additionally re-verifies the token itself via `lib/auth.ts` — the
  middleware check is defense-in-depth, not the only enforcement layer.

## Business rules implemented

1. **Geofencing** — `lib/geofence.ts` computes haversine distance. `geofence-check` logs every
   check to `geofence_logs`. `start-attempt` **independently re-verifies** distance server-side
   (never trusts a prior client-reported "within range" result) and rejects if outside the
   building's `radiusMeters`.
2. **Randomized question order** — persisted once per attempt as a JSON array on
   `quiz_attempts.questionOrder` at `start-attempt` time, so refetching `GET
   /api/student/attempt/:id/questions` always returns the same order for that attempt.
3. **Anti-cheat** — `anti-cheat-event` logs the violation to `anti_cheat_events` and responds with
   an explicit `{ action: "force_submit", autoSubmitReason }` instruction; the client is expected
   to immediately call `submit` with `autoSubmitted: true`.
4. **Scoring** — computed at `submit` time: MCQ compares `selectedOptionId` against the option
   flagged `isCorrect`; formula compares `|answerValue - correctValue| <= tolerance`. Negative
   marking applies `negativeMarks` only when the quiz has it enabled and the answer was attempted
   and wrong; skipped/unanswered questions always score 0. `declare-result` aggregates the
   already-scored `student_answers` into `results`; `publish-result` flips `declared → published`.
5. **Attendance auto-marking** — `submit` upserts an `attendance` row as `present` for that
   student/course/quiz/date. `stop` (when a faculty ends a live quiz) backfills `absent` rows for
   every allotted student who never started an attempt.

## Dual question types (Objective + Subjective) and Admin+Faculty quiz creation

- **`Question.questionType`** is `mcq` | `formula` | `subjective`. `subjective` questions have no
  options and are never auto-scored — `Question.referenceAnswer` is an optional grading guide (never
  sent to students, see `GET /api/student/attempt/:id/questions`), and `StudentAnswer.writtenAnswer` /
  `manuallyGraded` track the student's free-text response and whether a faculty member has scored it.
- **Manual grading**: `GET /api/faculty/quiz/:id/subjective-answers` lists every subjective answer for
  a completed quiz (ungraded first); `PATCH .../subjective-answers/:answerId` records
  `{ marksAwarded }`, clamped to the question's max marks. `POST .../declare-result` now **rejects**
  declaring results while any non-skipped subjective answer is still ungraded.
- **Bulk import** (`POST /api/faculty/quiz/:id/questions/import`) branches per-row on a `Type` column
  (`OBJECTIVE`/`SUBJECTIVE`, defaults to `OBJECTIVE` if blank) — `SUBJECTIVE` rows may leave
  Option A–D/Answer blank. The template (`GET /api/faculty/questions/import-template`) includes one
  example row of each type.
- **Admin can create/manage quizzes on a faculty member's behalf.** `middleware.ts` lets an `admin`
  JWT reach `/api/faculty/*` (student routes remain student-only — an admin token has no legacy roll,
  so letting it touch student-keyed attempt data would silently corrupt those rows). Every
  quiz/question/allotment/grading route now calls `requireRole(user, "faculty", "admin")` plus a
  shared `loadAccessibleQuiz()`/`resolveFacultyRoll()` helper (`src/lib/quiz-access.ts`): a faculty
  member is restricted to quizzes they own, an admin can reach any quiz and must pass an explicit
  `facultyRoll` when *creating* one (there's no ownership to infer from an admin's numeric id).
- **UI**: there was no faculty-facing quiz-management UI before this update (only the API + Postman
  collection existed) — `/faculty/quizzes/new` → `/faculty/quizzes/:id` (and the admin mirror,
  `/admin/tests` → `/admin/tests/new` → `/admin/tests/:id`) are new pages built for this pass, sharing
  `QuizCreateForm`/`QuizManagement`/`QuestionEditorDialog` in `src/components/quiz/`. The create form
  only lists courses that already have a matching app-owned `Course` row (`courseId` non-null from
  `GET /api/faculty/courses`) — Quiz still foreign-keys to the app-owned course catalog, so a course
  that only exists in the legacy catalog needs an admin to add it under Master Data → Courses first.
  `description`/`instructions` quiz fields mentioned in prior briefs were never added to the `Quiz`
  model and are intentionally not in this form (out of this update's scope).

## Design decisions / assumptions (not fully specified in the brief)

- **IDs**: auto-incrementing integers for every app-owned table. Faculty/Student are the exception —
  they're keyed by the legacy `roll` string throughout (quiz/attempt/attendance/result FKs are plain
  `String` columns, not Prisma relations, since those tables aren't under this app's control).
- **Faculty/Student directory CRUD writes into the legacy tables** at the admin's explicit request
  (create/update/delete + activate/deactivate login via `isr_login_tbl.status`). This is a
  deliberate, narrower exception to "legacy tables are read-only" — every write goes through the
  small set of functions in `legacy-db.ts` (never raw SQL from a route), roll is immutable once
  created, and email/roll uniqueness is checked against `isr_login_tbl` before every write. Admin
  Users and master data (departments/courses/sessions/sections/buildings) remain full CRUD and are
  hard-deleted since nothing depends on an empty one; Prisma will surface a 409/400 if you try to
  delete a referenced row.
- **Course catalog**: `Course`/`Department` remain app-owned tables (Quiz/Section/Attendance all
  foreign-key to them), but they're no longer the source of truth for course metadata — the faculty
  Course List (`GET /api/faculty/courses`) and roster (`GET /api/faculty/courses/:code/students`)
  read live from `isr_sub_available_tbl` joined against `isr_curriculum_tbl`, so title/credits/branch
  are always the real legacy values instead of manually re-entered admin data. This is the fix for
  the original panel's "Prog/Dept always blank" gap.
- **Login activation**: `isr_login_tbl.status` (1-Active, 2-Inactive) gates both faculty and student
  login (`403` on a deactivated account) and is toggled via `PATCH /api/admin/{faculty,students}/:roll/status`.
- **Violations**: `GET /api/admin/violations` returns anti-cheat events and rejected geofence checks
  as two separate arrays (`antiCheatEvents`, `geofenceViolations`) rather than a single merged feed,
  since they come from different tables with different shapes.
- **Bulk question import**: `POST /api/faculty/quiz/:id/questions/import` accepts a multipart
  `.xlsx`/`.csv` upload (field name `file`) matching the template from
  `GET /api/faculty/questions/import-template`, and returns a per-row `added`/`skipped` status with
  a reason — duplicate questions (by exact text, case-insensitive) and invalid rows are skipped, not
  rejected outright, so one bad row doesn't fail the whole import.
- **Dashboard summary endpoint**: added `GET /api/admin/dashboard/summary` (not explicitly listed
  in the spec) to serve the four KPI cards efficiently via aggregate queries instead of pulling
  full paginated lists client-side.
- **Faculty quiz creation is scoped** to courses the faculty is actually mapped to in
  `isr_sub_available_tbl` for the current `sub_list` (Settings → Semester Config), returning 403
  otherwise. Section is no longer part of this check — no legacy source for section exists yet.
- **Quiz allotment modes**: `POST /api/faculty/quiz/:id/allot` takes `{ mode: "course" | "custom" }`
  — `"course"` allots every student registered for the quiz's course (via the legacy per-batch
  registration tables), `"custom"` takes an explicit `studentRolls: string[]`. (This replaces the
  previous `"section"` mode and numeric `studentIds`, since section-based mapping is no longer
  app-owned.)
- **Building geofence picker**: no external maps/tiles provider is wired in (would need an API key
  and outbound network access); `MapPicker` is a self-contained SVG lat/long + draggable-radius
  widget as allowed by the brief ("can be stubbed with an interactive lat/long input").

## API documentation

Import `postman_collection.json` into Postman. It covers every endpoint in the brief (Auth, Admin,
Faculty, Student) with example bodies and `{{baseUrl}}` / `{{accessToken}}` variables — set
`accessToken` after calling a login request (Postman won't auto-read httpOnly cookies, so for
Postman testing pass the token explicitly as a Bearer header; the collection's collection-level
auth already does this from the `accessToken` variable).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm start` — production build/serve
- `npm run db:migrate` — `prisma migrate dev`
- `npm run db:seed` — `prisma db seed`
- `npm run db:studio` — Prisma Studio
