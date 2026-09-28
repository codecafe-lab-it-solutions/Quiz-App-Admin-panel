import { NextRequest } from "next/server";
import { created, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { sectionSplitSchema } from "@/lib/validators/directory";
import { createSplitSectionMapping } from "@/lib/legacy-db";
import { moveStudentsBetweenSections } from "@/lib/section-sync";
import { getCurrentSubList } from "@/lib/config";

// "Split Existing Sections" flow: creates one new isr_sub_available_tbl row
// for the new section (see createSplitSectionMapping - deliberately not the
// same path Create Section's branch/semester flow uses), then moves exactly
// the picked students out of whichever existing section each was picked from
// and into the new one (moveStudentsBetweenSections - the first removal path
// for isr_stu_main_tbl.section).
export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const body = sectionSplitSchema.parse(await req.json());
    const subList = await getCurrentSubList();

    const mapping = await createSplitSectionMapping({
      facRoll: body.facRoll,
      subCode: body.subCode,
      subList,
      sectionName: body.sectionName,
    });

    const moveResult = await moveStudentsBetweenSections(
      body.moves,
      body.sectionName,
      body.subCode,
      subList,
    );

    return created({ mapping, moveResult });
  } catch (error) {
    return handleApiError(error);
  }
}
