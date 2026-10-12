import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { getStudentNamesByRolls } from "@/lib/legacy-db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse(params);
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, deletedAt: null },
    });
    if (
      !quiz ||
      (user.role === "faculty" && quiz.facultyRoll !== String(user.sub))
    )
      throw new ApiError(404, "Quiz not found");

    const allotments = await prisma.quizAllotment.findMany({
      where: { quizId },
      orderBy: { studentRoll: "asc" },
    });

    const names = await getStudentNamesByRolls(
      allotments.map((a) => a.studentRoll),
    );

    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId },
      select: {
        studentRoll: true,
        status: true,
        startTime: true,
        endTime: true,
        autoSubmitted: true,
      },
    });
    const attemptByStudent = new Map(attempts.map((a) => [a.studentRoll, a]));

    const manualMarks = await prisma.attendance.findMany({
      where: { quizId, markedByFaculty: true },
      select: { studentRoll: true, markedByRoll: true, markedAt: true },
    });
    const manualByStudent = new Map(manualMarks.map((m) => [m.studentRoll, m]));

    const attempted = [];
    const notAttempted = [];
    const proxy = [];
    const markedPresent = [];

    for (const allotment of allotments) {
      const attempt = attemptByStudent.get(allotment.studentRoll);
      const entry = {
        student: {
          roll: allotment.studentRoll,
          name: names.get(allotment.studentRoll) ?? allotment.studentRoll,
        },
        allotmentStatus: allotment.status,
        isProxy: allotment.isProxy,
        bypassLocation: allotment.bypassLocation,
        markedPresentByFaculty: manualByStudent.has(allotment.studentRoll),
        markedBy: manualByStudent.get(allotment.studentRoll)?.markedByRoll ?? null,
        markedAt: manualByStudent.get(allotment.studentRoll)?.markedAt ?? null,
        attempt: attempt ?? null,
      };
      if (attempt) attempted.push(entry);
      else notAttempted.push(entry);
      // Proxy students also stay in attempted/notAttempted above (existing
      // shape, unchanged) - `proxy` is the separate list on top of that.
      if (allotment.isProxy) proxy.push(entry);
      // Students the faculty marked present by hand (device problem) - 0 marks.
      if (entry.markedPresentByFaculty) markedPresent.push(entry);
    }

    return ok({
      totalAllotted: allotments.length,
      attemptedCount: attempted.length,
      notAttemptedCount: notAttempted.length,
      proxyCount: proxy.length,
      markedPresentCount: markedPresent.length,
      markedPresent,
      attempted,
      notAttempted,
      proxy,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
