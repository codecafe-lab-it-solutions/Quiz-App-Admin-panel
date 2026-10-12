import { Prisma } from "@prisma/client";

type AttendanceQuiz = { id: number; courseCode: string; courseName: string; startTime: Date };

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
    update: { status },
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

// Drops the student's attendance row (a live quiz hasn't decided it yet).
export async function clearAttendance(tx: Prisma.TransactionClient, quizId: number, studentRoll: string): Promise<void> {
  await tx.attendance.deleteMany({ where: { quizId, studentRoll } });
}
