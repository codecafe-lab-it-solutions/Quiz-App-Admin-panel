import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { quizUpdateSchema } from "@/lib/validators/quiz";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";
import { getCourseTitleByCode } from "@/lib/legacy-db";
import { getCurrentSubList } from "@/lib/config";
import { getRealSectionsForFacultyCourse } from "@/lib/section-sync";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id } = idParamSchema.parse(params);
    await loadAccessibleQuiz(user, id);

    const quiz = await prisma.quiz.findFirst({
      where: { id, deletedAt: null },
      include: {
        building: true,
        questions: {
          orderBy: { orderIndex: "asc" },
          include: { options: true, formula: true },
        },
        _count: { select: { allotments: true } },
      },
    });

    return ok(quiz);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id } = idParamSchema.parse(params);
    const existing = await loadAccessibleQuiz(user, id);

    if (existing.status === "completed") {
      throw new ApiError(400, "A completed quiz cannot be edited");
    }

    const { sectionNames, courseCode, ...rest } = quizUpdateSchema.parse(await req.json());

    // Faculty reassignment is an admin-only action (2026-08-10 MOM) - a
    // faculty member reassigning their own quiz away isn't part of this
    // request, so it's blocked here rather than left to the UI to hide.
    if (rest.facultyRoll !== undefined) {
      if (user.role !== "admin") {
        throw new ApiError(403, "Only an admin can reassign a quiz to another faculty member");
      }
      const faculty = await prisma.isrFacultyTbl.findUnique({ where: { roll: rest.facultyRoll } });
      if (!faculty) throw new ApiError(404, "No faculty found for this roll number");
    }

    // Create enforces end > start in the schema, but a PATCH carries fields
    // independently - check the resulting pair so an edit can't leave a quiz
    // ending before it starts.
    const effectiveStart = rest.startTime ?? existing.startTime;
    const effectiveEnd = rest.endTime ?? existing.endTime;
    if ((rest.startTime || rest.endTime) && effectiveEnd <= effectiveStart) {
      throw new ApiError(400, "End time must be after start time", { endTime: ["End time must be after start time"] });
    }

    const facultyRoll = rest.facultyRoll ?? existing.facultyRoll;
    const effectiveCourseCode = courseCode ?? existing.courseCode;
    const subList = await getCurrentSubList();

    let courseName: string | undefined;
    if (courseCode) {
      courseName = await getCourseTitleByCode(courseCode, subList);
    }

    if (sectionNames) {
      const validSections = await getRealSectionsForFacultyCourse(facultyRoll, effectiveCourseCode, subList);
      const validNames = new Set(validSections.map((s) => s.name));
      if (sectionNames.some((name) => !validNames.has(name))) {
        throw new ApiError(404, "One or more selected sections were not found");
      }
    }

    const quiz = await prisma.quiz.update({
      where: { id },
      data: {
        ...rest,
        ...(courseCode ? { courseCode, courseName } : {}),
        ...(sectionNames ? { sectionNames: sectionNames.join(",") } : {}),
      },
    });

    return ok(quiz);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id } = idParamSchema.parse(params);
    const existing = await loadAccessibleQuiz(user, id);

    if (existing.status === "live") {
      throw new ApiError(400, "A live quiz cannot be deleted. Stop it first.");
    }

    await prisma.quiz.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return ok({ message: "Quiz deleted" });
  } catch (error) {
    return handleApiError(error);
  }
}
