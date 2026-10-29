"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import { ChevronRight, Plus } from "lucide-react";

interface QuizRow {
  id: number;
  title: string;
  status: "draft" | "scheduled" | "live" | "completed";
  startTime: string;
  facultyRoll: string;
  courseCode: string;
  courseName: string;
  sectionNames: string;
  _count: { questions: number; allotments: number };
}

interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
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

const fetcher = (url: string) => apiClient.get<ListResponse<QuizRow>>(url);

export default function AdminTestsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    search,
  });
  const { data, isLoading } = useSWR(
    `/api/faculty/quizzes?${params.toString()}`,
    fetcher,
  );

  const columns: DataTableColumn<QuizRow>[] = [
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <Link href={`/admin/tests/${r.id}`} className="font-medium hover:underline">
          {r.title}
        </Link>
      ),
    },
    {
      key: "course",
      header: "Course",
      render: (r) => `${r.courseName} (${r.courseCode})`,
    },
    {
      key: "sections",
      header: "Sections",
      render: (r) => r.sectionNames.split(",").filter(Boolean).join(", ") || "—",
    },
    { key: "facultyRoll", header: "Faculty", render: (r) => r.facultyRoll },
    {
      key: "startTime",
      header: "Start",
      render: (r) => formatDateTime(r.startTime),
    },
    {
      key: "questions",
      header: "Questions",
      render: (r) => r._count.questions,
    },
    { key: "allotted", header: "Allotted", render: (r) => r._count.allotments },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={statusVariant[r.status]}>{r.status}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <Button asChild variant="ghost" size="icon">
          <Link href={`/admin/tests/${r.id}`}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tests</h1>
          <p className="text-sm text-muted-foreground">
            System-wide oversight of every quiz, or create one on a faculty
            member's behalf.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/tests/new">
            <Plus className="mr-2 h-4 w-4" />
            Create Quiz
          </Link>
        </Button>
      </div>

      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by title..."
      />

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
