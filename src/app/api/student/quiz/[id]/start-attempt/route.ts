import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { created, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { startAttemptSchema } from "@/lib/validators/attempt";
import { idParamSchema } from "@/lib/validators/common";
import { isWithinRadius } from "@/lib/geofence";

function shuffledIds(ids: number[]): number[] {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const { id: quizId } = idParamSchema.parse(params);
    const body = startAttemptSchema.parse(await req.json());

    const allotment = await prisma.quizAllotment.findUnique({
      where: { quizId_studentRoll: { quizId, studentRoll: String(user.sub) } },
    });
    if (!allotment) throw new ApiError(403, "This quiz is not allotted to you");

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { building: true, questions: { select: { id: true } } },
    });
    if (!quiz) throw new ApiError(404, "Quiz not found");
    if (quiz.status !== "live")
      throw new ApiError(400, "This quiz is not currently live");

    const existingAttempt = await prisma.quizAttempt.findUnique({
      where: { quizId_studentRoll: { quizId, studentRoll: String(user.sub) } },
    });
    if (existingAttempt && existingAttempt.status !== "in_progress")
      throw new ApiError(
        409,
        "You have already started or completed this attempt",
      );
    if (existingAttempt) {
      const questionOrder: number[] = existingAttempt.questionOrder
        ? JSON.parse(existingAttempt.questionOrder)
        : quiz.questions.map((q) => q.id);
      return created({
        attemptId: existingAttempt.id,
        quizId,
        durationMinutes: quiz.durationMinutes,
        startTime: existingAttempt.startTime,
        totalQuestions: questionOrder.length,
        allowSkipSwitch: quiz.allowSkipSwitch,
      });
    }

    if (
      !quiz.requireLocation ||
      allotment.bypassLocation ||
      body.latitude == null ||
      body.longitude == null
    ) {
      const fallbackDistanceMeters = 0;
      const fallbackWithinRange = true;
      await prisma.geofenceLog.create({
        data: {
          quizId,
          studentRoll: String(user.sub),
          latitude: body.latitude ?? 0,
          longitude: body.longitude ?? 0,
          distanceMeters: fallbackDistanceMeters,
          isWithinRange: fallbackWithinRange,
        },
      });
    } else {
      // Never trust the client's earlier geofence-check result - re-verify server side now.
      const { isWithinRange, distanceMeters } = isWithinRadius(
        body.latitude,
        body.longitude,
        Number(quiz.building.latitude),
        Number(quiz.building.longitude),
        quiz.building.radiusMeters,
        body.accuracyMeters,
      );

      if (!isWithinRange) {
        await prisma.geofenceLog.create({
          data: {
            quizId,
            studentRoll: String(user.sub),
            latitude: body.latitude,
            longitude: body.longitude,
            distanceMeters,
            isWithinRange,
          },
        });
        throw new ApiError(
          403,
          `You must be within ${quiz.building.radiusMeters}m of ${quiz.building.name} to start this quiz (you appear to be about ${Math.round(distanceMeters)}m away - move closer or turn on precise location and try again)`,
        );
      }

      const questionOrder = quiz.randomize
        ? shuffledIds(quiz.questions.map((q) => q.id))
        : quiz.questions.map((q) => q.id);

      const attempt = await prisma.$transaction(async (tx) => {
        const newAttempt = await tx.quizAttempt.create({
          data: {
            quizId,
            studentRoll: String(user.sub),
            latitude: body.latitude ?? 0,
            longitude: body.longitude ?? 0,
            status: "in_progress",
            questionOrder: JSON.stringify(questionOrder),
          },
        });

        await tx.geofenceLog.create({
          data: {
            attemptId: newAttempt.id,
            quizId,
            studentRoll: String(user.sub),
            latitude: body.latitude ?? 0,
            longitude: body.longitude ?? 0,
            distanceMeters,
            isWithinRange,
          },
        });

        return newAttempt;
      });

      return created({
        attemptId: attempt.id,
        quizId,
        durationMinutes: quiz.durationMinutes,
        startTime: attempt.startTime,
        totalQuestions: questionOrder.length,
        allowSkipSwitch: quiz.allowSkipSwitch,
      });
    }

    const questionOrder = quiz.randomize
      ? shuffledIds(quiz.questions.map((q) => q.id))
      : quiz.questions.map((q) => q.id);

    const attempt = await prisma.$transaction(async (tx) => {
      const newAttempt = await tx.quizAttempt.create({
        data: {
          quizId,
          studentRoll: String(user.sub),
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          status: "in_progress",
          questionOrder: JSON.stringify(questionOrder),
        },
      });

      await tx.geofenceLog.create({
        data: {
          attemptId: newAttempt.id,
          quizId,
          studentRoll: String(user.sub),
          latitude: body.latitude ?? 0,
          longitude: body.longitude ?? 0,
          distanceMeters: 0,
          isWithinRange: true,
        },
      });

      return newAttempt;
    });

    return created({
      attemptId: attempt.id,
      quizId,
      durationMinutes: quiz.durationMinutes,
      startTime: attempt.startTime,
      totalQuestions: questionOrder.length,
      allowSkipSwitch: quiz.allowSkipSwitch,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
