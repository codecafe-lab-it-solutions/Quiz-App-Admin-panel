import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { paginationSchema, paginationMeta } from "@/lib/validators/common";
import { getFacultyNamesByRolls } from "@/lib/legacy-db";

export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const params = Object.fromEntries(req.nextUrl.searchParams);
    const { page, pageSize } = paginationSchema.parse(params);
    const status = params.status as
      | "draft"
      | "scheduled"
      | "live"
      | "completed"
      | undefined;

    const studentRoll = String(user.sub);
    const where = {
      deletedAt: null,
      allotments: { some: { studentRoll } },
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.quiz.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startTime: "desc" },
        include: {
          building: {
            select: {
              id: true,
              name: true,
              latitude: true,
              longitude: true,
              radiusMeters: true,
            },
          },
          allotments: { where: { studentRoll }, select: { status: true, isProxy: true } },
          attempts: { where: { studentRoll }, select: { status: true } },
        },
      }),
      prisma.quiz.count({ where }),
    ]);

    const facultyNames = await getFacultyNamesByRolls(
      items.map((q) => q.facultyRoll),
    );

    const shaped = items.map((q) => ({
      ...q,
      faculty: {
        roll: q.facultyRoll,
        name: facultyNames.get(q.facultyRoll) ?? q.facultyRoll,
      },
      myAllotmentStatus: q.allotments[0]?.status ?? "allotted",
      myIsProxy: q.allotments[0]?.isProxy ?? false,
      myAttemptStatus: q.attempts[0]?.status ?? null,
      allotments: undefined,
      attempts: undefined,
    }));

    return ok({ items: shaped, meta: paginationMeta(total, page, pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}
