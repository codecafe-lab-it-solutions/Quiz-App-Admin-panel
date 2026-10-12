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
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        totalMarks: true,
        status: true,
        facultyRoll: true,
        courseCode: true,
        courseName: true,
        building: { select: { name: true } },
      },
    });

    if (
      !quiz ||
      (user.role === "faculty" && quiz.facultyRoll !== String(user.sub))
    ) {
      throw new ApiError(404, "Quiz not found");
    }

    const [allotments, attempts, questions, results] = await Promise.all([
      prisma.quizAllotment.findMany({
        where: { quizId },
        orderBy: { studentRoll: "asc" },
      }),
      prisma.quizAttempt.findMany({
        where: { quizId },
        include: {
          answers: {
            include: {
              question: {
                select: { id: true, questionType: true, marks: true },
              },
            },
          },
        },
      }),
      prisma.question.findMany({
        where: { quizId },
        orderBy: { orderIndex: "asc" },
        include: {
          options: true,
          formula: true,
        },
      }),
      prisma.result.findMany({ where: { quizId } }),
    ]);

    const names = await getStudentNamesByRolls(
      allotments.map((a) => a.studentRoll),
    );
    const attemptByStudent = new Map(attempts.map((a) => [a.studentRoll, a]));
    const resultByStudent = new Map(results.map((r) => [r.studentRoll, r]));

    const questionStats = new Map<
      number,
      {
        attemptedCount: number;
        correctCount: number;
        wrongCount: number;
        skippedCount: number;
      }
    >();

    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const stats = questionStats.get(answer.questionId) ?? {
          attemptedCount: 0,
          correctCount: 0,
          wrongCount: 0,
          skippedCount: 0,
        };

        if (answer.isSkipped) {
          stats.skippedCount += 1;
        } else {
          stats.attemptedCount += 1;
          if (answer.isCorrect === true) stats.correctCount += 1;
          else stats.wrongCount += 1;
        }

        questionStats.set(answer.questionId, stats);
      }
    }

    const questionBreakdown = questions.map((question) => {
      const stats = questionStats.get(question.id) ?? {
        attemptedCount: 0,
        correctCount: 0,
        wrongCount: 0,
        skippedCount: 0,
      };
      let answerKey = "No answer key";

      if (question.questionType === "mcq") {
        const correctOption = question.options.find(
          (option) => option.isCorrect,
        );
        answerKey = correctOption?.optionText
          ? correctOption.optionText.replace(/<[^>]+>/g, "").trim()
          : "No correct option";
      } else if (question.questionType === "formula") {
        answerKey = `Correct value: ${question.formula?.correctValue ?? 0} ± ${question.formula?.tolerance ?? 0}`;
      } else if (question.questionType === "subjective") {
        answerKey = question.referenceAnswer?.trim()
          ? question.referenceAnswer.trim()
          : "Subjective response";
      }

      return {
        id: question.id,
        questionText: question.questionText,
        questionType: question.questionType,
        marks: question.marks,
        answerKey,
        attemptedCount: stats.attemptedCount,
        correctCount: stats.correctCount,
        wrongCount: stats.wrongCount,
        skippedCount: stats.skippedCount,
      };
    });

    const studentResults = allotments.map((allotment) => {
      const attempt = attemptByStudent.get(allotment.studentRoll);
      const result = resultByStudent.get(allotment.studentRoll);
      const marksObtained =
        result?.marksObtained ??
        attempt?.answers.reduce(
          (sum, answer) => sum + answer.marksObtained,
          0,
        ) ??
        0;
      const percentage =
        result?.percentage ??
        (quiz.totalMarks > 0 ? (marksObtained / quiz.totalMarks) * 100 : 0);

      return {
        roll: allotment.studentRoll,
        name: names.get(allotment.studentRoll) ?? allotment.studentRoll,
        attendanceStatus: allotment.status,
        isProxy: allotment.isProxy,
        attemptStatus: attempt?.status ?? null,
        marksObtained,
        percentage,
        resultStatus: result?.status ?? "pending",
      };
    });

    const submittedCount = attempts.filter(
      (a) => a.status === "submitted" || a.status === "auto_submitted",
    ).length;
    const ungradedCount = attempts.reduce(
      (sum, attempt) =>
        sum +
        attempt.answers.filter(
          (answer) =>
            answer.question.questionType === "subjective" &&
            !answer.isSkipped &&
            !answer.manuallyGraded,
        ).length,
      0,
    );

    return ok({
      quiz,
      summary: {
        totalAllotted: allotments.length,
        attemptedCount: attempts.length,
        submittedCount,
        notAttemptedCount: allotments.length - attempts.length,
        absentCount: allotments.filter((item) => item.status === "absent")
          .length,
        proxyCount: allotments.filter((item) => item.isProxy).length,
        declaredCount: results.filter((item) => item.status === "declared")
          .length,
        publishedCount: results.filter((item) => item.status === "published")
          .length,
        ungradedCount,
      },
      questionBreakdown,
      studentResults,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
