"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { apiClient, ApiClientError, downloadFile } from "@/lib/api-client";
import { formatDateTime, toLocalDateTimeInputValue } from "@/lib/format-date";
import { dedupeByCourseCode, hasRealTitle } from "@/lib/course-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar } from "@/components/admin/pagination-bar";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  QuestionEditorDialog,
  QuestionRow,
} from "@/components/quiz/question-editor-dialog";
import { RichTextDisplay } from "@/components/quiz/rich-text-display";
import { Copy, Pencil, Play, Plus, Square, Trash2, Upload } from "lucide-react";

const CLIENT_PAGE_SIZE = 10;

function paginateClient<T>(rows: T[], page: number) {
  const total = rows.length;
  const start = (page - 1) * CLIENT_PAGE_SIZE;
  return { items: rows.slice(start, start + CLIENT_PAGE_SIZE), total, totalPages: Math.max(1, Math.ceil(total / CLIENT_PAGE_SIZE)) };
}

interface ImportRowResult {
  row: number;
  question: string;
  status: "added" | "skipped";
  reason?: string;
}

interface QuizDetail {
  id: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "completed";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalMarks: number;
  randomize: boolean;
  negativeMarking: boolean;
  allowSkipSwitch: boolean;
  requireLocation: boolean;
  courseCode: string;
  courseName: string;
  facultyRoll: string;
  sectionNames: string;
  building: { id: number; name: string };
  questions: (QuestionRow & { id: number })[];
  _count: { allotments: number };
}

interface BuildingOption {
  id: number;
  name: string;
}

interface CourseOption {
  subCode: string;
  title: string | null;
}

interface SectionOption {
  name: string;
}

interface AttemptEntry {
  student: { roll: string; name: string };
  allotmentStatus: "allotted" | "attempted" | "absent";
  isProxy: boolean;
  bypassLocation: boolean;
  attempt: {
    status: "in_progress" | "submitted" | "auto_submitted";
    startTime: string;
    endTime: string | null;
    autoSubmitted: boolean;
  } | null;
}

interface AttemptsResponse {
  totalAllotted: number;
  attemptedCount: number;
  notAttemptedCount: number;
  attempted: AttemptEntry[];
  notAttempted: AttemptEntry[];
}

interface SubjectiveAnswer {
  answerId: number;
  questionText: string;
  referenceAnswer: string | null;
  maxMarks: number;
  studentRoll: string;
  studentName: string;
  writtenAnswer: string | null;
  isSkipped: boolean;
  manuallyGraded: boolean;
  marksAwarded: number;
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  draft: "secondary",
  scheduled: "warning",
  live: "success",
  completed: "outline",
};

const typeLabel: Record<string, string> = {
  mcq: "MCQ",
  formula: "Formula",
  subjective: "Subjective",
};
const typeVariant: Record<string, "default" | "secondary" | "outline"> = {
  mcq: "default",
  formula: "secondary",
  subjective: "outline",
};

const fetcher = <T,>(url: string) => apiClient.get<T>(url);

