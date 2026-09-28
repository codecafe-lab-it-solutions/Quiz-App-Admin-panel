import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCourseRegistrations, getRealMajors, resolveMajorFromBranch, getStudentCourses, getStudentNamesByRolls } from "@/lib/legacy-db";

// Exact-match WHERE clause for a single section name inside a comma-joined
// Quiz.sectionNames column (e.g. "PE_3,PE_5") - a plain `contains` would
// wrongly match "PE_3" against a stored "PE_30" or "XPE_3". Spread the result
// into a Quiz/Attendance-scoped-to-quiz where object (Prisma's OR only exists
// at the where-clause level, not inside a scalar field filter).
export function sectionNameWhere(name: string): { OR: { sectionNames: Prisma.StringFilter }[] } {
  return {
    OR: [
      { sectionNames: { equals: name } },
      { sectionNames: { startsWith: `${name},` } },
      { sectionNames: { endsWith: `,${name}` } },
      { sectionNames: { contains: `,${name},` } },
    ],
  };
}

export interface RealFacultySectionOption {
  name: string;
  branch: string | null;
  sem: string | null;
}

/**
 * Real per-branch sections a faculty teaches a given course under, for the
 * Create/Edit Quiz section picker - sourced directly from
 * isr_sub_available_tbl.section (a real legacy column) on every call. This is
 * the only source of section identity in the app now (2026-08-18 removal of
 * the app-owned Section/SectionCourse/SectionFaculty/SectionStudent tables) -
 * a section is just a name string, never a row with its own id.
 */
export async function getRealSectionsForFacultyCourse(
  facultyRoll: string,
  subCode: string,
  subList: string
): Promise<RealFacultySectionOption[]> {
  const rows = await prisma.isrSubAvailableTbl.findMany({
    where: { facRoll: facultyRoll, subCode, subList },
  });

  const results: RealFacultySectionOption[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.section || seen.has(row.section)) continue;
    seen.add(row.section);
    results.push({ name: row.section, branch: row.branch, sem: row.sem != null ? String(row.sem) : null });
  }
  return results;
}

// isr_stu_main_tbl.section is a comma-joined list of every section the
// student belongs to (e.g. "PE_5,PE_T"), maintained by this app.
export function parseSectionList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Single on/off switch for a student who belongs to more than one section:
// false (default) shows them under every faculty whose section they're in,
// true hides them from all View Students / allotment rosters.
function hideMultiSectionStudents(): boolean {
  return process.env.HIDE_MULTI_SECTION_STUDENTS === "true";
}

// Pure filter behind getStudentsForRealSections (kept separate so it can be
// checked without a database).
export function selectRosterRolls(args: {
  students: { roll: string; major: string; semNow: number; section: string | null }[];
  facultySections: Set<string>;
  courseSectionRows: { subCode: string | null; section: string | null; branch: string | null; sem: number | null }[];
  subCode: string;
  realMajors: Set<string>;
  hideMulti: boolean;
}): string[] {
  const { students, facultySections, courseSectionRows, subCode, realMajors, hideMulti } = args;
  return students
    .filter((s) => {
      const sections = parseSectionList(s.section);
      if (sections.length === 0) {
        const derived = pickSectionFromRegistrations(courseSectionRows, s, new Set([subCode]), realMajors);
        return derived != null && facultySections.has(derived);
      }
      if (hideMulti && sections.length > 1) return false;
      return sections.some((name) => facultySections.has(name));
    })
    .map((s) => s.roll);
}

/**
 * Students a faculty may see for a course + section(s). A student is shown
 * only if ALL of these hold:
 *  1. Faculty -> course -> section: a real isr_sub_available_tbl row for this
 *     faculty, course, sub_list and one of the given section names.
 *  2. Student -> course: a real registration row for this exact
 *     (subCode, subList) in the student's isr_reg_<batch>_tbl.
 *  3. Student -> section: one of the sections in isr_stu_main_tbl.section
 *     exactly equals the faculty's section. A student whose section column is
 *     still empty (legacy data not yet backfilled) falls back to the one
 *     section their own registrations unambiguously resolve to
 *     (pickSectionFromRegistrations) - and is left out if that's ambiguous, so
 *     an empty column can never leak a student into a section they may not be
 *     in. scripts/backfill-student-sections.ts fills the column for good.
 *  4. If HIDE_MULTI_SECTION_STUDENTS=true, a student in more than one
 *     section is not shown at all.
 * Any failed check excludes the student - nothing is included by default.
 */
