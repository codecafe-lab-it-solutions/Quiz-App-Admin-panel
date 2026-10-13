import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
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

      // Absent = still "allotted" AND never opened the quiz. A student who has
      // any attempt row is never marked absent here: they either just got
      // finalized above or started during this stop and will submit their own
      // attempt - overwriting that with "absent" is what showed students who
      // had submitted as absent after the faculty ended the quiz.
      const [allottedRows, attemptRows] = await Promise.all([
        tx.quizAllotment.findMany({ where: { quizId: id, status: "allotted" }, select: { studentRoll: true } }),
        tx.quizAttempt.findMany({ where: { quizId: id }, select: { studentRoll: true } }),
      ]);
      const hasAttempt = new Set(attemptRows.map((a) => a.studentRoll));
      const absentRolls = allottedRows.map((a) => a.studentRoll).filter((roll) => !hasAttempt.has(roll));

      if (absentRolls.length > 0) {
        await tx.quizAllotment.updateMany({
          where: { quizId: id, status: "allotted", studentRoll: { in: absentRolls } },
          data: { status: "absent" },
        });

        // Fill in missing attendance rows, and flip existing ones to absent -
        // but never overwrite a "present" row (e.g. a faculty manual mark).
        await tx.attendance.createMany({
          data: absentRolls.map((studentRoll) => ({
            studentRoll,
            courseCode: quiz.courseCode,
            courseName: quiz.courseName,
            quizId: id,
            date: quiz.startTime,
            status: "absent" as const,
          })),
          skipDuplicates: true,
        });
        await tx.attendance.updateMany({
          where: { quizId: id, studentRoll: { in: absentRolls }, status: { not: "present" } },
          data: { status: "absent" },
        });
      }
      // Scoring every in-progress attempt (one upsert per answer) for a full
      // class easily outlasts Prisma's 5s default interactive-transaction
      // limit, which rolled the whole stop back and left the quiz live.
      // READ COMMITTED (not MySQL's default REPEATABLE READ): with a snapshot
      // taken at the first read, a student submitting while this runs would be
      // invisible to the reads above and could be treated as absent.
    }, { timeout: 120000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    const updated = await prisma.quiz.findUnique({ where: { id } });
    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
