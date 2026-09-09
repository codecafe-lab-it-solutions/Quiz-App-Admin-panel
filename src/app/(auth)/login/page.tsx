"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { Eye, EyeOff, GraduationCap } from "lucide-react";

const loginFormSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your roll number, email, or mobile number"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginFormSchema) });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      // A single form serves admin, faculty and student accounts - try each
      // login endpoint in turn rather than making the user pick a role.
      // Wrong-role attempts fail as a plain 401 ("Invalid email or
      // password"), same as a wrong password, so this leaks nothing about
      // which roles exist for a given email.
      const attempts: { path: string; role: "admin" | "faculty" | "student"; fallback: string }[] = [
        { path: "/api/auth/admin/login", role: "admin", fallback: "/admin/dashboard" },
        { path: "/api/auth/faculty/login", role: "faculty", fallback: "/faculty" },
        { path: "/api/auth/student/login", role: "student", fallback: "/student" },
      ];

      let signedInAs: (typeof attempts)[number] | null = null;
      let lastError: unknown = null;

      for (const attempt of attempts) {
        try {
          await apiClient.post(attempt.path, values);
          signedInAs = attempt;
          break;
        } catch (error) {
          lastError = error;
          const status = error instanceof ApiClientError ? error.status : 0;
          if (status !== 401) throw error; // validation error, server error, etc. - stop immediately
        }
      }

      if (!signedInAs) throw lastError instanceof Error ? lastError : new Error("Login failed");

      toast.success("Welcome back!");
      const redirect = searchParams.get("redirect");
      const target =
        signedInAs.role === "admin" && redirect && redirect.startsWith("/admin") ? redirect : signedInAs.fallback;
      router.push(target);
      router.refresh();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Login failed";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Quiz &amp; Attendance</CardTitle>
          <CardDescription>Sign in as an admin, faculty member, or student</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="identifier">Roll Number / Email / Mobile</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="Roll number, email, or mobile number"
                {...register("identifier")}
              />
              {errors.identifier && <p className="text-sm text-destructive">{errors.identifier.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              <Link
                href="/login/forgot-password"
                className="block text-right text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <Link
            href="/login/deleteaccount"
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Delete Account request
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