export async function getStudentsForRealSections(
  facultyRoll: string,
  subCode: string,
  subList: string,
  sectionNames: string[]
): Promise<{ roll: string; name: string }[]> {
  if (sectionNames.length === 0) return [];

  const rows = await prisma.isrSubAvailableTbl.findMany({
    where: { facRoll: facultyRoll, subCode, subList, section: { in: sectionNames } },
  });
  if (rows.length === 0) return [];
  const facultySections = new Set(rows.map((row) => row.section!));

  const registrations = await getCourseRegistrations(subCode, subList);
  const registeredRolls = [...new Set(registrations.map((r) => r.roll))];
  if (registeredRolls.length === 0) return [];

  const students = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: registeredRolls } },
    select: { roll: true, major: true, semNow: true, section: true },
  });

  // Only needed for students whose section column is still empty.
  const needsFallback = students.some((s) => parseSectionList(s.section).length === 0);
  const courseSectionRows = needsFallback
    ? await prisma.isrSubAvailableTbl.findMany({
        where: { subCode, subList, section: { not: null } },
        select: { subCode: true, section: true, branch: true, sem: true },
      })
    : [];
  const realMajors = needsFallback ? await getRealMajors() : new Set<string>();

  const rolls = selectRosterRolls({
    students,
    facultySections,
    courseSectionRows,
    subCode,
    realMajors,
    hideMulti: hideMultiSectionStudents(),
  });

  const names = await getStudentNamesByRolls(rolls);
  return rolls
    .map((roll) => ({ roll, name: names.get(roll) ?? roll }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Appends a section name to each student's isr_stu_main_tbl.section list
 * (no-op for a student who already has it). Called whenever students are
 * added to a section so the roster check above can see them.
 */
export async function addSectionToStudents(rolls: string[], sectionName: string): Promise<number> {
  if (rolls.length === 0) return 0;
  const students = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: rolls } },
    select: { roll: true, section: true },
  });

  let updated = 0;
  for (const s of students) {
    const sections = parseSectionList(s.section);
    if (sections.includes(sectionName)) continue;
    await prisma.isrStuMainTbl.update({
      where: { roll: s.roll },
      data: { section: [...sections, sectionName].join(",") },
    });
    updated++;
  }
  return updated;
}

export interface SectionMoveResult {
  movedCount: number;
  keptBothCount: number;
  skipped: { roll: string; reason: string }[];
}

/**
 * Moves each given student from their old section tag to a new one (the
 * "Split Existing Sections" flow) - the first removal path for
 * isr_stu_main_tbl.section, alongside addSectionToStudents' append-only one.
 * A student whose old section name is also used by a DIFFERENT course they're
 * registered in keeps that old tag (removing it would silently break their
 * roster visibility for that other course) and just gains the new tag too -
 * reported back as "kept both" rather than a clean move, so the admin knows
 * the old faculty may still see them there for that other course.
 */
