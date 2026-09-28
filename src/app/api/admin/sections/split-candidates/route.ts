import { NextRequest } from "next/server";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { splitCandidatesQuerySchema } from "@/lib/validators/mapping";
import { getExistingSectionsForCourse } from "@/lib/legacy-db";
import { getStudentsForRealSections } from "@/lib/section-sync";
import { getCurrentSubList } from "@/lib/config";

// Every real section this course is currently split across, each with its
// live roster - the "Split Existing Sections" flow's student picker. Rosters
// come from the same getStudentsForRealSections check the faculty-facing
// "View Students" roster uses, so who shows up here to be picked matches
// exactly who a faculty can currently see for that section.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const { subCode } = splitCandidatesQuerySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const subList = await getCurrentSubList();
    const sections = await getExistingSectionsForCourse(subCode, subList);

    const items = await Promise.all(
      sections.map(async (s) => ({
        section: s.section,
        facRoll: s.facRoll,
        facultyName: s.facultyName,
        students: await getStudentsForRealSections(s.facRoll, subCode, subList, [s.section]),
      })),
    );

    return ok({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
