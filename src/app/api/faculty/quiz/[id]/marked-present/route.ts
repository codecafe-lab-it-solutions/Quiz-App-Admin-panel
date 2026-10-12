import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { loadAccessibleQuiz } from "@/lib/quiz-access";
import { getStudentNamesByRolls } from "@/lib/legacy-db";
import { buildWorkbookBuffer, excelResponseHeaders } from "@/lib/excel";

// The students a faculty/admin marked present by hand for this quiz (device
// problem etc.) - who, by whom, when, and their 0-mark result. Same data is
// flagged in the `attendance` table (marked_by_faculty = 1), so it can also
// be filtered there. `?export=excel` downloads it as a spreadsheet.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse(params);
    const quiz = await loadAccessibleQuiz(user, quizId);

    const rows = await prisma.attendance.findMany({
      where: { quizId, markedByFaculty: true },
      orderBy: { studentRoll: "asc" },
    });
    const rolls = rows.map((r) => r.studentRoll);

    const [names, results] = await Promise.all([
      getStudentNamesByRolls(rolls),
      prisma.result.findMany({ where: { quizId, studentRoll: { in: rolls } } }),
    ]);
    const resultByRoll = new Map(results.map((r) => [r.studentRoll, r]));

    const items = rows.map((r) => ({
      roll: r.studentRoll,
      name: names.get(r.studentRoll) ?? r.studentRoll,
      attendance: r.status,
      markedBy: r.markedByRoll,
      markedAt: r.markedAt,
      marksObtained: resultByRoll.get(r.studentRoll)?.marksObtained ?? 0,
      resultStatus: resultByRoll.get(r.studentRoll)?.status ?? "pending",
    }));

    if (req.nextUrl.searchParams.get("export") === "excel") {
      const buffer = buildWorkbookBuffer(
        [
          { key: "roll", label: "Roll No" },
          { key: "name", label: "Student Name" },
          { key: "quiz", label: "Quiz" },
          { key: "course", label: "Course" },
          { key: "attendance", label: "Attendance" },
          { key: "marks", label: "Marks" },
          { key: "markedBy", label: "Marked present by" },
          { key: "markedAt", label: "Marked at" },
        ],
        items.map((i) => ({
          roll: i.roll,
          name: i.name,
          quiz: quiz.title,
          course: `${quiz.courseName} (${quiz.courseCode})`,
          attendance: i.attendance,
          marks: i.marksObtained,
          markedBy: i.markedBy ?? "",
          markedAt: i.markedAt ? i.markedAt.toISOString() : "",
        })),
        "Marked present",
      );
      return new Response(new Uint8Array(buffer), {
        headers: excelResponseHeaders(`quiz-${quizId}-marked-present.xlsx`),
      });
    }

    return ok({ quizId, count: items.length, items });
  } catch (error) {
    return handleApiError(error);
  }
}
