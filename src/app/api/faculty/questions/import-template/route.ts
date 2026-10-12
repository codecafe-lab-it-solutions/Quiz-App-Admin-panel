import { NextRequest } from "next/server";
import { handleApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import { buildWorkbookBuffer, excelResponseHeaders } from "@/lib/excel";

// Downloadable .xlsx template for the bulk question import flow. `Type` is
// MCQ or SUBJECTIVE; an MCQ row needs at least OptionA + OptionB and an
// Answer, and a row with no options is only accepted when Type is SUBJECTIVE
// (see /api/faculty/quiz/:id/questions/import for the row rules).
export async function GET(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const buffer = buildWorkbookBuffer(
      [
        { key: "Question", label: "Question" },
        { key: "Type", label: "Type" },
        { key: "OptionA", label: "OptionA" },
        { key: "OptionB", label: "OptionB" },
        { key: "OptionC", label: "OptionC" },
        { key: "OptionD", label: "OptionD" },
        { key: "Answer", label: "Answer" },
        { key: "Marks", label: "Marks" },
        { key: "NegativeMarks", label: "NegativeMarks" },
      ],
      [
        {
          Question: "2 + 2 = ?",
          Type: "MCQ",
          OptionA: "3",
          OptionB: "4",
          OptionC: "5",
          OptionD: "6",
          Answer: "B",
          Marks: 1,
          NegativeMarks: 0,
        },
        {
          Question: "Explain Newton's second law of motion.",
          Type: "SUBJECTIVE",
          OptionA: "",
          OptionB: "",
          OptionC: "",
          OptionD: "",
          Answer: "",
          Marks: 5,
          NegativeMarks: "",
        },
      ],
      "Questions"
    );

    return new Response(new Uint8Array(buffer), { headers: excelResponseHeaders("question-import-template.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
