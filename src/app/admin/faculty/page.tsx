"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { DataTable, DataTableColumn } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { PaginationBar, usePageSize } from "@/components/admin/pagination-bar";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";

interface Faculty {
  roll: string;
  name: string;
  email: string;
  mobile: string | null;
  status: number; // 1-Active, 2-Inactive
  dept: string | null;
  facStatus: string | null; // R-Regular, V-Visiting, P-PFD, T-Temporary
}

const FAC_STATUS_LABEL: Record<string, string> = {
  R: "Regular",
  V: "Visiting",
  P: "PFD",
  T: "Temporary",
};

interface ListResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

const fetcher = (url: string) => apiClient.get<ListResponse<Faculty>>(url);

const schema = z.object({
  roll: z.string().trim().min(1, "Roll is required"),
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Enter a valid email"),
  // Required (not "leave blank to keep") on both create and edit - the
  // forgot-password SMS OTP flow can't reach an account without this, so the
  // edit dialog doubles as a way to backfill it for older records.
  mobile: z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit mobile number"),
  password: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function FacultyListPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Faculty | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search });

  const { data, isLoading, mutate } = useSWR(`/api/admin/faculty?${params.toString()}`, fetcher);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const openCreate = () => {
    setEditing(null);
    reset({ roll: "", name: "", email: "", mobile: "", password: "" });
    setDialogOpen(true);
  };

  const openEdit = (faculty: Faculty) => {
    setEditing(faculty);
    reset({ roll: faculty.roll, name: faculty.name, email: faculty.email, mobile: faculty.mobile ?? "", password: "" });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      if (editing) {
        await apiClient.patch(`/api/admin/faculty/${editing.roll}`, {
          name: values.name,
          email: values.email,
          mobile: values.mobile,
          password: values.password || undefined,
        });
        toast.success("Faculty updated");
      } else {
        if (!values.password || values.password.length < 6) {
          toast.error("Password must be at least 6 characters");
          setSubmitting(false);
          return;
        }
        await apiClient.post("/api/admin/faculty", values);
        toast.success("Faculty added");
      }
      setDialogOpen(false);
      mutate();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (roll: string) => {
    try {
      await apiClient.delete(`/api/admin/faculty/${roll}`);
      toast.success("Faculty deleted");
      mutate();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Delete failed");
    }
  };

  const handleToggleStatus = async (faculty: Faculty) => {
    const active = faculty.status !== 1;
    try {
      await apiClient.patch(`/api/admin/faculty/${faculty.roll}/status`, { active });
      toast.success(active ? "Faculty activated" : "Faculty deactivated");
      mutate();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Status update failed");
    }
  };

  const columns: DataTableColumn<Faculty>[] = [
    { key: "name", header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "email", header: "Email", render: (r) => r.email },
    { key: "mobile", header: "Mobile", render: (r) => r.mobile || "—" },
    { key: "roll", header: "Roll", render: (r) => r.roll },
    { key: "dept", header: "Department", render: (r) => r.dept || "—" },
    { key: "facStatus", header: "Type", render: (r) => (r.facStatus ? FAC_STATUS_LABEL[r.facStatus] ?? r.facStatus : "—") },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === 1 ? "success" : "destructive"}>{r.status === 1 ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleToggleStatus(r)}
            title={r.status === 1 ? "Deactivate login" : "Activate login"}
          >
            {r.status === 1 ? <PowerOff className="h-4 w-4 text-destructive" /> : <Power className="h-4 w-4 text-green-600" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            }
            title="Delete faculty?"
            description={`Delete "${r.name}" (${r.roll})? This removes their login and course mappings. This cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={() => handleDelete(r.roll)}
          />
          <Button asChild variant="ghost" size="icon">
            <Link href={`/admin/faculty/${r.roll}`}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Faculty</h1>
          <p className="text-sm text-muted-foreground">
            Live directory synced from the university system.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Faculty
        </Button>
      </div>

      <FilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name, email, roll..."
      />

      <DataTable columns={columns} rows={data?.items ?? []} rowKey={(r) => r.roll} loading={isLoading} />

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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Faculty" : "Add Faculty"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this faculty member's profile, or reset their password."
                : "Creates a new faculty login and profile directly in the university directory."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="roll">Roll</Label>
              <Input id="roll" {...register("roll")} placeholder="e.g. RF0223" disabled={!!editing} />
              {errors.roll && <p className="text-sm text-destructive">{errors.roll.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile">Mobile Number</Label>
              <Input
                id="mobile"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                {...register("mobile")}
              />
              {errors.mobile && <p className="text-sm text-destructive">{errors.mobile.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{editing ? "Reset password (optional)" : "Password"}</Label>
              <Input
                id="password"
                type="password"
                {...register("password")}
                placeholder={editing ? "Leave blank to keep current password" : ""}
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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
