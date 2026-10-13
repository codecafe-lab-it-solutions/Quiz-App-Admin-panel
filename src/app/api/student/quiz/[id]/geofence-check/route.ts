import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { geofenceCheckSchema } from "@/lib/validators/attempt";
import { idParamSchema } from "@/lib/validators/common";
import { isWithinRadius } from "@/lib/geofence";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "student");

    const { id: quizId } = idParamSchema.parse(params);
    const body = geofenceCheckSchema.parse(await req.json());

    const allotment = await prisma.quizAllotment.findUnique({
      where: { quizId_studentRoll: { quizId, studentRoll: String(user.sub) } },
    });
    if (!allotment) throw new ApiError(403, "This quiz is not allotted to you");

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { building: true },
    });
    if (!quiz) throw new ApiError(404, "Quiz not found");

    if (
      !quiz.requireLocation ||
      allotment.bypassLocation ||
      body.latitude == null ||
      body.longitude == null
    ) {
      return ok({
        isWithinRange: true,
        distanceMeters: 0,
        allowedRadiusMeters: quiz.building.radiusMeters,
        buildingName: quiz.building.name,
        skipped: !quiz.requireLocation || allotment.bypassLocation,
      });
    }

    const { isWithinRange, distanceMeters } = isWithinRadius(
      body.latitude,
      body.longitude,
      Number(quiz.building.latitude),
      Number(quiz.building.longitude),
      quiz.building.radiusMeters,
      body.accuracyMeters,
    );

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

    return ok({
      isWithinRange,
      distanceMeters: Math.round(distanceMeters),
      allowedRadiusMeters: quiz.building.radiusMeters,
      buildingName: quiz.building.name,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
