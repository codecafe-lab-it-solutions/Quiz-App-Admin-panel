import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCourseRegistrations, getRealMajors, resolveMajorFromBranch, getStudentNamesByRolls } from "@/lib/legacy-db";

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

/**
 * Live candidate students for a faculty's course across the given real
 * section names. Resolves each section name back to its real branch row in
 * isr_sub_available_tbl, derives the real major from branch, and uses
 * isr_stu_main_tbl by major to scope which department a registrant has
 * to belong to - the actual inclusion test is a real registration row for
 * this exact (subCode, subList) in the student's own isr_reg_<batch>_tbl (see
 * getCourseRegistrations). A student with no registration row anywhere is
 * excluded, full stop - no "batch has no table, so keep them anyway"
 * fallback. Faculty -> course -> section -> student must all be real,
 * verified mappings, never an inferred default-include.
 *
 * Also cross-checked against isr_stu_main_tbl.sem_now, but NOT with a blind
 * equality - two real sections can share a major with different sem (e.g.
 * CE_3 and CE_5 both teaching the same subCode under different faculty), and
 * without this check a registrant of the OTHER section used to leak into
 * this one just for sharing the major. So: a registrant is kept if their
 * sem_now matches one of THIS section's own sem values, OR - the deliberate
 * backlog/repeat carve-out (confirmed against RF0240/PE312/C2 - 2 of 58 real
 * registrants sit at sem_now=4 despite being registered for a sem-5
 * subject) - if their sem_now doesn't match ANY real section that exists for
 * this exact course+major, meaning there's nowhere else for them to
 * legitimately belong. Only excluded when their sem_now points at a
 * *different* real section of this same course+major - that's the case
 * where they're actually enrolled elsewhere.
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

  const registrations = await getCourseRegistrations(subCode, subList);
  const registeredRolls = new Set(registrations.map((r) => r.roll));
  if (registeredRolls.size === 0) return [];

  const realMajors = await getRealMajors();
  const majors = new Set(rows.map((row) => resolveMajorFromBranch(row.branch ?? "", realMajors)));
  const targetSems = new Set(rows.map((row) => row.sem).filter((sem): sem is number => sem != null));

  // Every real section (any faculty) for this exact course, so a registrant
  // whose own sem_now points at a *different* one of them can be told apart
  // from one who only vaguely shares a major with this section.
  const allCourseSectionRows = await prisma.isrSubAvailableTbl.findMany({
    where: { subCode, subList, section: { not: null } },
  });
  const otherSemsByMajor = new Map<string, Set<number>>();
  for (const row of allCourseSectionRows) {
    if (row.sem == null) continue;
    const major = resolveMajorFromBranch(row.branch ?? "", realMajors);
    if (!otherSemsByMajor.has(major)) otherSemsByMajor.set(major, new Set());
    otherSemsByMajor.get(major)!.add(row.sem);
  }

  const students = await prisma.isrStuMainTbl.findMany({
    where: { major: { in: [...majors] }, roll: { in: [...registeredRolls] } },
    select: { roll: true, major: true, semNow: true },
  });
  const rolls = new Set(
    students
      .filter((s) => targetSems.has(s.semNow) || !otherSemsByMajor.get(s.major)?.has(s.semNow))
      .map((s) => s.roll)
  );

  const names = await getStudentNamesByRolls([...rolls]);
  return [...rolls]
    .map((roll) => ({ roll, name: names.get(roll) ?? roll }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