export async function moveStudentsBetweenSections(
  moves: { roll: string; fromSection: string }[],
  toSection: string,
  subCode: string,
  subList: string
): Promise<SectionMoveResult> {
  const byRoll = new Map(moves.map((m) => [m.roll, m.fromSection]));
  if (byRoll.size === 0) return { movedCount: 0, keptBothCount: 0, skipped: [] };

  const students = await prisma.isrStuMainTbl.findMany({
    where: { roll: { in: [...byRoll.keys()] } },
    select: { roll: true, batch: true, section: true },
  });

  // Other real mapping rows this cycle sharing one of the fromSection names
  // but for a DIFFERENT course - used below to decide whether stripping a
  // student's old tag is actually safe, or would silently break their roster
  // for that other course.
  const fromSectionNames = [...new Set(byRoll.values())];
  const otherCourseRows = await prisma.isrSubAvailableTbl.findMany({
    where: { subList, section: { in: fromSectionNames }, subCode: { not: subCode } },
    select: { section: true, subCode: true },
  });
  const otherCoursesBySection = new Map<string, Set<string>>();
  for (const row of otherCourseRows) {
    if (!row.section || !row.subCode) continue;
    const set = otherCoursesBySection.get(row.section) ?? new Set<string>();
    set.add(row.subCode);
    otherCoursesBySection.set(row.section, set);
  }

  let movedCount = 0;
  let keptBothCount = 0;
  const skipped: { roll: string; reason: string }[] = [];

  for (const student of students) {
    const fromSection = byRoll.get(student.roll)!;
    const sections = parseSectionList(student.section);
    if (!sections.includes(fromSection)) {
      skipped.push({ roll: student.roll, reason: `not currently in section "${fromSection}"` });
      continue;
    }

    const otherCourses = otherCoursesBySection.get(fromSection);
    let stillNeedsOldTag = false;
    if (otherCourses && otherCourses.size > 0 && student.batch) {
      const registeredCodes = new Set(
        (await getStudentCourses(student.roll, student.batch, subList)).map((c) => c.subCode),
      );
      stillNeedsOldTag = [...otherCourses].some((code) => registeredCodes.has(code));
    }

    const next = stillNeedsOldTag ? sections : sections.filter((s) => s !== fromSection);
    if (!next.includes(toSection)) next.push(toSection);

    await prisma.isrStuMainTbl.update({
      where: { roll: student.roll },
      data: { section: next.join(",") },
    });

    if (stillNeedsOldTag) keptBothCount++;
    else movedCount++;
  }

  const foundRolls = new Set(students.map((s) => s.roll));
  for (const roll of byRoll.keys()) {
    if (!foundRolls.has(roll)) skipped.push({ roll, reason: "student not found" });
  }

  return { movedCount, keptBothCount, skipped };
}

/**
 * Best-effort section for a student whose section column is empty, worked out
 * from the courses they're actually registered for matched against
 * isr_sub_available_tbl (rows preloaded by the caller for the current
 * sub_list): sections of those courses in the student's own major, preferring
 * ones at the student's current semester. Returns null when nothing matches or
 * the answer is ambiguous (e.g. two section names share this major+sem) - a
 * person has to decide those, we never guess.
 */
export function pickSectionFromRegistrations(
  subAvailableRows: { subCode: string | null; section: string | null; branch: string | null; sem: number | null }[],
  student: { major: string; semNow: number },
  registeredSubCodes: Set<string>,
  realMajors: Set<string>
): string | null {
  const inMajor = subAvailableRows.filter(
    (r) =>
      r.section &&
      r.subCode &&
      registeredSubCodes.has(r.subCode) &&
      resolveMajorFromBranch(r.branch ?? "", realMajors) === student.major
  );
  const sameSem = inMajor.filter((r) => r.sem === student.semNow);
  const names = new Set((sameSem.length > 0 ? sameSem : inMajor).map((r) => r.section!));
  return names.size === 1 ? [...names][0] : null;
}

/**
 * For one student just registered into a course (individual Student <-> Course
 * mapping): if they have no section yet, resolve one via
 * pickSectionFromRegistrations and store it. Never touches a section that's
 * already set. Returns the section that was stored, or null.
 */
export async function fillEmptyStudentSection(roll: string, subList: string): Promise<string | null> {
  const student = await prisma.isrStuMainTbl.findUnique({
    where: { roll },
    select: { roll: true, major: true, semNow: true, batch: true, section: true },
  });
  if (!student || parseSectionList(student.section).length > 0) return null;

  const registered = new Set((await getStudentCourses(roll, student.batch, subList)).map((c) => c.subCode));
  if (registered.size === 0) return null;

  const subAvailableRows = await prisma.isrSubAvailableTbl.findMany({
    where: { subList, subCode: { in: [...registered] }, section: { not: null } },
  });
  const section = pickSectionFromRegistrations(subAvailableRows, student, registered, await getRealMajors());
  if (!section) return null;

  await prisma.isrStuMainTbl.updateMany({
    where: { roll, OR: [{ section: null }, { section: "" }] },
    data: { section },
  });
  return section;
}
