import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { clearAttendance, setAttendanceStatus } from "@/lib/attendance-sync";

async function loadAllotment(quizId: number, roll: string, user: { role: string; sub: string | number }) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz || (user.role === "faculty" && quiz.facultyRoll !== String(user.sub))) {
    throw new ApiError(404, "Quiz not found");
  }
  const allotment = await prisma.quizAllotment.findUnique({
    where: { quizId_studentRoll: { quizId, studentRoll: roll } },
  });
  if (!allotment) throw new ApiError(404, "This student is not allotted to this quiz");
  return { quiz, allotment };
}

// Flags a student's attempt as a proxy (someone else appears to be taking
// it). A proxy always counts as absent, regardless of what they've submitted
// so far - see the field comment on QuizAllotment.isProxy. The attendance row
// is flipped to absent right away too, so a student who had already
// submitted doesn't keep showing "present" on the attendance screens.
export async function POST(req: NextRequest, { params }: { params: { id: string; roll: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse({ id: params.id });
    const { quiz } = await loadAllotment(quizId, params.roll, user);

    const updated = await prisma.$transaction(async (tx) => {
      const allotment = await tx.quizAllotment.update({
        where: { quizId_studentRoll: { quizId, studentRoll: params.roll } },
        data: { isProxy: true, status: "absent" },
      });
      await setAttendanceStatus(tx, quiz, params.roll, "absent");
      return allotment;
    });

    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

// Reverts a proxy flag, restoring the student's real attendance: "attempted"
// (present) if they have a submitted attempt, otherwise back to "allotted"
// while the quiz is still live (decided when it's stopped) or "absent" if it
// has already been stopped.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; roll: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse({ id: params.id });
    const { quiz } = await loadAllotment(quizId, params.roll, user);

    const attempt = await prisma.quizAttempt.findUnique({
      where: { quizId_studentRoll: { quizId, studentRoll: params.roll } },
    });
    const submitted = !!attempt && (attempt.status === "submitted" || attempt.status === "auto_submitted");
    const restoredStatus = submitted ? "attempted" : quiz.status === "completed" ? "absent" : "allotted";

    const updated = await prisma.$transaction(async (tx) => {
      const allotment = await tx.quizAllotment.update({
        where: { quizId_studentRoll: { quizId, studentRoll: params.roll } },
        data: { isProxy: false, status: restoredStatus },
      });
      if (submitted) await setAttendanceStatus(tx, quiz, params.roll, "present");
      else if (quiz.status === "completed") await setAttendanceStatus(tx, quiz, params.roll, "absent");
      else await clearAttendance(tx, quizId, params.roll);
      return allotment;
    });

    return ok(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
