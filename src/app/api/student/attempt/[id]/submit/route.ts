import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { submitAttemptSchema } from "@/lib/validators/attempt";
import { idParamSchema } from "@/lib/validators/common";
import { finalizeAttempt, scoreAttemptAnswers } from "@/lib/attempt-scoring";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const { id: attemptId } = idParamSchema.parse(params);
    const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.studentRoll !== String(user.sub)) throw new ApiError(404, "Attempt not found");
    if (attempt.status !== "in_progress") throw new ApiError(400, "This attempt has already been submitted");

    const body = submitAttemptSchema.parse(await req.json());

    const quiz = await prisma.quiz.findUnique({ where: { id: attempt.quizId } });
    if (!quiz) throw new ApiError(404, "Quiz not found");

    const orderedIds: number[] = attempt.questionOrder ? JSON.parse(attempt.questionOrder) : [];

    const [questions, options, formulas, existingAnswers] = await Promise.all([
      prisma.question.findMany({ where: { id: { in: orderedIds } } }),
      prisma.questionOption.findMany({ where: { questionId: { in: orderedIds } } }),
      prisma.questionFormula.findMany({ where: { questionId: { in: orderedIds } } }),
      prisma.studentAnswer.findMany({ where: { attemptId } }),
    ]);

    const { scoredAnswers, totalMarksObtained } = scoreAttemptAnswers({
      orderedIds,
      questions,
      options,
      formulas,
      existingAnswers,
      negativeMarking: quiz.negativeMarking,
    });

    const percentage = quiz.totalMarks > 0 ? (totalMarksObtained / quiz.totalMarks) * 100 : 0;
    const submittedAt = new Date();
    const status = body.autoSubmitted ? "auto_submitted" : "submitted";

    await prisma.$transaction((tx) =>
      finalizeAttempt(tx, {
        attemptId,
        quiz,
        studentRoll: String(user.sub),
        status,
        endTime: submittedAt,
        autoSubmitReason: body.autoSubmitted ? body.reason ?? "auto_submitted" : null,
        scoredAnswers,
        totalMarksObtained,
      }),
      // One upsert per question - leave room beyond Prisma's 5s default so a
      // slow DB round-trip can't roll a long paper's submit back.
      { timeout: 30000, maxWait: 10000 },
    );

    return ok({
      attemptId,
      status,
      marksObtained: totalMarksObtained,
      totalMarks: quiz.totalMarks,
      percentage,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
