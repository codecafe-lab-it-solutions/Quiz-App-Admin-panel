import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { assertQuizControlAllowed, getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    // Starting a quiz is a faculty action (from the mobile app, on their own
    // quiz) or an admin override; students can never start one.
    requireRole(user, "faculty", "admin");
    assertQuizControlAllowed(req, user);

    const { id } = idParamSchema.parse(params);
    await loadAccessibleQuiz(user, id);
    const quiz = await prisma.quiz.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { questions: true } } },
    });
    if (!quiz) throw new ApiError(404, "Quiz not found");

    if (quiz.status === "live") throw new ApiError(400, "Quiz is already live");
    if (quiz.status === "completed")
      throw new ApiError(400, "A completed quiz cannot be restarted");
    if (quiz._count.questions === 0)
      throw new ApiError(
        400,
        "Add at least one question before starting the quiz",
      );

    const allottedCount = await prisma.quizAllotment.count({
      where: { quizId: id },
    });
    if (allottedCount === 0)
      throw new ApiError(400, "Allot the quiz to students before starting it");

    const updated = await prisma.quiz.update({
      where: { id },
      data: { status: "live", actualStartTime: new Date() },
    });

    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
