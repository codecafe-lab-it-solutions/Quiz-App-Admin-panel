import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { created, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id } = idParamSchema.parse(params);
    const source = await prisma.quiz.findFirst({
      where: { id, deletedAt: null },
      include: { questions: { include: { options: true, formula: true } } },
    });
    if (!source || (user.role === "faculty" && source.facultyRoll !== String(user.sub))) throw new ApiError(404, "Quiz not found");

    const duplicate = await prisma.$transaction(async (tx) => {
      const newQuiz = await tx.quiz.create({
        data: {
          title: `${source.title} (Copy)`,
          courseCode: source.courseCode,
          courseName: source.courseName,
          sectionNames: source.sectionNames,
          facultyRoll: source.facultyRoll,
          buildingId: source.buildingId,
          startTime: source.startTime,
          endTime: source.endTime,
          durationMinutes: source.durationMinutes,
          totalMarks: source.totalMarks,
          randomize: source.randomize,
          negativeMarking: source.negativeMarking,
          allowSkipSwitch: source.allowSkipSwitch,
          requireLocation: source.requireLocation,
          status: "draft",
        },
      });

      for (const q of source.questions) {
        const newQuestion = await tx.question.create({
          data: {
            quizId: newQuiz.id,
            questionText: q.questionText,
            questionType: q.questionType,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            referenceAnswer: q.referenceAnswer,
            orderIndex: q.orderIndex,
          },
        });

        if (q.questionType === "mcq") {
          await tx.questionOption.createMany({
            data: q.options.map((o) => ({
              questionId: newQuestion.id,
              optionText: o.optionText,
              isCorrect: o.isCorrect,
            })),
          });
        } else if (q.questionType === "formula" && q.formula) {
          await tx.questionFormula.create({
            data: {
              questionId: newQuestion.id,
              correctValue: q.formula.correctValue,
              tolerance: q.formula.tolerance,
            },
          });
        }
        // subjective: referenceAnswer already copied above, no child rows needed
      }

      return newQuiz;
    });

    // Students are deliberately NOT copied across (a duplicate is usually for a
    // different sitting), so say so explicitly - the faculty must allot
    // students to the copy before it can be started.
    return created({
      ...duplicate,
      allottedCount: 0,
      warning: "No students are allotted to the duplicated quiz. Allot students before starting it.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
