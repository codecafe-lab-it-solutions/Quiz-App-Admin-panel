import { NextRequest } from "next/server";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { sectionStudentsQuerySchema } from "@/lib/validators/mapping";
import { getSectionStudents } from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";

// Full roster for one section - backs the Sections page's "Students" count
// once clicked, same membership resolution the count itself uses
// (getAllSections), so what's shown here always matches that number.
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "admin");

    const { section } = sectionStudentsQuerySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams)
    );
    const subList = await getCurrentSubList();
    const items = await getSectionStudents(section, subList);

    return ok({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
