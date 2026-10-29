"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { Radio, Users, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";

interface LiveQuizItem {
  id: number;
  title: string;
  course: { name: string; code: string };
  sections: { name: string }[];
  faculty: { name: string };
  building: { name: string };
  startTime: string;
  actualStartTime: string | null;
  durationMinutes: number;
  durationSeconds: number | null;
  submittedCount: number;
  thresholdCount: number;
  remainingSeconds: number;
  totalAllotted: number;
  attemptedCount: number;
  notAttemptedCount: number;
}

interface LiveTrackingData {
  runningCount: number;
  items: LiveQuizItem[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

const fetcher = (url: string) => apiClient.get<LiveTrackingData>(url);

interface LiveTrackingBoardProps {
  compact?: boolean;
}

export function LiveTrackingBoard({ compact = false }: LiveTrackingBoardProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const { data, isLoading } = useSWR(
    `/api/admin/reports/live-tracking?page=${compact ? 1 : page}&pageSize=${compact ? 12 : pageSize}`,
    fetcher,
    { refreshInterval: 12000 },
  );

  const items = compact ? (data?.items ?? []).slice(0, 3) : data?.items ?? [];

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 animate-pulse text-destructive" />
          <span className="text-lg font-semibold">{data?.runningCount ?? 0} test(s) running now</span>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading live quizzes...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quizzes are currently live.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((quiz) => (
            <Card key={quiz.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{quiz.title}</CardTitle>
                  <Badge variant="destructive" className="shrink-0">
                    LIVE
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {quiz.course.name} ({quiz.course.code}) &middot; {quiz.sections.map((s) => s.name).join(", ") || "—"}
                </p>
                <p className="text-muted-foreground">
                  {quiz.faculty.name} &middot; {quiz.building.name}
                </p>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Started {formatDateTime(quiz.actualStartTime ?? quiz.startTime)}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    {quiz.durationSeconds !== null
                      ? `Duration ${formatDuration(quiz.durationSeconds)} (1st–80% submissions)`
                      : `Duration pending (${quiz.submittedCount}/${quiz.thresholdCount} submitted)`}
                    {" "}&middot; Remaining {formatDuration(quiz.remainingSeconds)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {quiz.attemptedCount}/{quiz.totalAllotted} attempted
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!compact && data?.meta && (
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
