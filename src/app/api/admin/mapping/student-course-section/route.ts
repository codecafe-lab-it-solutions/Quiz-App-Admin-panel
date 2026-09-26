import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, created, fail, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { studentCourseMappingQuerySchema } from "@/lib/validators/mapping";
import { studentCourseMappingCreateSchema } from "@/lib/validators/directory";
import { paginationMeta } from "@/lib/validators/common";
import {
  getStudentByRoll,
  getStudentCourses,
  getCourseRegistrationsPaged,
  getCourseRegistrationsForRolls,
  getRecentRegistrations,
  getBatchRegistrations,
  getBatchRegistrationsPaged,
  createStudentCourseMapping,
} from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";
import { fillEmptyStudentSection } from "@/lib/section-sync";

// Paginates an already-fetched, size-bounded array (bounded by a real roll
// set - a section's membership - not by an unbounded DB scan) - used for the
// branches where the underlying data is already small enough to fetch in
// full, so a real DB-level LIMIT/OFFSET isn't needed to keep this cheap.
function paginateArray<T>(items: T[], page: number, pageSize: number): { items: T[]; total: number } {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total };
}

// A section name is always Major_Semester (e.g. "PE_3") - split back into
// its two real isr_stu_main_tbl columns to resolve membership live.
function parseSectionName(name: string): { major: string; semNow: number } | null {
  const idx = name.indexOf("_");
  if (idx < 0) return null;
  const major = name.slice(0, idx);
  const sem = Number(name.slice(idx + 1));
  if (!major || !Number.isFinite(sem)) return null;
  return { major, semNow: sem };
}

