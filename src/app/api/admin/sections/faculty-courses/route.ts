import { NextRequest } from "next/server";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { facultyCoursesQuerySchema } from "@/lib/validators/mapping";
import { getFacultyCourseCatalog } from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";

// Course dropdown for the "Split Existing Sections" flow - only courses the
// picked faculty already has a real isr_sub_available_tbl row for, since
// splitting a section only makes sense for a course they're already involved
// with.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const { facRoll } = facultyCoursesQuerySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const subList = await getCurrentSubList();
    const entries = await getFacultyCourseCatalog(facRoll, subList);

    const seen = new Set<string>();
    const items = entries
      .filter((e) => (seen.has(e.subCode) ? false : (seen.add(e.subCode), true)))
      .map((e) => ({ code: e.subCode, title: e.title ?? e.subCode }));

    return ok({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
