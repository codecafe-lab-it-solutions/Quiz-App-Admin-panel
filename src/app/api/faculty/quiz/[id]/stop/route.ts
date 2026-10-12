import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { assertQuizControlAllowed, getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";
import { finalizeAttempt, scoreAttemptAnswers } from "@/lib/attempt-scoring";

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

    const stopTime = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.quiz.update({
        where: { id },
        data: { status: "completed", actualStopTime: stopTime },
      });

      // Auto-submit every attempt still in progress using its current saved
      // answers, before anyone still "allotted" is marked absent below -
      // otherwise a student who started but hadn't submitted yet would fall
      // through and get wrongly marked absent, losing their attempt.
      const inProgressAttempts = await tx.quizAttempt.findMany({
        where: { quizId: id, status: "in_progress" },
      });

      if (inProgressAttempts.length > 0) {
        const orderedIdsByAttempt = new Map(
          inProgressAttempts.map((a) => [a.id, (a.questionOrder ? JSON.parse(a.questionOrder) : []) as number[]]),
        );
        const allQuestionIds = [...new Set([...orderedIdsByAttempt.values()].flat())];

        const [questions, options, formulas, answers] = await Promise.all([
          tx.question.findMany({ where: { id: { in: allQuestionIds } } }),
          tx.questionOption.findMany({ where: { questionId: { in: allQuestionIds } } }),
          tx.questionFormula.findMany({ where: { questionId: { in: allQuestionIds } } }),
          tx.studentAnswer.findMany({ where: { attemptId: { in: inProgressAttempts.map((a) => a.id) } } }),
        ]);

        const answersByAttempt = new Map<number, typeof answers>();
        for (const a of answers) {
          const list = answersByAttempt.get(a.attemptId) ?? [];
          list.push(a);
          answersByAttempt.set(a.attemptId, list);
        }

        for (const attempt of inProgressAttempts) {
          const { scoredAnswers, totalMarksObtained } = scoreAttemptAnswers({
            orderedIds: orderedIdsByAttempt.get(attempt.id) ?? [],
            questions,
            options,
            formulas,
            existingAnswers: answersByAttempt.get(attempt.id) ?? [],
            negativeMarking: quiz.negativeMarking,
          });

          await finalizeAttempt(tx, {
            attemptId: attempt.id,
            quiz,
            studentRoll: attempt.studentRoll,
            status: "auto_submitted",
            endTime: stopTime,
            autoSubmitReason: "quiz_stopped_by_faculty",
            scoredAnswers,
            totalMarksObtained,
          });
        }
      }

      const unattempted = await tx.quizAllotment.findMany({
        where: { quizId: id, status: "allotted" },
        select: { studentRoll: true },
      });

      if (unattempted.length > 0) {
        await tx.quizAllotment.updateMany({
          where: { quizId: id, status: "allotted" },
          data: { status: "absent" },
        });

        for (const { studentRoll } of unattempted) {
          await tx.attendance.upsert({
            where: { studentRoll_quizId: { studentRoll, quizId: id } },
            update: { status: "absent" },
            create: {
              studentRoll,
              courseCode: quiz.courseCode,
              courseName: quiz.courseName,
              quizId: id,
              date: quiz.startTime,
              status: "absent",
            },
          });
        }
      }
      // Scoring every in-progress attempt (one upsert per answer) for a full
      // class easily outlasts Prisma's 5s default interactive-transaction
      // limit, which rolled the whole stop back and left the quiz live.
    }, { timeout: 120000, maxWait: 10000 });

    const updated = await prisma.quiz.findUnique({ where: { id } });
    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
