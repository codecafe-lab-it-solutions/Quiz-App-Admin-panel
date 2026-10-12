import { Prisma, Question, QuestionFormula, QuestionOption, Quiz, StudentAnswer } from "@prisma/client";

export interface ScoredAnswer {
  questionId: number;
  orderIndex: number;
  isSkipped: boolean;
  isCorrect: boolean | null;
  marksObtained: number;
  selectedOptionId: number | null;
  answerValue: number | null;
  writtenAnswer: string | null;
}

// Grades one attempt's currently saved answers against the quiz's questions -
// shared by the student's own submit and by faculty stopping the quiz out
// from under an in-progress attempt (see attempt/[id]/submit and
// faculty/quiz/[id]/stop), so both paths score identically.
export function scoreAttemptAnswers(params: {
  orderedIds: number[];
  questions: Question[];
  options: QuestionOption[];
  formulas: QuestionFormula[];
  existingAnswers: StudentAnswer[];
  negativeMarking: boolean;
}): { scoredAnswers: ScoredAnswer[]; totalMarksObtained: number } {
  const { orderedIds, questions, options, formulas, existingAnswers, negativeMarking } = params;

  const questionById = new Map(questions.map((q) => [q.id, q]));
  const optionsByQuestion = new Map<number, QuestionOption[]>();
  for (const opt of options) {
    const list = optionsByQuestion.get(opt.questionId) ?? [];
    list.push(opt);
    optionsByQuestion.set(opt.questionId, list);
  }
  const formulaByQuestion = new Map(formulas.map((f) => [f.questionId, f]));
  const answerByQuestion = new Map(existingAnswers.map((a) => [a.questionId, a]));

  let totalMarksObtained = 0;

  const scoredAnswers: ScoredAnswer[] = orderedIds.map((questionId, orderIndex) => {
    const question = questionById.get(questionId);
    const existing = answerByQuestion.get(questionId);

    if (!question) {
      return { questionId, orderIndex, isSkipped: true, isCorrect: null, marksObtained: 0, selectedOptionId: null, answerValue: null, writtenAnswer: null };
    }

    const isSkipped =
      !existing ||
      existing.isSkipped ||
      (question.questionType === "subjective"
        ? !existing.writtenAnswer || existing.writtenAnswer.trim() === ""
        : existing.selectedOptionId == null && existing.answerValue == null);

    if (isSkipped) {
      return {
        questionId,
        orderIndex,
        isSkipped: true,
        isCorrect: null,
        marksObtained: 0,
        selectedOptionId: existing?.selectedOptionId ?? null,
        answerValue: existing?.answerValue ?? null,
        writtenAnswer: existing?.writtenAnswer ?? null,
      };
    }

    // Subjective answers are never auto-scored - a faculty member grades
    // them manually after submission (marksObtained stays 0 until then).
    if (question.questionType === "subjective") {
      return {
        questionId,
        orderIndex,
        isSkipped: false,
        isCorrect: null,
        marksObtained: 0,
        selectedOptionId: null,
        answerValue: null,
        writtenAnswer: existing!.writtenAnswer,
      };
    }

    let isCorrect = false;

    if (question.questionType === "mcq") {
      const correctOption = (optionsByQuestion.get(questionId) ?? []).find((o) => o.isCorrect);
      isCorrect = !!correctOption && correctOption.id === existing!.selectedOptionId;
    } else {
      const formula = formulaByQuestion.get(questionId);
      if (formula && existing!.answerValue != null) {
        isCorrect = Math.abs(existing!.answerValue - formula.correctValue) <= formula.tolerance;
      }
    }

    const marksObtained = isCorrect ? question.marks : negativeMarking ? -question.negativeMarks : 0;
    totalMarksObtained += marksObtained;

    return {
      questionId,
      orderIndex,
      isSkipped: false,
      isCorrect,
      marksObtained,
      selectedOptionId: existing!.selectedOptionId,
      answerValue: existing!.answerValue,
      writtenAnswer: null,
    };
  });

  return { scoredAnswers, totalMarksObtained };
}

// Persists a graded attempt: answers, attempt status, allotment, attendance,
// and result - the same five writes for a student's own submit and for an
// attempt closed out by faculty stopping the quiz.
export async function finalizeAttempt(
  tx: Prisma.TransactionClient,
  params: {
    attemptId: number;
    quiz: Quiz;
    studentRoll: string;
    status: "submitted" | "auto_submitted";
    endTime: Date;
    autoSubmitReason: string | null;
    scoredAnswers: ScoredAnswer[];
    totalMarksObtained: number;
  },
): Promise<void> {
  const { attemptId, quiz, studentRoll, status, endTime, autoSubmitReason, scoredAnswers, totalMarksObtained } = params;
  const percentage = quiz.totalMarks > 0 ? (totalMarksObtained / quiz.totalMarks) * 100 : 0;

  for (const answer of scoredAnswers) {
    await tx.studentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId: answer.questionId } },
      update: {
        isCorrect: answer.isCorrect,
        marksObtained: answer.marksObtained,
        isSkipped: answer.isSkipped,
        orderIndex: answer.orderIndex,
      },
      create: {
        attemptId,
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        answerValue: answer.answerValue,
        writtenAnswer: answer.writtenAnswer,
        isCorrect: answer.isCorrect,
        marksObtained: answer.marksObtained,
        isSkipped: answer.isSkipped,
        orderIndex: answer.orderIndex,
      },
    });
  }

  await tx.quizAttempt.update({
    where: { id: attemptId },
    data: {
      status,
      endTime,
      autoSubmitted: status === "auto_submitted",
      autoSubmitReason: status === "auto_submitted" ? autoSubmitReason ?? "auto_submitted" : null,
    },
  });

  // A student the faculty flagged as a proxy always counts as absent (see
  // QuizAllotment.isProxy) - finishing their attempt must not silently flip
  // them back to present.
  const allotment = await tx.quizAllotment.findUnique({
    where: { quizId_studentRoll: { quizId: quiz.id, studentRoll } },
    select: { isProxy: true },
  });
  const isProxy = allotment?.isProxy === true;

  await tx.quizAllotment.update({
    where: { quizId_studentRoll: { quizId: quiz.id, studentRoll } },
    data: { status: isProxy ? "absent" : "attempted" },
  });

  const attendanceStatus = isProxy ? "absent" : "present";
  await tx.attendance.upsert({
    where: { studentRoll_quizId: { studentRoll, quizId: quiz.id } },
    // A real submission replaces any earlier manual "marked present" flag.
    update: { status: attendanceStatus, markedByFaculty: false, markedByRoll: null, markedAt: null },
    create: {
      studentRoll,
      courseCode: quiz.courseCode,
      courseName: quiz.courseName,
      quizId: quiz.id,
      date: quiz.startTime,
      status: attendanceStatus,
    },
  });

  await tx.result.upsert({
    where: { quizId_studentRoll: { quizId: quiz.id, studentRoll } },
    update: { marksObtained: totalMarksObtained, percentage },
    create: {
      quizId: quiz.id,
      studentRoll,
      marksObtained: totalMarksObtained,
      percentage,
      status: "pending",
    },
  });
}
