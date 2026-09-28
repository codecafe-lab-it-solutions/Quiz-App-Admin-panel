import { NextRequest } from "next/server";
import { created, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { sectionSplitSchema } from "@/lib/validators/directory";
import { ensureSectionNameAvailable, createSectionMappingRow } from "@/lib/legacy-db";
import { moveStudentsBetweenSections } from "@/lib/section-sync";
import { getCurrentSubList } from "@/lib/config";

// "Split Existing Sections" flow: one new section, mapped to one or more
// courses at once (the same "one section name, several course rows" shape
// every other section already has - see getAllSections). The section name is
// checked available exactly once for the whole submission, then for each
// course: one new isr_sub_available_tbl row is created, and exactly the
// picked students are moved out of whichever existing section each was
// picked from and into the new one (moveStudentsBetweenSections - scoped per
// course, since which OTHER courses a student's old section tag is still
// needed for depends on the course being split).
export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const body = sectionSplitSchema.parse(await req.json());
    const subList = await getCurrentSubList();

    await ensureSectionNameAvailable(body.sectionName, subList);

    const results = [];
    for (const course of body.courses) {
      const mapping = await createSectionMappingRow({
        facRoll: body.facRoll,
        subCode: course.subCode,
        subList,
        sectionName: body.sectionName,
      });
      const moveResult = await moveStudentsBetweenSections(
        course.moves,
        body.sectionName,
        course.subCode,
        subList,
      );
      results.push({ subCode: course.subCode, mapping, moveResult });
    }

    return created({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
