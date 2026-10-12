import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";

// Single-action result publish (2026-08-10 MOM collapsed the prior
// pending -> declared -> published pipeline to one step): computes each
// attempt's marks, blocks on any ungraded subjective answer (previously
// declare-result's gate), and writes straight to "published" - visible to
// students immediately, no separate declare step.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse(params);
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz || (user.role === "faculty" && quiz.facultyRoll !== String(user.sub))) throw new ApiError(404, "Quiz not found");
    if (quiz.status !== "completed") throw new ApiError(400, "Results can only be published for a completed quiz");

    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId, status: { in: ["submitted", "auto_submitted"] } },
      include: { answers: { include: { question: { select: { questionType: true } } } } },
    });

    const ungradedCount = attempts.reduce(
      (sum, a) => sum + a.answers.filter((ans) => ans.question.questionType === "subjective" && !ans.isSkipped && !ans.manuallyGraded).length,
      0
    );
    if (ungradedCount > 0) {
      throw new ApiError(400, `${ungradedCount} subjective answer(s) still need manual grading before results can be published`);
    }

    // Students the faculty marked present by hand have no attempt - they get a
    // published result of 0 marks (a student who also has a real attempt is
    // handled by the attempt path below).
    const attemptedRolls = new Set(attempts.map((a) => a.studentRoll));
    const manualRolls = (
      await prisma.attendance.findMany({
        where: { quizId, markedByFaculty: true },
        select: { studentRoll: true },
      })
    )
      .map((m) => m.studentRoll)
      .filter((roll) => !attemptedRolls.has(roll));

    if (attempts.length === 0 && manualRolls.length === 0) {
      throw new ApiError(400, "No submitted attempts to publish results for");
    }

    const publishedAt = new Date();

    const results = await prisma.$transaction([
      ...attempts.map((attempt) => {
        const marksObtained = attempt.answers.reduce((sum, a) => sum + a.marksObtained, 0);
        const percentage = quiz.totalMarks > 0 ? (marksObtained / quiz.totalMarks) * 100 : 0;

        return prisma.result.upsert({
          where: { quizId_studentRoll: { quizId, studentRoll: attempt.studentRoll } },
          update: { marksObtained, percentage, status: "published", declaredAt: publishedAt, publishedAt },
          create: {
            quizId,
            studentRoll: attempt.studentRoll,
            marksObtained,
            percentage,
            status: "published",
            declaredAt: publishedAt,
            publishedAt,
          },
        });
      }),
      ...manualRolls.map((studentRoll) =>
        prisma.result.upsert({
          where: { quizId_studentRoll: { quizId, studentRoll } },
          update: { marksObtained: 0, percentage: 0, status: "published", declaredAt: publishedAt, publishedAt },
          create: {
            quizId,
            studentRoll,
            marksObtained: 0,
            percentage: 0,
            status: "published",
            declaredAt: publishedAt,
            publishedAt,
          },
        }),
      ),
    ]);

    return ok({ publishedCount: results.length, manualPresentCount: manualRolls.length, results });
  } catch (error) {
    return handleApiError(error);
  }
}
