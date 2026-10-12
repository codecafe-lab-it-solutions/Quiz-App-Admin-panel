import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";

const questionIdParamSchema = z.object({ questionId: z.coerce.number().int().positive() });

// Removes one question (its options/formula cascade). The questions POST
// endpoint is create/update only - it never deletes - so the web panel's old
// "re-post the remaining questions" approach silently left the question in
// place; this is the real delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; questionId: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse({ id: params.id });
    const { questionId } = questionIdParamSchema.parse({ questionId: params.questionId });

    const quiz = await loadAccessibleQuiz(user, quizId);
    if (quiz.status === "live" || quiz.status === "completed") {
      throw new ApiError(400, "Cannot edit questions on a live or completed quiz");
    }

    const question = await prisma.question.findFirst({ where: { id: questionId, quizId } });
    if (!question) throw new ApiError(404, "Question not found");

    const remainingCount = await prisma.$transaction(async (tx) => {
      await tx.question.delete({ where: { id: questionId } });

      // Keep orderIndex gapless so the editor's "next index" (= question
      // count) never collides with an existing question after a delete.
      const remaining = await tx.question.findMany({
        where: { quizId },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: { id: true, orderIndex: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].orderIndex !== i) {
          await tx.question.update({ where: { id: remaining[i].id }, data: { orderIndex: i } });
        }
      }

      // Same convention as the questions POST: total marks follows the sum
      // of the questions that remain (left untouched when none are left).
      const totalMarks = await tx.question.aggregate({ where: { quizId }, _sum: { marks: true } });
      if (totalMarks._sum.marks != null) {
        await tx.quiz.update({ where: { id: quizId }, data: { totalMarks: totalMarks._sum.marks } });
      }
      return remaining.length;
    });

    return ok({ message: "Question removed", remainingCount });
  } catch (error) {
    return handleApiError(error);
  }
}
