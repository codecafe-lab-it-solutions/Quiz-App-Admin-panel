import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { idParamSchema } from "@/lib/validators/common";
import { parseWorkbookRows } from "@/lib/excel";
import { escapePlainText } from "@/lib/sanitize-html";

interface ImportRow {
  Question?: string;
  Type?: string;
  OptionA?: string;
  OptionB?: string;
  OptionC?: string;
  OptionD?: string;
  Answer?: string;
  Marks?: string | number;
  NegativeMarks?: string | number;
}

interface RowResult {
  row: number;
  question: string;
  status: "added" | "skipped";
  reason?: string;
}

// Canonical column name for every accepted header spelling - case, spaces and
// underscores are ignored, so "Option A", "option_a" and "OPTIONA" all work.
// Without this, a header that is spelled slightly differently made every
// option read as blank and every row was silently imported as SUBJECTIVE.
const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  question: "Question",
  type: "Type",
  optiona: "OptionA",
  optionb: "OptionB",
  optionc: "OptionC",
  optiond: "OptionD",
  answer: "Answer",
  marks: "Marks",
  negativemarks: "NegativeMarks",
};

function normaliseRow(raw: Record<string, unknown>): ImportRow {
  const row: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(raw)) {
    const canonical = HEADER_ALIASES[header.toLowerCase().replace(/[^a-z]/g, "")];
    if (canonical && row[canonical] === undefined) row[canonical] = value;
  }
  return row as ImportRow;
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

