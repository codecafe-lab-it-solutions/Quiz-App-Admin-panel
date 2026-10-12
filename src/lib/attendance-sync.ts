import { Prisma } from "@prisma/client";

type AttendanceQuiz = { id: number; courseCode: string; courseName: string; startTime: Date };

// Clears the "marked present by faculty" flag - every normal write (a real
// submit, a proxy flag, an undo) replaces a manual mark rather than keeping
// a stale flag on a row that is no longer a manual one.
const CLEAR_MANUAL_MARK = { markedByFaculty: false, markedByRoll: null, markedAt: null } as const;

// Writes the student's attendance row for a quiz - the same upsert shape
// finalizeAttempt/stop use, shared here so the manual overrides (proxy flag,
// mark present) keep the Attendance table, which the student/faculty
// attendance screens read, in step with the allotment status instead of
// leaving the two disagreeing.
export async function setAttendanceStatus(
  tx: Prisma.TransactionClient,
  quiz: AttendanceQuiz,
  studentRoll: string,
  status: "present" | "absent",
): Promise<void> {
  await tx.attendance.upsert({
    where: { studentRoll_quizId: { studentRoll, quizId: quiz.id } },
    update: { status, ...CLEAR_MANUAL_MARK },
    create: {
      studentRoll,
      courseCode: quiz.courseCode,
      courseName: quiz.courseName,
      quizId: quiz.id,
      date: quiz.startTime,
      status,
    },
  });
}

// Faculty/admin marks a student present by hand (device problem, was in the
// class). Flagged so these rows can be filtered and exported, and given a
// Result row of 0 marks - without one the student would have no result at all
// and mark-based reports would silently skip them. An existing Result (the
// student did attempt) is left untouched.
export async function markPresentByFaculty(
  tx: Prisma.TransactionClient,
  quiz: AttendanceQuiz,
  studentRoll: string,
  markedBy: string,
): Promise<void> {
  const now = new Date();
  await tx.attendance.upsert({
    where: { studentRoll_quizId: { studentRoll, quizId: quiz.id } },
    update: { status: "present", markedByFaculty: true, markedByRoll: markedBy, markedAt: now },
    create: {
      studentRoll,
      courseCode: quiz.courseCode,
      courseName: quiz.courseName,
      quizId: quiz.id,
      date: quiz.startTime,
      status: "present",
      markedByFaculty: true,
      markedByRoll: markedBy,
      markedAt: now,
    },
  });

  await tx.result.upsert({
    where: { quizId_studentRoll: { quizId: quiz.id, studentRoll } },
    update: {},
    create: { quizId: quiz.id, studentRoll, marksObtained: 0, percentage: 0, status: "pending" },
  });
}

// Undoes the manual 0-mark Result created above - only when the student has
// no real attempt (an attempt's own Result is never touched).
export async function removeManualResult(tx: Prisma.TransactionClient, quizId: number, studentRoll: string): Promise<void> {
  const attempt = await tx.quizAttempt.findUnique({ where: { quizId_studentRoll: { quizId, studentRoll } }, select: { id: true } });
  if (attempt) return;
  await tx.result.deleteMany({ where: { quizId, studentRoll } });
}

// Drops the student's attendance row (a live quiz hasn't decided it yet).
export async function clearAttendance(tx: Prisma.TransactionClient, quizId: number, studentRoll: string): Promise<void> {
  await tx.attendance.deleteMany({ where: { quizId, studentRoll } });
}
