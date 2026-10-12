"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RichTextEditor,
  isMathliveElement,
} from "@/components/quiz/rich-text-editor";
import { stripHtml } from "@/lib/sanitize-html";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";

export interface QuestionOptionRow {
  optionText: string;
  isCorrect: boolean;
}

export interface QuestionRow {
  id?: number;
  questionType: "mcq" | "formula" | "subjective";
  questionText: string;
  marks: number;
  negativeMarks: number;
  referenceAnswer?: string | null;
  orderIndex: number;
  options?: QuestionOptionRow[];
  formula?: { correctValue: number; tolerance: number } | null;
}

interface QuestionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quizId: number;
  nextOrderIndex: number;
  editing: QuestionRow | null;
  onSaved: () => void;
}

const EMPTY_OPTIONS: QuestionOptionRow[] = [
  { optionText: "", isCorrect: true },
  { optionText: "", isCorrect: false },
  { optionText: "", isCorrect: false },
  { optionText: "", isCorrect: false },
];

export function QuestionEditorDialog({
  open,
  onOpenChange,
  quizId,
  nextOrderIndex,
  editing,
  onSaved,
}: QuestionEditorDialogProps) {
  const [questionText, setQuestionText] = useState("");
  const [marks, setMarks] = useState("1");
  const [negativeMarks, setNegativeMarks] = useState("0");
  const [options, setOptions] = useState<QuestionOptionRow[]>(EMPTY_OPTIONS);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setQuestionText(editing.questionText);
      setMarks(String(editing.marks));
      setNegativeMarks(String(editing.negativeMarks ?? 0));
      setOptions(
        editing.options && editing.options.length >= 2
          ? editing.options
          : EMPTY_OPTIONS,
      );
    } else {
      setQuestionText("");
      setMarks("1");
      setNegativeMarks("0");
      setOptions(EMPTY_OPTIONS);
    }
  }, [open, editing]);

  const updateOption = (index: number, patch: Partial<QuestionOptionRow>) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );
  };

  const setCorrectOption = (index: number) => {
    setOptions((prev) =>
      prev.map((o, i) => ({ ...o, isCorrect: i === index })),
    );
  };

  const addOption = () => {
    if (options.length >= 4) return;
    setOptions((prev) => [...prev, { optionText: "", isCorrect: false }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((o) => o.isCorrect)) next[0].isCorrect = true;
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!stripHtml(questionText)) {
      toast.error("Question text is required");
      return;
    }
    const marksNum = Number(marks);
    if (!Number.isFinite(marksNum) || marksNum <= 0) {
      toast.error("Marks must be greater than 0");
      return;
    }

    const filled = options.filter((o) => stripHtml(o.optionText));
    if (filled.length < 2) {
      toast.error("Provide at least two options");
      return;
    }
    if (!filled.some((o) => o.isCorrect)) {
      toast.error("Mark one option as correct");
      return;
    }
    const negNum = Number(negativeMarks);
    if (!Number.isFinite(negNum) || negNum < 0) {
      toast.error("Negative marks must be zero or a positive number");
      return;
    }

    const payload = {
      id: editing?.id,
      questionType: "mcq",
      questionText,
      marks: marksNum,
      negativeMarks: negNum,
      orderIndex: editing?.orderIndex ?? nextOrderIndex,
      options: filled.map((o) => ({
        optionText: o.optionText,
        isCorrect: o.isCorrect,
      })),
    };

    setSubmitting(true);
    try {
      await apiClient.post(`/api/faculty/quiz/${quizId}/questions`, {
        questions: [payload],
      });
      toast.success(editing ? "Question updated" : "Question added");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to save question",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onPointerDownOutside={(e) => {
          if (isMathliveElement(e.target)) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isMathliveElement(e.target)) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit Question" : "Add Question"}
          </DialogTitle>
          <DialogDescription>
            Add an objective question with four answer options by default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <RichTextEditor
              value={questionText}
              onChange={setQuestionText}
              placeholder="Supports bold/italic, alignment, images and $LaTeX$ equations"
              allowImages
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="marks">Marks</Label>
              <Input
                id="marks"
                type="number"
                min={0.01}
                step="0.01"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="negativeMarks">Negative Marks</Label>
              <Input
                id="negativeMarks"
                type="number"
                min={0}
                step="0.01"
                value={negativeMarks}
                onChange={(e) => setNegativeMarks(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Options (mark the correct one)</Label>
            {options.map((option, index) => (
              <div key={index} className="flex items-start gap-2">
                <Checkbox
                  checked={option.isCorrect}
                  onCheckedChange={() => setCorrectOption(index)}
                  aria-label={`Mark option ${index + 1} correct`}
                  className="mt-3"
                />
                <div className="flex-1">
                  <RichTextEditor
                    value={option.optionText}
                    onChange={(html) =>
                      updateOption(index, { optionText: html })
                    }
                    placeholder={`Option ${String.fromCharCode(65 + index)}`}
                    minHeight="60px"
                    allowImages
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(index)}
                  className="mt-1"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {options.length < 4 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add option
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving..." : "Save Question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
