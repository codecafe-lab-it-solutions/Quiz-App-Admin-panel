import { NextRequest } from "next/server";
import { ok, created, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { sectionCreateSchema } from "@/lib/validators/directory";
import {
  getAllSections,
  createFacultyCourseMapping,
  bulkRegisterStudentsForSection,
  getRealMajors,
  resolveMajorFromBranch,
} from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";
import { addSectionToStudents } from "@/lib/section-sync";

// Section-first view: GET lists every real section for the current cycle
// (grouped isr_sub_available_tbl.section values). POST creates a section -
// which, since a section has no identity of its own, means creating the
// faculty/course/branch/sem mapping row that resolves to it (same write
// Faculty <-> Course mapping does) - and then bulk-registers every real
// student in that major+sem into the course, so the section arrives with its
// real membership already allotted instead of needing each student added
// one at a time.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const currentSubList = await getCurrentSubList();
    const items = await getAllSections(currentSubList);

    return ok({ items, currentSubList });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const body = sectionCreateSchema.parse(await req.json());
    const major = resolveMajorFromBranch(body.branch, await getRealMajors());
    const currentSubList = await getCurrentSubList();

    const mapping = await createFacultyCourseMapping({
      facRoll: body.facRoll,
      subCode: body.subCode,
      branch: body.branch,
      sem: body.sem,
      major,
      subList: currentSubList,
    });

    const allotment = await bulkRegisterStudentsForSection({
      subCode: body.subCode,
      subList: currentSubList,
      rolls: body.rolls,
    });

    // Record membership on the student rows themselves - the roster check
    // (getStudentsForRealSections) reads isr_stu_main_tbl.section, so without
    // this the new section would show no students.
    const sectionName = `${major}_${body.sem}`;
    await addSectionToStudents(body.rolls, sectionName);

    return created({ mapping, allotment });
  } catch (error) {
    return handleApiError(error);
  }
}
