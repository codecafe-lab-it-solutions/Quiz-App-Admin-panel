import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { assertQuizControlAllowed, getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";
import { stopLiveQuiz } from "@/lib/quiz-stop";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    // Stopping a quiz is a faculty action (from the mobile app, on their own
    // quiz) or an admin override; students can never stop one.
    requireRole(user, "faculty", "admin");
    assertQuizControlAllowed(req, user);

    const { id } = idParamSchema.parse(params);
    await loadAccessibleQuiz(user, id);
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) throw new ApiError(404, "Quiz not found");
    if (quiz.status !== "live") throw new ApiError(400, "Only a live quiz can be stopped");

    await stopLiveQuiz(id, "quiz_stopped_by_faculty");

    const updated = await prisma.quiz.findUnique({ where: { id } });
    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
