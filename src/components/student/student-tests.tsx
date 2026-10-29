"use client";

import { useState } from "react";
import useSWR from "swr";
import { formatDateTime } from "@/lib/format-date";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";

interface StudentQuiz {
  id: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "completed";
  startTime: string;
  endTime: string;
  totalMarks: number;
  myAllotmentStatus: "allotted" | "attempted" | "absent";
  courseCode: string;
  courseName: string;
  sectionNames: string;
  faculty: { name: string };
}

interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "warning",
  live: "success",
  completed: "outline",
  allotted: "secondary",
  attempted: "success",
  absent: "destructive",
};

export function StudentTests() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();

  const { data, isLoading } = useSWR(`/api/student/quizzes?page=${page}&pageSize=${pageSize}`, (url: string) =>
    apiClient.get<ListResponse<StudentQuiz>>(url)
  );
  const quizzes = data?.items ?? [];

  const columns: DataTableColumn<StudentQuiz>[] = [
    { key: "title", header: "Quiz", render: (r) => <span className="font-medium">{r.title}</span> },
    { key: "course", header: "Course", render: (r) => `${r.courseName} (${r.courseCode})` },
    { key: "section", header: "Section", render: (r) => r.sectionNames.split(",").filter(Boolean).join(", ") || "—" },
    { key: "faculty", header: "Faculty", render: (r) => r.faculty.name },
    { key: "startTime", header: "Start", render: (r) => formatDateTime(r.startTime) },
    { key: "status", header: "Status", render: (r) => <Badge variant={statusVariant[r.status]}>{r.status}</Badge> },
    {
      key: "myAllotmentStatus",
      header: "My Status",
      render: (r) => <Badge variant={statusVariant[r.myAllotmentStatus]}>{r.myAllotmentStatus}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Tests</h1>
        <p className="text-sm text-muted-foreground">Every quiz allotted to you, across every course.</p>
      </div>

      <DataTable columns={columns} rows={quizzes} rowKey={(r) => r.id} loading={isLoading} emptyMessage="No quizzes allotted yet." />
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
