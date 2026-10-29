"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { formatDateTime } from "@/lib/format-date";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Plus } from "lucide-react";

interface FacultyQuiz {
  id: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "completed";
  startTime: string;
  endTime: string;
  totalMarks: number;
  courseCode: string;
  courseName: string;
  sectionNames: string;
  building: { name: string };
  _count: { questions: number; allotments: number };
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
};

export function FacultyQuizzes() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();

  const { data, isLoading } = useSWR(`/api/faculty/quizzes?page=${page}&pageSize=${pageSize}`, (url: string) =>
    apiClient.get<ListResponse<FacultyQuiz>>(url)
  );
  const quizzes = data?.items ?? [];

  const columns: DataTableColumn<FacultyQuiz>[] = [
    {
      key: "title",
      header: "Quiz",
      render: (r) => (
        <Link href={`/faculty/quizzes/${r.id}`} className="font-medium text-primary hover:underline">
          {r.title}
        </Link>
      ),
    },
    { key: "course", header: "Course", render: (r) => `${r.courseName} (${r.courseCode})` },
    { key: "section", header: "Section", render: (r) => r.sectionNames.split(",").filter(Boolean).join(", ") || "—" },
    { key: "building", header: "Building", render: (r) => r.building.name },
    { key: "startTime", header: "Start", render: (r) => formatDateTime(r.startTime) },
    { key: "questions", header: "Questions", render: (r) => r._count.questions },
    { key: "allotted", header: "Allotted", render: (r) => r._count.allotments },
    { key: "status", header: "Status", render: (r) => <Badge variant={statusVariant[r.status]}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Quizzes</h1>
          <p className="text-sm text-muted-foreground">Every quiz you've created, across every course.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/faculty/quizzes/new">
            <Plus className="mr-2 h-4 w-4" />
            Create Quiz
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={quizzes}
        rowKey={(r) => r.id}
        loading={isLoading}
        emptyMessage="You haven't created any quizzes yet."
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