// Bulk question import from an .xlsx/.csv upload matching the template from
// GET /api/faculty/questions/import-template. A row's `Type` column is
// MCQ or SUBJECTIVE; when it is left blank the row counts as MCQ only if it
// has options/an Answer. A row with NO options and no explicit SUBJECTIVE
// type is REJECTED - it used to be imported as subjective silently, which hid
// missing options (or a mis-spelled header) until students saw the quiz.
// Validates each row independently and reports a per-row status - duplicate
// detection, required-field checks, options contiguous from A, answer must
// match a filled option.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const { id: quizId } = idParamSchema.parse(params);
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz || (user.role === "faculty" && quiz.facultyRoll !== String(user.sub))) throw new ApiError(404, "Quiz not found");
    if (quiz.status === "live" || quiz.status === "completed") {
      throw new ApiError(400, "Cannot edit questions on a live or completed quiz");
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") throw new ApiError(400, "Upload an Excel file under the 'file' field");

    const buffer = Buffer.from(await file.arrayBuffer());
    const rawRows = parseWorkbookRows<Record<string, unknown>>(buffer);
    if (rawRows.length === 0) throw new ApiError(400, "The uploaded file has no rows");

    const presentColumns = new Set(
      Object.keys(rawRows[0]).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[^a-z]/g, "")]),
    );
    const missingColumns = (["Question", "OptionA", "OptionB", "Answer", "Marks"] as const).filter(
      (c) => !presentColumns.has(c),
    );
    if (missingColumns.length > 0) {
      throw new ApiError(
        400,
        `The file is missing required column(s): ${missingColumns.join(", ")}. Download the template and keep its header row unchanged.`,
      );
    }
    const rows = rawRows.map(normaliseRow);

    const existing = await prisma.question.findMany({ where: { quizId }, select: { questionText: true } });
    const seenQuestionTexts = new Set(existing.map((q) => q.questionText.trim().toLowerCase()));

    const maxOrder = await prisma.question.aggregate({ where: { quizId }, _max: { orderIndex: true } });
    let nextOrder = (maxOrder._max.orderIndex ?? -1) + 1;

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // header is row 1
      const questionText = (r.Question ?? "").trim();

      if (!questionText) {
        results.push({ row: rowNum, question: "", status: "skipped", reason: "Question text is required" });
        continue;
      }

      const marks = Number(r.Marks);
      if (!Number.isFinite(marks) || marks <= 0) {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "Marks must be a positive number" });
        continue;
      }

      const dedupeKey = questionText.toLowerCase();
      if (seenQuestionTexts.has(dedupeKey)) {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "Duplicate question (already in this test)" });
        continue;
      }

      const rawOptions = [r.OptionA, r.OptionB, r.OptionC, r.OptionD].map((o) => (o ?? "").toString().trim());
      const answerLetter = (r.Answer ?? "").toString().trim().toUpperCase();
      const rawType = (r.Type ?? "").toString().trim().toLowerCase();
      const hasAnyOptionOrAnswer = rawOptions.some(Boolean) || answerLetter !== "";

      let rowType: "mcq" | "subjective";
      if (rawType === "") {
        if (!hasAnyOptionOrAnswer) {
          results.push({
            row: rowNum,
            question: questionText,
            status: "skipped",
            reason: "Options are missing. Fill OptionA-OptionD and Answer for an MCQ, or set Type to SUBJECTIVE for a written-answer question",
          });
          continue;
        }
        rowType = "mcq";
      } else if (["mcq", "objective"].includes(rawType)) {
        rowType = "mcq";
      } else if (rawType === "subjective") {
        rowType = "subjective";
      } else {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "Type must be MCQ or SUBJECTIVE" });
        continue;
      }

      if (rowType === "subjective") {
        if (hasAnyOptionOrAnswer) {
          results.push({
            row: rowNum,
            question: questionText,
            status: "skipped",
            reason: "A SUBJECTIVE question must not have options or an answer - clear them or change Type to MCQ",
          });
          continue;
        }

        await prisma.question.create({
          data: {
            quizId,
            questionText: escapePlainText(questionText),
            questionType: "subjective",
            marks,
            negativeMarks: 0,
            orderIndex: nextOrder++,
          },
        });

        seenQuestionTexts.add(dedupeKey);
        results.push({ row: rowNum, question: questionText, status: "added" });
        continue;
      }

      // OBJECTIVE - kept keyed by letter (not compacted by array position) so
      // a gap (e.g. OptionB left blank but OptionC filled) can't desync which
      // option Answer=C actually points at.
      const filledOptions = OPTION_LETTERS.map((letter, idx) => ({ letter, text: rawOptions[idx] })).filter(
        (o) => o.text !== "",
      );
      const firstBlank = rawOptions.findIndex((o) => o === "");
      const lastFilled = rawOptions.reduce((acc, o, idx) => (o !== "" ? idx : acc), -1);
      if (firstBlank !== -1 && lastFilled > firstBlank) {
        results.push({
          row: rowNum,
          question: questionText,
          status: "skipped",
          reason: `Option${OPTION_LETTERS[firstBlank]} is missing but Option${OPTION_LETTERS[lastFilled]} is filled - options must be filled in order from OptionA`,
        });
        continue;
      }
      if (filledOptions.length < 2) {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "At least two options (OptionA, OptionB, ...) are required" });
        continue;
      }

      const correctOption = filledOptions.find((o) => o.letter === answerLetter);
      if (!correctOption) {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "Answer must be one of A, B, C, D, matching a filled option" });
        continue;
      }

      const negativeMarks = Number(r.NegativeMarks ?? 0);
      if (!Number.isFinite(negativeMarks) || negativeMarks < 0) {
        results.push({ row: rowNum, question: questionText, status: "skipped", reason: "Negative marks must be zero or a positive number" });
        continue;
      }

      await prisma.question.create({
        data: {
          quizId,
          questionText: escapePlainText(questionText),
          questionType: "mcq",
          marks,
          negativeMarks,
          orderIndex: nextOrder++,
          options: {
            create: filledOptions.map((o) => ({
              optionText: escapePlainText(o.text),
              isCorrect: o.letter === answerLetter,
            })),
          },
        },
      });

      seenQuestionTexts.add(dedupeKey);
      results.push({ row: rowNum, question: questionText, status: "added" });
    }

    const addedCount = results.filter((r) => r.status === "added").length;
    if (addedCount > 0) {
      const totalMarks = await prisma.question.aggregate({ where: { quizId }, _sum: { marks: true } });
      await prisma.quiz.update({ where: { id: quizId }, data: { totalMarks: totalMarks._sum.marks ?? quiz.totalMarks } });
    }

    return ok({ addedCount, skippedCount: results.length - addedCount, results });
  } catch (error) {
    return handleApiError(error);
  }
}