// Sourced live from the legacy per-batch isr_reg_<batch>_tbl tables. GET
// never returns an unfiltered dump - a roll/course code search, or a
// batch/section browse filter, keeps every branch bounded to a small number
// of specific batch tables instead of fanning out across all ~60 at once.
// POST writes a new registration row into the table for the student's batch.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const parsed = studentCourseMappingQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return fail(400, "Provide either roll or courseCode to search");
    }
    const { roll, courseCode, batch, sectionName, page, pageSize } = parsed.data;
    const subList = await getCurrentSubList();

    // Section browse filter - resolves once, reused by both the courseCode
    // branch (as a post-filter) and the batch/section browse branch (as the
    // roll scope for whichever batch tables those members are actually in).
    const parsedSection = sectionName ? parseSectionName(sectionName) : null;
    const sectionRolls = parsedSection
      ? new Set(
          (
            await prisma.isrStuMainTbl.findMany({
              where: { major: parsedSection.major, semNow: parsedSection.semNow },
              select: { roll: true },
            })
          ).map((r) => r.roll),
        )
      : null;

    // A student's Section column is derived live from their own real Major +
    // Semester (isr_stu_main_tbl) - the same value on every row for that
    // student, since there's no per-course section concept anymore.
    const attachSections = async <T extends { roll: string; subCode: string }>(items: T[]) => {
      const studentRolls = [...new Set(items.map((item) => item.roll))];
      if (studentRolls.length === 0) {
        return items.map((item) => ({ ...item, sections: [] as { name: string }[], major: null, semNow: null }));
      }

      const studentInfoRows = await prisma.isrStuMainTbl.findMany({
        where: { roll: { in: studentRolls } },
        select: { roll: true, major: true, semNow: true },
      });
      const infoByRoll = new Map(studentInfoRows.map((s) => [s.roll, s]));

      return items.map((item) => {
        const info = infoByRoll.get(item.roll);
        const name = info ? `${info.major}_${info.semNow}` : null;
        return {
          ...item,
          sections: name ? [{ name }] : [],
          major: info?.major ?? null,
          semNow: info?.semNow != null ? String(info.semNow) : null,
        };
      });
    };

    if (roll) {
      const student = await getStudentByRoll(roll);
      if (!student || !student.batch) {
        return ok({ items: [], isDefault: false, meta: paginationMeta(0, 1, pageSize) });
      }
      const courses = await getStudentCourses(roll, student.batch, subList);
      const rows = courses.map((c) => ({
        roll: c.roll,
        subCode: c.subCode,
        batch: student.batch,
      }));
      // One student's own course list - naturally small, no real pagination
      // need, but still paginated over for a consistent response shape.
      const { items, total } = paginateArray(rows, page, pageSize);
      return ok({ items: await attachSections(items), isDefault: false, meta: paginationMeta(total, page, pageSize) });
    }

    if (courseCode && sectionRolls) {
      // Course + section together - bounded by the section's own membership
      // (already known and small), so resolve per-member batch and query
      // just those tables directly rather than scanning every active batch
      // table for the course and filtering client-side.
      let items = await getCourseRegistrationsForRolls(courseCode, subList, [...sectionRolls]);
      if (batch) items = items.filter((i) => i.batch === batch);
      const paged = paginateArray(items, page, pageSize);
      return ok({ items: await attachSections(paged.items), isDefault: false, meta: paginationMeta(paged.total, page, pageSize) });
    }

    if (courseCode) {
      // Course browse, optionally narrowed to one batch - real DB-level
      // LIMIT/OFFSET across whichever batch table(s) apply, with a total
      // count, instead of scanning every active table unbounded.
      const { items, total } = await getCourseRegistrationsPaged(courseCode, subList, { batch, page, pageSize });
      return ok({ items: await attachSections(items), isDefault: false, meta: paginationMeta(total, page, pageSize) });
    }

    // Browse mode - a batch and/or section picked from a dropdown, with no
    // exact roll/course code typed. Each branch below only ever queries the
    // specific batch table(s) those choices actually point at, never all ~60.
    if (batch && sectionRolls) {
      const rows = await getBatchRegistrations(batch, subList, { rolls: [...sectionRolls] });
      const items = rows.map((r) => ({ ...r, batch }));
      const paged = paginateArray(items, page, pageSize);
      return ok({ items: await attachSections(paged.items), isDefault: false, meta: paginationMeta(paged.total, page, pageSize) });
    }

    if (batch) {
      const { items: rows, total } = await getBatchRegistrationsPaged(batch, subList, { page, pageSize });
      const items = rows.map((r) => ({ ...r, batch }));
      return ok({ items: await attachSections(items), isDefault: false, meta: paginationMeta(total, page, pageSize) });
    }

    if (sectionRolls) {
      // No batch chosen - resolve each section member's real batch so only
      // the handful of batch tables its members actually belong to get hit.
      // Bounded by section membership size, so fetched in full then paged.
      const members = await prisma.isrStuMainTbl.findMany({
        where: { roll: { in: [...sectionRolls] } },
        select: { roll: true, batch: true },
      });
      const rollsByBatch = new Map<string, string[]>();
      for (const m of members) {
        if (!m.batch) continue;
        const list = rollsByBatch.get(m.batch) ?? [];
        list.push(m.roll);
        rollsByBatch.set(m.batch, list);
      }
      const items: { roll: string; subCode: string; batch: string }[] = [];
      for (const [b, rolls] of rollsByBatch) {
        const rows = await getBatchRegistrations(b, subList, { rolls });
        items.push(...rows.map((r) => ({ ...r, batch: b })));
      }
      const paged = paginateArray(items, page, pageSize);
      return ok({ items: await attachSections(paged.items), isDefault: false, meta: paginationMeta(paged.total, page, pageSize) });
    }

    // No search or filter yet - show a bounded "recently registered" default
    // list (see getRecentRegistrations) so the page reads as live and
    // connected rather than blank. Intentionally a fixed-size preview, not a
    // real paginated browse - pick a filter above to actually page through data.
    const recent = await getRecentRegistrations(subList, 20);
    return ok({ items: await attachSections(recent), isDefault: true, meta: paginationMeta(recent.length, 1, recent.length || 1) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const body = studentCourseMappingCreateSchema.parse(await req.json());
    const subList = await getCurrentSubList();
    const mapping = await createStudentCourseMapping({ ...body, subList });
    // A student with no section yet would never appear in any roster; give
    // them one if it can be resolved unambiguously (never overwrites).
    await fillEmptyStudentSection(body.roll, subList);

    return created(mapping);
  } catch (error) {
    return handleApiError(error);
  }
}
