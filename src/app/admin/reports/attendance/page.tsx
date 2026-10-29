"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "@/lib/api-client";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { format } from "@/lib/format-date";
import { FileSpreadsheet, FileText } from "lucide-react";

interface CourseOption {
  code: string;
  name: string;
}
interface SectionOption {
  name: string;
}
interface AttendanceRow {
  id: number;
  date: string;
  status: "present" | "absent";
  studentRoll: string;
  studentName: string;
  courseCode: string;
  courseName: string;
  quiz: {
    id: number;
    title: string;
    sectionNames: string;
  };
}
interface StudentOption {
  roll: string;
  name: string;
}
interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  filterOptions: { courses: CourseOption[]; sections: SectionOption[] };
}

const listFetcher = <T,>(url: string) => apiClient.get<{ items: T[] }>(url);
const fetcher = (url: string) =>
  apiClient.get<ListResponse<AttendanceRow>>(url);

export default function AttendanceReportPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [courseCode, setCourseCode] = useState<string>("all");
  const [sectionName, setSectionName] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<StudentOption[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const studentListUrl = `/api/admin/students?page=1&pageSize=50${studentSearch.trim() ? `&search=${encodeURIComponent(studentSearch.trim())}` : ""}`;
  const { data: studentData } = useSWR(
    studentListUrl,
    listFetcher<StudentOption>,
  );

  const selectedStudentRolls = useMemo(
    () => selectedStudents.map((student) => student.roll),
    [selectedStudents],
  );

  const buildParams = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionName !== "all") params.set("sectionName", sectionName);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("sortOrder", sortOrder);
    selectedStudentRolls.forEach((roll) => params.append("studentRoll", roll));
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  };

  const { data, isLoading } = useSWR(
    `/api/admin/reports/attendance?${buildParams().toString()}`,
    fetcher,
  );
  const courseOptions = data?.filterOptions.courses ?? [];
  const sectionOptions = data?.filterOptions.sections ?? [];

  const handleExport = (type: "excel" | "pdf") => {
    const params = buildParams({ export: type });
    downloadFile(
      `/api/admin/reports/attendance?${params.toString()}`,
      `attendance-report.${type === "excel" ? "xlsx" : "pdf"}`,
    );
  };

  const columns: DataTableColumn<AttendanceRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (r) => `${r.studentName} (${r.studentRoll})`,
    },
    {
      key: "course",
      header: "Course",
      render: (r) => `${r.courseName} (${r.courseCode})`,
    },
    {
      key: "section",
      header: "Section",
      render: (r) => r.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
    },
    { key: "quiz", header: "Quiz", render: (r) => r.quiz.title },
    { key: "date", header: "Date", render: (r) => format(r.date) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "present" ? "success" : "destructive"}>
          {r.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Course-wise Attendance
          </h1>
          <p className="text-sm text-muted-foreground">
            Filter and export attendance records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport("excel")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport("pdf")}>
            <FileText className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Course</Label>
            <SearchableSelect
              value={courseCode}
              onValueChange={(v) => {
                setCourseCode(v);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All courses" },
                ...courseOptions.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
              ]}
              searchPlaceholder="Search courses..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Section</Label>
            <SearchableSelect
              value={sectionName}
              onValueChange={(v) => {
                setSectionName(v);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All sections" },
                ...sectionOptions.map((s) => ({ value: s.name, label: s.name })),
              ]}
              searchPlaceholder="Search sections..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Search</Label>
            <Input
              placeholder="Roll / quiz"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Students</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full text-left">
                  {selectedStudents.length > 0
                    ? selectedStudents.length === 1
                      ? `${selectedStudents[0].name} (${selectedStudents[0].roll})`
                      : `${selectedStudents.length} students selected`
                    : "All students"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-3">
                  <Input
                    placeholder="Search student name or roll"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {studentData?.items.map((student) => {
                      const selected = selectedStudentRolls.includes(
                        student.roll,
                      );
                      return (
                        <label
                          key={student.roll}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent hover:text-accent-foreground"
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) => {
                              setSelectedStudents((current) => {
                                if (checked) {
                                  return current.some(
                                    (s) => s.roll === student.roll,
                                  )
                                    ? current
                                    : [
                                        ...current,
                                        {
                                          roll: student.roll,
                                          name: student.name,
                                        },
                                      ];
                                }
                                return current.filter(
                                  (s) => s.roll !== student.roll,
                                );
                              });
                            }}
                          />
                          <span className="text-sm">
                            {student.name} ({student.roll})
                          </span>
                        </label>
                      );
                    })}
                    {studentData?.items.length === 0 && (
                      <div className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
                        No students found.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelectedStudents([]);
                        setStudentSearch("");
                        setPage(1);
                      }}
                    >
                      Clear
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPage(1);
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Sort by date</Label>
            <SearchableSelect
              value={sortOrder}
              onValueChange={(v) => {
                setSortOrder(v as "asc" | "desc");
                setPage(1);
              }}
              options={[
                { value: "desc", label: "Newest first" },
                { value: "asc", label: "Oldest first" },
              ]}
              searchPlaceholder="Search..."
            />
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
      />

      {data?.meta && (
        <PaginationBar
          page={data.meta.page}
          totalPages={data.meta.totalPages}
          total={data.meta.total}
          pageSize={data.meta.pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      )}
    </div>
  );
}
