import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";
import { clearAttendance, setAttendanceStatus } from "@/lib/attendance-sync";

async function loadContext(req: NextRequest, params: { id: string; roll: string }) {
  const user = getAuthUser(req);
  requireRole(user, "faculty", "admin");

  const { id: quizId } = idParamSchema.parse({ id: params.id });
  const quiz = await loadAccessibleQuiz(user, quizId);
  if (quiz.status === "draft" || quiz.status === "scheduled") {
    throw new ApiError(400, "Attendance can only be changed once the quiz is live or completed");
  }

  const allotment = await prisma.quizAllotment.findUnique({
    where: { quizId_studentRoll: { quizId, studentRoll: params.roll } },
  });
  if (!allotment) throw new ApiError(404, "This student is not allotted to this quiz");

  const attempt = await prisma.quizAttempt.findUnique({
    where: { quizId_studentRoll: { quizId, studentRoll: params.roll } },
  });
  return { quiz, allotment, attempt };
}

// Faculty override: marks an allotted student PRESENT without them taking the
// quiz (e.g. they were in the room but couldn't attempt it). Works while the
// quiz is live and also after it has been stopped, so a wrongly-absent
// student can be corrected. Also clears a proxy flag - an explicit "present"
// from the faculty wins over it. Does not create an attempt or any marks.
export async function POST(req: NextRequest, { params }: { params: { id: string; roll: string } }) {
  try {
    const { quiz, allotment } = await loadContext(req, params);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.quizAllotment.update({
        where: { id: allotment.id },
        data: { status: "attempted", isProxy: false },
      });
      await setAttendanceStatus(tx, quiz, params.roll, "present");
      return next;
    });

    return ok({
      student: { roll: params.roll },
      allotmentStatus: updated.status,
      isProxy: updated.isProxy,
      attendance: "present",
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Undoes a manual "mark present". A student who really submitted an attempt
// stays present - there is nothing to undo.
export async function DELETE(req: NextRequest, { params }: { params: { id: string; roll: string } }) {
  try {
    const { quiz, allotment, attempt } = await loadContext(req, params);

    if (attempt && (attempt.status === "submitted" || attempt.status === "auto_submitted")) {
      throw new ApiError(400, "This student submitted the quiz - their attendance is present and can't be undone");
    }

    const completed = quiz.status === "completed";
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.quizAllotment.update({
        where: { id: allotment.id },
        data: { status: completed ? "absent" : "allotted" },
      });
      if (completed) await setAttendanceStatus(tx, quiz, params.roll, "absent");
      else await clearAttendance(tx, quiz.id, params.roll);
      return next;
    });

    return ok({
      student: { roll: params.roll },
      allotmentStatus: updated.status,
      isProxy: updated.isProxy,
      attendance: completed ? "absent" : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
