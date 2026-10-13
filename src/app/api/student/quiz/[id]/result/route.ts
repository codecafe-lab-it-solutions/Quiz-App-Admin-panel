import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { renderMathInHtml } from "@/lib/math-html";

// Full result detail for one completed quiz, looked up by quizId - this is
// what the app calls when a student taps a completed quiz from their quiz
// list (which only has quizId, not attemptId). Same payload shape as
// GET /api/student/attempt/[id]/result, just keyed differently.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const { id: quizId } = idParamSchema.parse(params);
    const studentRoll = String(user.sub);

    const attempt = await prisma.quizAttempt.findUnique({
      where: { quizId_studentRoll: { quizId, studentRoll } },
    });
    if (!attempt) throw new ApiError(404, "You did not attempt this quiz");
    if (attempt.status === "in_progress") throw new ApiError(400, "This attempt has not been submitted yet");

    const [quiz, result] = await Promise.all([
      prisma.quiz.findUnique({ where: { id: quizId }, select: { title: true, totalMarks: true } }),
      prisma.result.findUnique({
        where: { quizId_studentRoll: { quizId, studentRoll } },
      }),
    ]);
    if (!quiz) throw new ApiError(404, "Quiz not found");
    // Correct answers stay hidden until the faculty has explicitly published
    // results - declaring alone (status "declared") is not enough.
    if (!result || result.status !== "published") {
      throw new ApiError(403, "Results for this quiz have not been published yet");
    }

    const orderedIds: number[] = attempt.questionOrder ? JSON.parse(attempt.questionOrder) : [];

    const [questions, options, formulas, answers] = await Promise.all([
      prisma.question.findMany({ where: { id: { in: orderedIds } } }),
      prisma.questionOption.findMany({ where: { questionId: { in: orderedIds } } }),
      prisma.questionFormula.findMany({ where: { questionId: { in: orderedIds } } }),
      prisma.studentAnswer.findMany({ where: { attemptId: attempt.id } }),
    ]);

    const questionById = new Map(questions.map((q) => [q.id, q]));
    const optionsByQuestion = new Map<number, typeof options>();
    for (const opt of options) {
      const list = optionsByQuestion.get(opt.questionId) ?? [];
      list.push(opt);
      optionsByQuestion.set(opt.questionId, list);
    }
    const formulaByQuestion = new Map(formulas.map((f) => [f.questionId, f]));
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

    const questionResults = orderedIds
      .map((qid, orderIndex) => {
        const question = questionById.get(qid);
        if (!question) return null;
        const answer = answerByQuestion.get(qid);

        return {
          id: question.id,
          questionText: renderMathInHtml(question.questionText),
          questionType: question.questionType,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
          orderIndex,
          options:
            question.questionType === "mcq"
              ? (optionsByQuestion.get(qid) ?? []).map((o) => ({
                  id: o.id,
                  optionText: renderMathInHtml(o.optionText),
                  isCorrect: o.isCorrect,
                }))
              : undefined,
          correctValue: question.questionType === "formula" ? formulaByQuestion.get(qid)?.correctValue ?? null : undefined,
          tolerance: question.questionType === "formula" ? formulaByQuestion.get(qid)?.tolerance ?? null : undefined,
          yourAnswer: {
            selectedOptionId: answer?.selectedOptionId ?? null,
            answerValue: answer?.answerValue ?? null,
            writtenAnswer: answer?.writtenAnswer ?? null,
            isSkipped: answer?.isSkipped ?? true,
          },
          isCorrect: answer?.isCorrect ?? null,
          marksObtained: answer?.marksObtained ?? 0,
          // Subjective only - whether a faculty member has graded it yet.
          manuallyGraded: answer?.manuallyGraded ?? false,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null);

    const unattemptedCount = questionResults.filter((q) => q.yourAnswer.isSkipped).length;
    const correctCount = questionResults.filter((q) => q.isCorrect === true).length;
    const incorrectCount = questionResults.filter((q) => q.isCorrect === false).length;

    return ok({
      attemptId: attempt.id,
      quizId,
      quizTitle: quiz.title,
      status: attempt.status,
      totalMarks: quiz.totalMarks,
      marksObtained: result.marksObtained,
      percentage: result.percentage,
      publishedAt: result.publishedAt,
      summary: {
        totalQuestions: questionResults.length,
        correctCount,
        incorrectCount,
        unattemptedCount,
      },
      questions: questionResults,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
