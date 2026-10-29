"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { apiClient, downloadFile } from "@/lib/api-client";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { format } from "@/lib/format-date";
import { ArrowRight, FileSpreadsheet, FileText } from "lucide-react";

interface CourseFilterOption {
  code: string;
  name: string;
}
interface SectionFilterOption {
  name: string;
}
interface ResultRow {
  id: number;
  studentRoll: string;
  studentName: string;
  marksObtained: number;
  percentage: number;
  status: "pending" | "declared" | "published";
  publishedAt: string | null;
  quiz: {
    id: number;
    title: string;
    totalMarks: number;
    courseCode: string;
    courseName: string;
    sectionNames: string;
  };
}
interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  filterOptions: { courses: CourseFilterOption[]; sections: SectionFilterOption[] };
}

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "outline"> = {
  pending: "secondary",
  declared: "warning",
  published: "success",
};

const fetcher = (url: string) => apiClient.get<ListResponse<ResultRow>>(url);

export function FacultyResults() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [courseCode, setCourseCode] = useState<string>("all");
  const [sectionName, setSectionName] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const buildParams = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (courseCode !== "all") params.set("courseCode", courseCode);
    if (sectionName !== "all") params.set("sectionName", sectionName);
    if (status !== "all") params.set("resultStatus", status);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("sortOrder", sortOrder);
    return params;
  };

  const { data, isLoading } = useSWR(
    `/api/faculty/reports/results?${buildParams().toString()}`,
    fetcher,
  );

  const handleExport = (type: "excel" | "pdf") => {
    const params = buildParams();
    params.set("export", type);
    downloadFile(
      `/api/faculty/reports/results?${params.toString()}`,
      `results-report.${type === "excel" ? "xlsx" : "pdf"}`,
    );
  };

  const filterOptions = data?.filterOptions ?? { courses: [], sections: [] };

  const columns: DataTableColumn<ResultRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (row) => `${row.studentName} (${row.studentRoll})`,
    },
    {
      key: "course",
      header: "Course",
      render: (row) => `${row.quiz.courseName} (${row.quiz.courseCode})`,
    },
    {
      key: "section",
      header: "Section",
      render: (row) => row.quiz.sectionNames.split(",").filter(Boolean).join(", ") || "—",
    },
    { key: "quiz", header: "Quiz", render: (row) => row.quiz.title },
    {
      key: "marks",
      header: "Marks",
      render: (row) => `${row.marksObtained.toFixed(0)} / ${row.quiz.totalMarks}`,
    },
    {
      key: "percentage",
      header: "%",
      render: (row) => `${row.percentage.toFixed(2)}%`,
    },
    {
      key: "status",
      header: "Result",
      render: (row) => <Badge variant={statusVariant[row.status]}>{row.status}</Badge>,
    },
    {
      key: "publishedAt",
      header: "Published",
      render: (row) => (row.publishedAt ? format(row.publishedAt) : "—"),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) => (
        <Button variant="outline" size="sm" asChild>
          <Link
            href={`/faculty/results/${row.quiz.id}/${encodeURIComponent(row.studentRoll)}`}
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            View Answer Sheet
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Results</h1>
          <p className="text-sm text-muted-foreground">
            Filter result records across your quizzes and open a student&apos;s full answer sheet against the answer key.
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
              onValueChange={(value) => {
                setCourseCode(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All courses" },
                ...filterOptions.courses.map((course) => ({
                  value: course.code,
                  label: `${course.name} (${course.code})`,
                })),
              ]}
              searchPlaceholder="Search courses..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Section</Label>
            <SearchableSelect
              value={sectionName}
              onValueChange={(value) => {
                setSectionName(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All sections" },
                ...filterOptions.sections.map((section) => ({ value: section.name, label: section.name })),
              ]}
              searchPlaceholder="Search sections..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Result status</Label>
            <SearchableSelect
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "published", label: "Published" },
              ]}
              searchPlaceholder="Search..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Student / quiz</Label>
            <Input
              placeholder="Search roll or quiz title"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Sort by published date</Label>
            <SearchableSelect
              value={sortOrder}
              onValueChange={(value) => { setSortOrder(value as "asc" | "desc"); setPage(1); }}
              options={[
                { value: "desc", label: "Newest first" },
                { value: "asc", label: "Oldest first" },
              ]}
              searchPlaceholder="Search..."
            />
          </div>
        </CardContent>
      </Card>

      <DataTable columns={columns} rows={data?.items ?? []} rowKey={(row) => row.id} loading={isLoading} />

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
