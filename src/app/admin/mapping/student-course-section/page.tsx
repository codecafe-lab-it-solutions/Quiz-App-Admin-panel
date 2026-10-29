"use client";

import { useState } from "react";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Plus, Trash2 } from "lucide-react";

interface Registration {
  roll: string;
  subCode: string;
  batch?: string;
  major: string | null;
  semNow: string | null;
  sections: { name: string }[];
}

interface ListResponse {
  items: Registration[];
  isDefault: boolean;
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

interface BatchOption {
  batchName: string;
  isActive: boolean;
}
interface StudentSearchOption {
  roll: string;
  name: string;
  major: string;
  batch: string;
  semNow: string;
}
interface RealCourseOption {
  code: string;
  title: string;
}

const fetcher = (url: string) => apiClient.get<ListResponse>(url);
const semesterConfigFetcher = (url: string) =>
  apiClient.get<{ batchRegistry: BatchOption[] }>(url);
const studentSearchFetcher = (url: string) =>
  apiClient.get<{ items: StudentSearchOption[] }>(url);
const realCourseFetcher = (url: string) => apiClient.get<{ items: RealCourseOption[] }>(url);

const schema = z.object({
  roll: z.string().trim().min(1, "Student roll is required"),
  subCode: z.string().trim().min(1, "Course code is required"),
});
type FormValues = z.infer<typeof schema>;

const ALL = "__all__";

export default function StudentMappingPage() {
  const [roll, setRoll] = useState("");
  const [courseCode, setCourseCode] = useState(ALL);
  const [batch, setBatch] = useState(ALL);
  const [sectionName, setSectionName] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Real course catalog for the browse filter - same source the Add Mapping
  // dialog's course picker uses, fetched unconditionally here (not gated on
  // dialogOpen) since the filter panel is always visible.
  const { data: browseCourseData } = useSWR(
    "/api/admin/mapping/faculty-course-section/courses?pageSize=200",
    realCourseFetcher,
  );
  const { data: semesterConfig } = useSWR("/api/admin/config/semester", semesterConfigFetcher);
  const batches = (semesterConfig?.batchRegistry ?? []).filter((b) => b.isActive);

  // Roll search takes priority - it's an exact student lookup, so it
  // overrides any browse filters. Otherwise the course/batch/section
  // dropdowns combine as filters on a bounded browse. No search or filter
  // still fires - the route returns a bounded "recently registered" default
  // list instead of nothing, so the page shows real, interconnected data
  // immediately.
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (roll.trim()) {
    params.set("roll", roll.trim());
  } else {
    if (courseCode !== ALL) params.set("courseCode", courseCode);
    if (batch !== ALL) params.set("batch", batch);
    if (sectionName.trim()) params.set("sectionName", sectionName.trim());
  }
  const query = params.toString();

  const { data, isLoading, mutate } = useSWR(
    `/api/admin/mapping/student-course-section?${query}`,
    fetcher,
  );

  const {
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const dialogRoll = watch("roll");
  const dialogSubCode = watch("subCode");

  // Student dropdown - server-searched, real isr_stu_main_tbl rolls only.
  const [studentSearch, setStudentSearch] = useState("");
  const studentSearchDebounced = useDebouncedValue(studentSearch, 250);
  const { data: studentSearchData, isLoading: studentSearchLoading } = useSWR(
    dialogOpen
      ? `/api/admin/students?search=${encodeURIComponent(studentSearchDebounced)}&pageSize=20`
      : null,
    studentSearchFetcher,
  );
  const studentOptions: SearchableSelectOption[] = (studentSearchData?.items ?? []).map((s) => ({
    value: s.roll,
    label: `${s.name} (${s.roll})`,
    description: `${s.major || "—"} · Sem ${s.semNow || "—"}`,
  }));
  const selectedStudent = studentSearchData?.items.find((s) => s.roll === dialogRoll) ?? null;

  // Course dropdown - server-searched, same real curriculum/availability
  // catalog the Faculty <-> Course mapping dialog uses.
  const [dialogCourseSearch, setDialogCourseSearch] = useState("");
  const dialogCourseSearchDebounced = useDebouncedValue(dialogCourseSearch, 250);
  const { data: realCourseData, isLoading: realCourseLoading } = useSWR(
    dialogOpen
      ? `/api/admin/mapping/faculty-course-section/courses?search=${encodeURIComponent(dialogCourseSearchDebounced)}&pageSize=20`
      : null,
    realCourseFetcher,
  );
  const realCourseOptions: SearchableSelectOption[] = (realCourseData?.items ?? []).map((c) => ({
    value: c.code,
    label: c.title === c.code ? c.code : `${c.code} - ${c.title}`,
  }));

  const openCreate = () => {
    reset({ roll: "", subCode: "" });
    setStudentSearch("");
    setDialogCourseSearch("");
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/admin/mapping/student-course-section", values);
      toast.success("Mapping added");
      setDialogOpen(false);
      // Show the result: switch the search to the roll just registered.
      setCourseCode(ALL);
      setBatch(ALL);
      setSectionName("");
      setPage(1);
      setRoll(values.roll);
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Save failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (r: Registration) => {
    try {
      await apiClient.delete(
        `/api/admin/mapping/student-course-section/${encodeURIComponent(r.roll)}/${encodeURIComponent(r.subCode)}`,
      );
      toast.success("Registration deleted");
      mutate();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Delete failed",
      );
    }
  };

  const columns: DataTableColumn<Registration>[] = [
    { key: "roll", header: "Student roll", render: (r) => r.roll },
    { key: "major", header: "Branch", render: (r) => r.major ?? "—" },
    { key: "semNow", header: "Semester", render: (r) => r.semNow ?? "—" },
    {
      key: "sections",
      header: "Sections",
      render: (r) =>
        r.sections.length > 0
          ? r.sections.map((section) => section.name).join(", ")
          : "—",
    },
    { key: "subCode", header: "Course code", render: (r) => r.subCode },
    ...(!roll.trim()
      ? [
          {
            key: "batch",
            header: "Batch",
            render: (r: Registration) => r.batch ?? "—",
          },
        ]
      : []),
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          }
          title="Delete registration?"
          description={`Remove ${r.roll}'s registration for ${r.subCode}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(r)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Student ↔ Course Mapping
          </h1>
          <p className="text-sm text-muted-foreground">
            Live registrations synced from the university system - this spans
            ~60 per-batch tables, so it starts with a bounded recent list
            rather than a full unfiltered dump; search an exact roll, or
            browse by course/batch/section below.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Mapping
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search registrations</CardTitle>
          <CardDescription>
            Search by an exact student roll, or browse by course/batch/section - combine the
            three browse filters freely, or clear them (Any) to see the most recently
            registered mappings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="roll">Student roll</Label>
              <Input
                id="roll"
                value={roll}
                onChange={(e) => {
                  setRoll(e.target.value);
                  setPage(1);
                  if (e.target.value) {
                    setCourseCode(ALL);
                    setBatch(ALL);
                    setSectionName("");
                  }
                }}
                placeholder="e.g. 25PE3001"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={courseCode}
                onValueChange={(v) => {
                  setCourseCode(v);
                  setPage(1);
                  if (v !== ALL) setRoll("");
                }}
                options={[
                  { value: ALL, label: "Any course" },
                  ...(browseCourseData?.items ?? []).map((c) => ({
                    value: c.code,
                    label: c.title === c.code ? c.code : `${c.code} - ${c.title}`,
                  })),
                ]}
                placeholder="Any course"
                searchPlaceholder="Search courses..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Batch</Label>
              <SearchableSelect
                value={batch}
                onValueChange={(v) => {
                  setBatch(v);
                  setPage(1);
                  if (v !== ALL) setRoll("");
                }}
                options={[
                  { value: ALL, label: "Any batch" },
                  ...batches.map((b) => ({ value: b.batchName, label: b.batchName })),
                ]}
                placeholder="Any batch"
                searchPlaceholder="Search batches..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sectionName">Section</Label>
              <Input
                id="sectionName"
                value={sectionName}
                onChange={(e) => {
                  setSectionName(e.target.value);
                  setPage(1);
                  if (e.target.value) setRoll("");
                }}
                placeholder="e.g. PE_3"
              />
            </div>
          </div>

          {data?.isDefault && (
            <p className="text-sm text-muted-foreground">
              No search or filter yet — showing the most recently registered mappings. Search a
              roll, or pick a course/batch/section, to narrow this down.
            </p>
          )}
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => `${r.roll}-${r.subCode}`}
            loading={isLoading}
          />
          {data?.meta && !data.isDefault && (
            <PaginationBar
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              total={data.meta.total}
              pageSize={data.meta.pageSize}
              onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Mapping</DialogTitle>
            <DialogDescription>
              Registers a student for a course, in the registration table for
              their batch.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <Label>Student</Label>
              <SearchableSelect
                value={dialogRoll || null}
                onValueChange={(v) => setValue("roll", v, { shouldValidate: true })}
                options={studentOptions}
                search={studentSearch}
                onSearchChange={setStudentSearch}
                placeholder="Select student"
                searchPlaceholder="Search by name, roll, email..."
                loading={studentSearchLoading}
                emptyText="No students found."
              />
              {errors.roll && (
                <p className="text-sm text-destructive">{errors.roll.message}</p>
              )}
              {selectedStudent && (
                <p className="text-xs text-muted-foreground">
                  {selectedStudent.major || "—"} · Sem {selectedStudent.semNow || "—"} · Batch{" "}
                  {selectedStudent.batch || "—"} - registers into that batch&apos;s registration
                  table.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                value={dialogSubCode || null}
                onValueChange={(v) => setValue("subCode", v, { shouldValidate: true })}
                options={realCourseOptions}
                search={dialogCourseSearch}
                onSearchChange={setDialogCourseSearch}
                placeholder="Select course"
                searchPlaceholder="Search course code or title..."
                loading={realCourseLoading}
                emptyText="No matching courses."
              />
              {errors.subCode && (
                <p className="text-sm text-destructive">{errors.subCode.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