export function QuizManagement({
  quizId,
  role,
}: {
  quizId: number;
  role: "faculty" | "admin";
}) {
  const router = useRouter();
  const basePath = role === "faculty" ? "/faculty/quizzes" : "/admin/tests";
  const listPath = role === "faculty" ? "/faculty/quizzes" : "/admin/tests";
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionRow | null>(
    null,
  );
  const [checkedRolls, setCheckedRolls] = useState<Set<string> | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [allotting, setAllotting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    facultyRoll: "",
    buildingId: "",
    startTime: "",
    endTime: "",
    durationMinutes: "",
    totalMarks: "",
    randomize: true,
    negativeMarking: false,
    allowSkipSwitch: true,
    requireLocation: true,
  });
  const [editCourseCode, setEditCourseCode] = useState("");
  const [editSectionNames, setEditSectionNames] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(null);

  const {
    data: quiz,
    isLoading,
    mutate,
  } = useSWR(`/api/faculty/quiz/${quizId}`, (url: string) =>
    fetcher<QuizDetail>(url),
  );
  const { data: buildingsData } = useSWR(
    editDialogOpen ? `/api/faculty/buildings` : null,
    (url: string) => fetcher<{ items: BuildingOption[] }>(url),
  );
  // Course/section pickers for the edit dialog mirror the create form: the
  // course list is scoped to whichever faculty the quiz is currently
  // assigned to (editable above, for admins), and sections are scoped to
  // the chosen course.
  const editCoursesUrl = editDialogOpen
    ? role === "admin"
      ? editForm.facultyRoll
        ? `/api/faculty/courses?facultyRoll=${encodeURIComponent(editForm.facultyRoll)}`
        : null
      : `/api/faculty/courses`
    : null;
  const { data: editCoursesData, isLoading: editCoursesLoading } = useSWR(
    editCoursesUrl,
    (url: string) => fetcher<{ items: CourseOption[] }>(url),
  );
  const editCourses = dedupeByCourseCode(
    (editCoursesData?.items ?? []).filter((c) => hasRealTitle(c)),
  );
  const editSelectedCourse = editCourses.find((c) => c.subCode === editCourseCode);
  // Sourced live from isr_sub_available_tbl (real per-branch sections), not
  // the app's own section_courses/section_faculty tables - see the create
  // form's identical switch to /api/faculty/quiz-sections.
  const editSectionsUrl =
    editDialogOpen && editSelectedCourse?.subCode
      ? role === "admin"
        ? editForm.facultyRoll
          ? `/api/faculty/quiz-sections?subCode=${encodeURIComponent(editSelectedCourse.subCode)}&facultyRoll=${encodeURIComponent(editForm.facultyRoll)}`
          : null
        : `/api/faculty/quiz-sections?subCode=${encodeURIComponent(editSelectedCourse.subCode)}`
      : null;
  const { data: editSectionsData } = useSWR(
    editSectionsUrl,
    (url: string) => fetcher<{ items: SectionOption[] }>(url),
  );
  const editSections = editSectionsData?.items ?? [];
  const [subjectivePage, setSubjectivePage] = useState(1);
  const [questionsPage, setQuestionsPage] = useState(1);
  const { data: subjectiveData, mutate: mutateSubjective } = useSWR(
    quiz?.status === "completed"
      ? `/api/faculty/quiz/${quizId}/subjective-answers`
      : null,
    (url: string) =>
      fetcher<{ items: SubjectiveAnswer[]; ungradedCount: number }>(url),
  );
  const { data: resultsData, mutate: mutateResults } = useSWR(
    quiz?.status === "completed" ? `/api/faculty/quiz/${quizId}/results` : null,
    (url: string) =>
      fetcher<{
        quiz: {
          id: number;
          title: string;
          totalMarks: number;
          status: string;
          courseCode: string;
          courseName: string;
          building: { name: string };
        };
        summary: {
          totalAllotted: number;
          attemptedCount: number;
          submittedCount: number;
          notAttemptedCount: number;
          absentCount: number;
          declaredCount: number;
          publishedCount: number;
          ungradedCount: number;
        };
        questionBreakdown: Array<{
          id: number;
          questionText: string;
          questionType: string;
          marks: number;
          answerKey: string;
          attemptedCount: number;
          correctCount: number;
          wrongCount: number;
          skippedCount: number;
        }>;
        studentResults: Array<{
          roll: string;
          name: string;
          attendanceStatus: string;
          attemptStatus: string | null;
          marksObtained: number;
          percentage: number;
          resultStatus: string;
        }>;
      }>(url),
  );
  // Keyed off the live edit-dialog course/section (and, for admins, faculty)
  // selection - not the quiz's persisted values - so picking a different
  // course/section re-maps the roster immediately, same as the Create Quiz
  // picker's studentsUrl. Falls back to nothing until a course+section are
  // selected, matching Create's studentsUrl gating.
  const candidatesUrl =
    editDialogOpen && editSectionNames.length > 0 && editSelectedCourse?.subCode
      ? role === "admin"
        ? editForm.facultyRoll
          ? `/api/faculty/quiz/${quizId}/allot/candidates?subCode=${encodeURIComponent(editSelectedCourse.subCode)}&sectionNames=${editSectionNames.join(",")}&facultyRoll=${encodeURIComponent(editForm.facultyRoll)}`
          : null
        : `/api/faculty/quiz/${quizId}/allot/candidates?subCode=${encodeURIComponent(editSelectedCourse.subCode)}&sectionNames=${editSectionNames.join(",")}`
      : null;
  const { data: candidatesData, mutate: mutateCandidates } = useSWR(
    candidatesUrl,
    (url: string) =>
      fetcher<{ items: { roll: string; name: string; allotted: boolean }[] }>(
        url,
      ),
  );
  // Every real registrant for this course/section, whether already allotted
  // or not - one unified checkbox list, same as the Create Quiz picker.
  // Default-checked state is "currently allotted" (not "everyone"), so
  // opening this dialog shows the real live roster, not a fresh blank slate.
  const allRealStudents = candidatesData?.items ?? [];
  const effectiveChecked =
    checkedRolls ?? new Set(allRealStudents.filter((c) => c.allotted).map((c) => c.roll));

  // Reset stale checkbox/search state whenever the course or section
  // selection changes, e.g. switching sections mid-edit - same convention
  // as the Create Quiz picker's identical reset effect.
  useEffect(() => {
    setCheckedRolls(null);
    setCandidateSearch("");
  }, [editCourseCode, editSectionNames.join(",")]);

  // Polls only while the quiz is actually live, so submission status/proxy
  // state on screen tracks what's really happening in real time.
  const { data: attemptsData, mutate: mutateAttempts } = useSWR(
    quiz?.status === "live" ? `/api/faculty/quiz/${quizId}/attempts` : null,
    (url: string) => fetcher<AttemptsResponse>(url),
    { refreshInterval: 8000 },
  );

  if (isLoading || !quiz) {
    return <p className="text-sm text-muted-foreground">Loading quiz...</p>;
  }

  const openEditDialog = () => {
    setEditForm({
      title: quiz.title,
      facultyRoll: quiz.facultyRoll,
      buildingId: String(quiz.building.id),
      startTime: toLocalDateTimeInputValue(quiz.startTime),
      endTime: toLocalDateTimeInputValue(quiz.endTime),
      durationMinutes: String(quiz.durationMinutes),
      totalMarks: String(quiz.totalMarks),
      randomize: quiz.randomize,
      negativeMarking: quiz.negativeMarking,
      allowSkipSwitch: quiz.allowSkipSwitch,
      requireLocation: quiz.requireLocation,
    });
    setEditCourseCode(quiz.courseCode);
    setEditSectionNames(quiz.sectionNames.split(",").filter(Boolean));
    // Clear any unsaved checkbox/search state from a previous time this
    // dialog was open - otherwise reopening on the same course/section
    // (which wouldn't trigger the change-reset effect) could show stale,
    // unsaved edits instead of today's real allotment.
    setCheckedRolls(null);
    setCandidateSearch("");
    setEditDialogOpen(true);
  };

  const handleSaveDetails = async () => {
    if (!editForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const duration = Number(editForm.durationMinutes);
    const marks = Number(editForm.totalMarks);
    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error("Duration must be a positive number of minutes");
      return;
    }
    if (!Number.isFinite(marks) || marks <= 0) {
      toast.error("Total marks must be a positive number");
      return;
    }
    if (role === "admin" && !editForm.facultyRoll.trim()) {
      toast.error("Faculty roll is required");
      return;
    }
    if (!editSelectedCourse) {
      toast.error("Select a valid course");
      return;
    }
    if (editSectionNames.length === 0) {
      toast.error("Select at least one section");
      return;
    }
    setSavingDetails(true);
    try {
      await apiClient.patch(`/api/faculty/quiz/${quizId}`, {
        title: editForm.title.trim(),
        // Reassignment is admin-only server-side too; only send it as admin
        // so a faculty member's save never trips the 403 for a field they
        // can't see or touch.
        ...(role === "admin" ? { facultyRoll: editForm.facultyRoll.trim() } : {}),
        courseCode: editSelectedCourse.subCode,
        sectionNames: editSectionNames,
        buildingId: Number(editForm.buildingId),
        startTime: new Date(editForm.startTime).toISOString(),
        endTime: new Date(editForm.endTime).toISOString(),
        durationMinutes: duration,
        totalMarks: marks,
        randomize: editForm.randomize,
        negativeMarking: editForm.negativeMarking,
        allowSkipSwitch: editForm.allowSkipSwitch,
        requireLocation: editForm.requireLocation,
      });
      toast.success("Quiz details updated");
      setEditDialogOpen(false);
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Failed to update quiz details",
      );
    } finally {
      setSavingDetails(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      const copy = await apiClient.post<{ id: number }>(
        `/api/faculty/quiz/${quizId}/duplicate`,
      );
      toast.success("Quiz duplicated");
      router.push(`${basePath}/${copy.id}`);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to duplicate quiz",
      );
    }
  };

  const handleStartQuiz = async () => {
    try {
      await apiClient.post(`/api/faculty/quiz/${quizId}/start`);
      toast.success("Quiz started");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Failed to start quiz",
      );
    }
  };

  const handleStopQuiz = async () => {
    try {
      await apiClient.post(`/api/faculty/quiz/${quizId}/stop`);
      toast.success("Quiz stopped");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Failed to stop quiz",
      );
    }
  };

  const handleDeleteQuiz = async () => {
    try {
      await apiClient.delete(`/api/faculty/quiz/${quizId}`);
      toast.success("Quiz deleted");
      router.push(listPath);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to delete quiz",
      );
    }
  };

  const handleDeleteQuestion = async (id: number) => {
    try {
      // No single-question delete endpoint - re-post the remaining question set.
      const remaining = quiz.questions.filter((q) => q.id !== id);
      await apiClient.post(`/api/faculty/quiz/${quizId}/questions`, {
        questions: remaining.map((q) => {
          const base = {
            id: q.id,
            questionText: q.questionText,
            marks: q.marks,
            orderIndex: q.orderIndex,
          };
          if (q.questionType === "mcq") {
            return {
              ...base,
              questionType: "mcq",
              negativeMarks: q.negativeMarks,
              options: q.options,
            };
          }
          if (q.questionType === "formula") {
            return {
              ...base,
              questionType: "formula",
              negativeMarks: q.negativeMarks,
              correctValue: q.formula?.correctValue ?? 0,
              tolerance: q.formula?.tolerance ?? 0,
            };
          }
          return {
            ...base,
            questionType: "subjective",
            referenceAnswer: q.referenceAnswer ?? undefined,
          };
        }),
      });
      toast.success("Question removed");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to remove question",
      );
    }
  };

  const toggleCandidate = (roll: string, checked: boolean) => {
    const next = new Set(effectiveChecked);
    if (checked) next.add(roll);
    else next.delete(roll);
    setCheckedRolls(next);
  };

  const visibleStudents = allRealStudents.filter((c) => {
    const q = candidateSearch.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.roll.toLowerCase().includes(q);
  });

  // Check all / Uncheck all only ever act on the currently visible (searched)
  // rows - same convention as the Create Quiz picker.
  const checkAllVisible = () => {
    const next = new Set(effectiveChecked);
    visibleStudents.forEach((c) => next.add(c.roll));
    setCheckedRolls(next);
  };
  const uncheckAllVisible = () => {
    const next = new Set(effectiveChecked);
    visibleStudents.forEach((c) => next.delete(c.roll));
    setCheckedRolls(next);
  };

  const handleAllot = async () => {
    const studentRolls = [...effectiveChecked];
    setAllotting(true);
    try {
      const result = await apiClient.post<{
        addedCount: number;
        removedCount: number;
        blockedRemovalCount: number;
        totalAllotted: number;
      }>(`/api/faculty/quiz/${quizId}/allot`, { studentRolls });
      const parts = [];
      if (result.addedCount > 0) parts.push(`${result.addedCount} added`);
      if (result.removedCount > 0) parts.push(`${result.removedCount} removed`);
      toast.success(
        parts.length > 0
          ? `Allotment updated - ${parts.join(", ")} (${result.totalAllotted} total)`
          : `No changes - ${result.totalAllotted} student(s) allotted`,
      );
      if (result.blockedRemovalCount > 0) {
        toast.error(
          `${result.blockedRemovalCount} student(s) couldn't be removed - they've already attempted this quiz`,
        );
      }
      setCheckedRolls(null);
      mutate();
      mutateCandidates();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to update allotment",
      );
    } finally {
      setAllotting(false);
    }
  };

  const handleToggleProxy = async (roll: string, currentlyProxy: boolean) => {
    try {
      if (currentlyProxy) {
        await apiClient.delete(
          `/api/faculty/quiz/${quizId}/allotments/${encodeURIComponent(roll)}/proxy`,
        );
        toast.success(`${roll} restored to real attendance`);
      } else {
        await apiClient.post(
          `/api/faculty/quiz/${quizId}/allotments/${encodeURIComponent(roll)}/proxy`,
        );
        toast.success(`${roll} flagged as proxy - counted as absent`);
      }
      mutateAttempts();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to update proxy flag",
      );
    }
  };

  const handleReopenAttempt = async (roll: string) => {
    try {
      await apiClient.post(
        `/api/faculty/quiz/${quizId}/allotments/${encodeURIComponent(roll)}/reopen-attempt`,
      );
      toast.success(`${roll}'s attempt reopened - they can resume now`);
      mutateAttempts();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to reopen attempt",
      );
    }
  };

  const handleToggleLocationBypass = async (
    roll: string,
    currentlyBypassed: boolean,
  ) => {
    try {
      if (currentlyBypassed) {
        await apiClient.delete(
          `/api/faculty/quiz/${quizId}/allotments/${encodeURIComponent(roll)}/location-bypass`,
        );
        toast.success(`${roll} must now be at the required location`);
      } else {
        await apiClient.post(
          `/api/faculty/quiz/${quizId}/allotments/${encodeURIComponent(roll)}/location-bypass`,
        );
        toast.success(`${roll} can now start from anywhere`);
      }
      mutateAttempts();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to update location bypass",
      );
    }
  };

  const handleImportFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    setImporting(true);
    try {
      const result = await apiClient.post<{
        addedCount: number;
        skippedCount: number;
        results: ImportRowResult[];
      }>(`/api/faculty/quiz/${quizId}/questions/import`, formData);
      toast.success(
        `Imported ${result.addedCount} question(s), skipped ${result.skippedCount}`,
      );
      // Show the full per-row breakdown whenever anything was skipped - the
      // reason (bad marks, duplicate, answer doesn't match a filled option,
      // etc.) is otherwise invisible, which made partial imports look like a
      // silent failure instead of a specific, fixable row problem.
      if (result.skippedCount > 0) setImportResults(result.results);
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Import failed",
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const pagedSubjective = paginateClient(subjectiveData?.items ?? [], subjectivePage);
  const pagedQuestions = paginateClient(quiz?.questions ?? [], questionsPage);

  const handleGrade = async (answerId: number, marksAwarded: number) => {
    try {
      await apiClient.patch(
        `/api/faculty/quiz/${quizId}/subjective-answers/${answerId}`,
        { marksAwarded },
      );
      toast.success("Grade saved");
      mutateSubjective();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to save grade",
      );
    }
  };

  const handlePublishResult = async () => {
    try {
      const result = await apiClient.post<{ publishedCount: number }>(
        `/api/faculty/quiz/${quizId}/publish-result`,
      );
      toast.success(
        `Published results for ${result.publishedCount} student(s)`,
      );
      mutateResults();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Failed to publish results",
      );
    }
  };

  const questionColumns: DataTableColumn<QuestionRow & { id: number }>[] = [
    {
      key: "questionText",
      header: "Question",
      render: (r) => (
        <RichTextDisplay
          html={r.questionText}
          className="line-clamp-2 max-w-md"
        />
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <Badge variant={typeVariant[r.questionType]}>
          {typeLabel[r.questionType]}
        </Badge>
      ),
    },
    { key: "marks", header: "Marks", render: (r) => r.marks },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={!canEditQuestions}
            onClick={() => {
              setEditingQuestion(r);
              setQuestionDialogOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" disabled={!canEditQuestions}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            }
            title="Remove question?"
            description="This removes it from the quiz. This cannot be undone."
            confirmLabel="Remove"
            onConfirm={() => handleDeleteQuestion(r.id)}
          />
        </div>
      ),
    },
  ];

  const canEditQuestions =
    quiz.status === "draft" || quiz.status === "scheduled";
  const canDeleteQuiz = quiz.status !== "live" && quiz.status !== "completed";
  const allottedCount = quiz._count.allotments;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 space-y-0 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{quiz.title}</CardTitle>
              <Badge variant={statusVariant[quiz.status]}>{quiz.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {quiz.courseName} ({quiz.courseCode}) · Section:{" "}
              {quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—"} ·{" "}
              {quiz.building.name} · {formatDateTime(quiz.startTime)} –{" "}
              {formatDateTime(quiz.endTime)} · {quiz.totalMarks} marks
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
            {(quiz.status === "draft" || quiz.status === "scheduled") && (
              <ConfirmDialog
                trigger={
                  <Button size="sm">
                    <Play className="mr-2 h-4 w-4" />
                    Start Quiz
                  </Button>
                }
                title="Start this quiz?"
                description="Students who are allotted this quiz will be able to begin their attempt immediately."
                confirmLabel="Start Quiz"
                onConfirm={handleStartQuiz}
              />
            )}
            {quiz.status === "live" && (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    <Square className="mr-2 h-4 w-4" />
                    Stop Quiz
                  </Button>
                }
                title="Stop this quiz?"
                description="This auto-submits every in-progress attempt with its current answers and marks any allotted student who never started as absent. This cannot be undone."
                confirmLabel="Stop Quiz"
                onConfirm={handleStopQuiz}
              />
            )}
            {canEditQuestions && (
              <Button size="sm" variant="outline" onClick={openEditDialog}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Details
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleDuplicate}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate
            </Button>
            {quiz.status !== "live" && (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="outline" disabled={!canDeleteQuiz}>
                    <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                    Delete
                  </Button>
                }
                title="Delete this quiz?"
                description="This removes the quiz and its questions. This cannot be undone."
                confirmLabel="Delete"
                onConfirm={handleDeleteQuiz}
              />
            )}
          </div>
        </CardHeader>
      </Card>

      {quiz.status === "live" && (
        <LiveMonitoringCard
          data={attemptsData}
          onToggleProxy={handleToggleProxy}
          onToggleLocationBypass={handleToggleLocationBypass}
          onReopenAttempt={handleReopenAttempt}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Questions</CardTitle>
          {canEditQuestions && (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadFile(
                    "/api/faculty/questions/import-template",
                    "question-import-template.xlsx",
                  )
                }
              >
                Download Template
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {importing ? "Importing..." : "Bulk Import"}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingQuestion(null);
                  setQuestionDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Question
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            columns={questionColumns}
            rows={pagedQuestions.items}
            rowKey={(r) => r.id}
            emptyMessage="No questions yet - add one or bulk import from Excel."
          />
          {quiz.questions.length > 0 && (
            <PaginationBar
              page={questionsPage}
              totalPages={pagedQuestions.totalPages}
              total={pagedQuestions.total}
              pageSize={CLIENT_PAGE_SIZE}
              onPageChange={setQuestionsPage}
            />
          )}
        </CardContent>
      </Card>

      {quiz.status === "completed" && resultsData && (
        <ResultsReportCard data={resultsData} />
      )}

      {quiz.status === "completed" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">
              Grading{" "}
              {subjectiveData && subjectiveData.ungradedCount > 0 && (
                <Badge variant="warning" className="ml-2">
                  {subjectiveData.ungradedCount} need grading
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" onClick={handlePublishResult}>
                Publish Result
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(subjectiveData?.items ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No subjective answers to grade for this quiz.
              </p>
            )}
            {pagedSubjective.items.map((a) => (
              <SubjectiveAnswerRow
                key={a.answerId}
                answer={a}
                onGrade={handleGrade}
              />
            ))}
            {(subjectiveData?.items ?? []).length > 0 && (
              <PaginationBar
                page={subjectivePage}
                totalPages={pagedSubjective.totalPages}
                total={pagedSubjective.total}
                pageSize={CLIENT_PAGE_SIZE}
                onPageChange={setSubjectivePage}
              />
            )}
          </CardContent>
        </Card>
      )}

      <QuestionEditorDialog
        open={questionDialogOpen}
        onOpenChange={setQuestionDialogOpen}
        quizId={quizId}
        nextOrderIndex={quiz.questions.length}
        editing={editingQuestion}
        onSaved={mutate}
      />

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Quiz Details</DialogTitle>
            <DialogDescription>
              Update the quiz&apos;s title, course, sections, timing, building, and rules — allowed even while the
              quiz is live. Questions aren&apos;t editable here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            {role === "admin" && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-faculty-roll">Faculty roll</Label>
                <Input
                  id="edit-faculty-roll"
                  value={editForm.facultyRoll}
                  onChange={(e) => setEditForm((f) => ({ ...f, facultyRoll: e.target.value }))}
                  placeholder="e.g. RF0223"
                />
                <p className="text-xs text-muted-foreground">
                  Reassign this quiz to a different faculty member — allowed even while the quiz is live.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={editCourseCode || null}
                onValueChange={setEditCourseCode}
                options={editCourses.map((c) => ({
                  value: c.subCode,
                  label: `${c.title ?? c.subCode} (${c.subCode})`,
                }))}
                placeholder={editCoursesLoading ? "Loading..." : "Select a course"}
                searchPlaceholder="Search courses..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sections</Label>
              {!editCourseCode && (
                <p className="text-xs text-muted-foreground">Select a course first.</p>
              )}
              {editCourseCode && editSections.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sections found for this course yet.
                </p>
              )}
              {editSections.length > 0 && (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                  {editSections.map((section) => (
                    <div key={section.name} className="flex items-center gap-2">
                      <Checkbox
                        checked={editSectionNames.includes(section.name)}
                        onCheckedChange={(checked) => {
                          setEditSectionNames((prev) =>
                            checked === true
                              ? prev.includes(section.name) ? prev : [...prev, section.name]
                              : prev.filter((name) => name !== section.name)
                          );
                        }}
                        id={`edit-section-${section.name}`}
                      />
                      <label htmlFor={`edit-section-${section.name}`} className="text-sm">
                        {section.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Building</Label>
              <SearchableSelect
                value={editForm.buildingId || null}
                onValueChange={(v) => setEditForm((f) => ({ ...f, buildingId: v }))}
                options={(buildingsData?.items ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
                placeholder="Select a building"
                searchPlaceholder="Search buildings..."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-start">Start Time</Label>
                <Input
                  id="edit-start"
                  type="datetime-local"
                  value={editForm.startTime}
                  onChange={(e) => setEditForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-end">End Time</Label>
                <Input
                  id="edit-end"
                  type="datetime-local"
                  value={editForm.endTime}
                  onChange={(e) => setEditForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-duration">Duration (minutes)</Label>
                <Input
                  id="edit-duration"
                  type="number"
                  min={1}
                  value={editForm.durationMinutes}
                  onChange={(e) => setEditForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-marks">Total Marks</Label>
              <Input
                id="edit-marks"
                type="number"
                min={1}
                className="max-w-xs"
                value={editForm.totalMarks}
                onChange={(e) => setEditForm((f) => ({ ...f, totalMarks: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-randomize" className="text-sm font-normal">
                  Randomize order
                </Label>
                <Switch
                  id="edit-randomize"
                  checked={editForm.randomize}
                  onCheckedChange={(v) => setEditForm((f) => ({ ...f, randomize: v }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-negative" className="text-sm font-normal">
                  Negative marking
                </Label>
                <Switch
                  id="edit-negative"
                  checked={editForm.negativeMarking}
                  onCheckedChange={(v) => setEditForm((f) => ({ ...f, negativeMarking: v }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-skip" className="text-sm font-normal">
                  Allow skip/switch
                </Label>
                <Switch
                  id="edit-skip"
                  checked={editForm.allowSkipSwitch}
                  onCheckedChange={(v) => setEditForm((f) => ({ ...f, allowSkipSwitch: v }))}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="edit-location" className="text-sm font-normal">
                  Require GPS
                </Label>
                <Switch
                  id="edit-location"
                  checked={editForm.requireLocation}
                  onCheckedChange={(v) => setEditForm((f) => ({ ...f, requireLocation: v }))}
                />
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label>
                  Allotted Students ({effectiveChecked.size}
                  {allRealStudents.length > 0 ? ` of ${allRealStudents.length} real registrants` : ""})
                </Label>
                {quiz.status !== "completed" && visibleStudents.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={checkAllVisible}
                      disabled={visibleStudents.every((c) => effectiveChecked.has(c.roll))}
                    >
                      Check all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={uncheckAllVisible}
                      disabled={visibleStudents.every((c) => !effectiveChecked.has(c.roll))}
                    >
                      Uncheck all
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Live, real registrants for this course/section - check to allot, uncheck to remove. A student who
                has already attempted this quiz can&apos;t be removed.
              </p>
              {allRealStudents.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">
                  No real registrants found for this course/section.
                </p>
              ) : (
                <>
                  <Input
                    placeholder="Search students by name or roll..."
                    value={candidateSearch}
                    onChange={(e) => setCandidateSearch(e.target.value)}
                  />
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {visibleStudents.length === 0 && (
                      <p className="p-2 text-xs text-muted-foreground">No students match &quot;{candidateSearch}&quot;.</p>
                    )}
                    {visibleStudents.map((c) => (
                      <div
                        key={c.roll}
                        className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={effectiveChecked.has(c.roll)}
                            onCheckedChange={(checked) =>
                              toggleCandidate(c.roll, checked === true)
                            }
                            disabled={quiz.status === "completed"}
                            id={`student-${c.roll}`}
                          />
                          <label htmlFor={`student-${c.roll}`} className="text-sm">
                            {c.name}{" "}
                            <span className="text-muted-foreground">({c.roll})</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  {quiz.status !== "completed" && (
                    <Button type="button" size="sm" onClick={handleAllot} disabled={allotting}>
                      {allotting ? "Updating..." : "Update Allotment"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDetails} disabled={savingDetails}>
              {savingDetails ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importResults !== null} onOpenChange={(open) => !open && setImportResults(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk import results</DialogTitle>
            <DialogDescription>
              Every row is processed independently - here&apos;s exactly what happened to each one.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {(importResults ?? []).map((r) => (
              <div key={r.row} className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    Row {r.row}
                    {r.question && <span className="font-normal text-muted-foreground"> — {r.question}</span>}
                  </p>
                  {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
                </div>
                <Badge variant={r.status === "added" ? "success" : "destructive"} className="shrink-0">
                  {r.status}
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setImportResults(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function attemptStatusLabel(entry: AttemptEntry): string {
  if (!entry.attempt) return "Not started";
  if (entry.attempt.status === "in_progress") return "In progress";
  if (entry.attempt.status === "auto_submitted") return "Auto-submitted";
  return "Submitted";
}

function attemptStatusVariant(
  entry: AttemptEntry,
): "secondary" | "warning" | "success" {
  if (!entry.attempt) return "secondary";
  if (entry.attempt.status === "in_progress") return "warning";
  return "success";
}

function LiveMonitoringCard({
  data,
  onToggleProxy,
  onToggleLocationBypass,
  onReopenAttempt,
}: {
  data: AttemptsResponse | undefined;
  onToggleProxy: (roll: string, currentlyProxy: boolean) => void;
  onToggleLocationBypass: (roll: string, currentlyBypassed: boolean) => void;
  onReopenAttempt: (roll: string) => void;
}) {
  const [page, setPage] = useState(1);
  const entries = [
    ...(data?.attempted ?? []),
    ...(data?.notAttempted ?? []),
  ].sort((a, b) => a.student.name.localeCompare(b.student.name));
  const paged = paginateClient(entries, page);
  const inProgressCount = entries.filter(
    (e) => e.attempt?.status === "in_progress",
  ).length;
  const submittedCount = entries.filter(
    (e) =>
      e.attempt?.status === "submitted" ||
      e.attempt?.status === "auto_submitted",
  ).length;
  const notStartedCount = entries.filter((e) => !e.attempt).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Live Monitoring</CardTitle>
        <p className="text-sm text-muted-foreground">
          {notStartedCount} not started · {inProgressCount} in progress ·{" "}
          {submittedCount} submitted. Refreshes every 8 seconds.
        </p>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students allotted to this quiz yet.
          </p>
        ) : (
          <div className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
            {paged.items.map((entry) => (
              <div
                key={entry.student.roll}
                className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{entry.student.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({entry.student.roll})
                  </span>
                  <Badge variant={attemptStatusVariant(entry)}>
                    {attemptStatusLabel(entry)}
                  </Badge>
                  {entry.isProxy && (
                    <Badge variant="destructive">Proxy (absent)</Badge>
                  )}
                  {entry.bypassLocation && (
                    <Badge variant="outline">Location bypassed</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={entry.bypassLocation ? "outline" : "secondary"}
                    onClick={() =>
                      onToggleLocationBypass(
                        entry.student.roll,
                        entry.bypassLocation,
                      )
                    }
                  >
                    {entry.bypassLocation
                      ? "Require Location"
                      : "Bypass Location"}
                  </Button>
                  <Button
                    size="sm"
                    variant={entry.isProxy ? "outline" : "destructive"}
                    onClick={() =>
                      onToggleProxy(entry.student.roll, entry.isProxy)
                    }
                  >
                    {entry.isProxy ? "Remove Proxy" : "Mark Proxy"}
                  </Button>
                  {entry.attempt?.status === "auto_submitted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReopenAttempt(entry.student.roll)}
                    >
                      Re-enable Attempt
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {entries.length > 0 && (
          <PaginationBar
            page={page}
            totalPages={paged.totalPages}
            total={paged.total}
            pageSize={CLIENT_PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ResultsReportCard({
  data,
}: {
  data: {
    quiz: {
      id: number;
      title: string;
      totalMarks: number;
      status: string;
      courseCode: string;
      courseName: string;
      building: { name: string };
    };
    summary: {
      totalAllotted: number;
      attemptedCount: number;
      submittedCount: number;
      notAttemptedCount: number;
      absentCount: number;
      declaredCount: number;
      publishedCount: number;
      ungradedCount: number;
    };
    questionBreakdown: Array<{
      id: number;
      questionText: string;
      questionType: string;
      marks: number;
      answerKey: string;
      attemptedCount: number;
      correctCount: number;
      wrongCount: number;
      skippedCount: number;
    }>;
    studentResults: Array<{
      roll: string;
      name: string;
      attendanceStatus: string;
      attemptStatus: string | null;
      marksObtained: number;
      percentage: number;
      resultStatus: string;
    }>;
  };
}) {
  const summaryItems = [
    { label: "Allotted", value: data.summary.totalAllotted },
    { label: "Submitted", value: data.summary.submittedCount },
    { label: "Not attempted", value: data.summary.notAttemptedCount },
    { label: "Absent", value: data.summary.absentCount },
    { label: "Published", value: data.summary.publishedCount },
    { label: "Needs grading", value: data.summary.ungradedCount },
  ];

  const [resultsPage, setResultsPage] = useState(1);
  const pagedResults = paginateClient(data.studentResults, resultsPage);

  const resultColumns: DataTableColumn<(typeof data.studentResults)[number]>[] =
    [
      {
        key: "name",
        header: "Student",
        render: (row) => <span className="font-medium">{row.name}</span>,
      },
      { key: "roll", header: "Roll", render: (row) => row.roll },
      {
        key: "attendanceStatus",
        header: "Attendance",
        render: (row) => (
          <Badge variant="secondary">{row.attendanceStatus}</Badge>
        ),
      },
      {
        key: "marks",
        header: "Marks",
        render: (row) =>
          `${row.marksObtained.toFixed(0)} / ${data.quiz.totalMarks}`,
      },
      {
        key: "percentage",
        header: "%",
        render: (row) => `${row.percentage.toFixed(2)}%`,
      },
      {
        key: "resultStatus",
        header: "Result",
        render: (row) => <Badge variant="outline">{row.resultStatus}</Badge>,
      },
    ];

  const questionColumns: DataTableColumn<
    (typeof data.questionBreakdown)[number]
  >[] = [
    {
      key: "question",
      header: "Question",
      render: (row) => (
        <div className="max-w-md">
          <RichTextDisplay html={row.questionText} className="line-clamp-3" />
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => (
        <Badge variant="secondary">
          {typeLabel[row.questionType] ?? row.questionType}
        </Badge>
      ),
    },
    { key: "marks", header: "Marks", render: (row) => row.marks },
    {
      key: "attempted",
      header: "Attempted",
      render: (row) => row.attemptedCount,
    },
    { key: "correct", header: "Correct", render: (row) => row.correctCount },
    { key: "wrong", header: "Wrong", render: (row) => row.wrongCount },
    { key: "skipped", header: "Skipped", render: (row) => row.skippedCount },
    {
      key: "answerKey",
      header: "Answer key",
      render: (row) => (
        <span className="max-w-xs whitespace-pre-wrap text-sm">
          {row.answerKey}
        </span>
      ),
    },
  ];

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="text-lg">Results & Report</CardTitle>
        <p className="text-sm text-muted-foreground">
          {data.quiz.courseName} ({data.quiz.courseCode}) ·{" "}
          {data.quiz.building.name}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="text-2xl font-semibold">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Question-wise breakdown</h3>
          <DataTable
            columns={questionColumns}
            rows={data.questionBreakdown}
            rowKey={(row) => row.id}
            emptyMessage="No question breakdown available yet."
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Student result summary</h3>
          <DataTable
            columns={resultColumns}
            rows={pagedResults.items}
            rowKey={(row) => row.roll}
            emptyMessage="No students have results yet."
          />
          {data.studentResults.length > 0 && (
            <PaginationBar
              page={resultsPage}
              totalPages={pagedResults.totalPages}
              total={pagedResults.total}
              pageSize={CLIENT_PAGE_SIZE}
              onPageChange={setResultsPage}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SubjectiveAnswerRow({
  answer,
  onGrade,
}: {
  answer: SubjectiveAnswer;
  onGrade: (answerId: number, marksAwarded: number) => void;
}) {
  const [value, setValue] = useState(String(answer.marksAwarded));

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {answer.studentName} ({answer.studentRoll})
        </p>
        {answer.manuallyGraded && <Badge variant="success">Graded</Badge>}
        {answer.isSkipped && <Badge variant="secondary">Skipped</Badge>}
      </div>
      <RichTextDisplay
        html={answer.questionText}
        className="mt-1 text-muted-foreground"
      />
      <p className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-sm">
        {answer.writtenAnswer || (
          <span className="italic text-muted-foreground">
            No answer written
          </span>
        )}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={answer.maxMarks}
          step="0.5"
          className="w-24"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          / {answer.maxMarks}
        </span>
        <Button
          size="sm"
          onClick={() => onGrade(answer.answerId, Number(value))}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
