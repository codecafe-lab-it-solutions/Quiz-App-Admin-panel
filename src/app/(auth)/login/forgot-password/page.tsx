"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, KeyRound, CheckCircle2 } from "lucide-react";

const requestFormSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your roll number, email, or mobile number"),
});
type RequestFormValues = z.infer<typeof requestFormSchema>;

const resetFormSchema = z
  .object({
    otp: z.string().trim().min(1, "Enter the code sent to you"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ResetFormValues = z.infer<typeof resetFormSchema>;

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requestForm = useForm<RequestFormValues>({ resolver: zodResolver(requestFormSchema) });
  const resetForm = useForm<ResetFormValues>({ resolver: zodResolver(resetFormSchema) });

  const sendOtp = async (values: RequestFormValues) => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/auth/forgot-password", values);
      setIdentifier(values.identifier);
      toast.success("If an account exists for that ID, a code has been sent.");
      setStep("reset");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resendOtp = async () => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/auth/forgot-password", { identifier });
      toast.success("Code resent");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (values: ResetFormValues) => {
    setSubmitting(true);
    try {
      await apiClient.post("/api/auth/reset-password", {
        identifier,
        otp: values.otp,
        newPassword: values.newPassword,
      });
      setStep("done");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {step === "done" ? <CheckCircle2 className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <CardTitle className="text-xl">Forgot Password</CardTitle>
          <CardDescription>
            {step === "request" && "Enter your roll number, email, or mobile number to receive a code."}
            {step === "reset" && "Enter the code sent to your email/mobile and choose a new password."}
            {step === "done" && "Your password has been reset."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "request" && (
            <form onSubmit={requestForm.handleSubmit(sendOtp)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="identifier">Roll Number / Email / Mobile</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Roll number, email, or mobile number"
                  autoFocus
                  {...requestForm.register("identifier")}
                />
                {requestForm.formState.errors.identifier && (
                  <p className="text-sm text-destructive">{requestForm.formState.errors.identifier.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending..." : "Send Code"}
              </Button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={resetForm.handleSubmit(resetPassword)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="otp">Code</Label>
                <Input id="otp" type="text" placeholder="Enter the code" autoFocus {...resetForm.register("otp")} />
                {resetForm.formState.errors.otp && (
                  <p className="text-sm text-destructive">{resetForm.formState.errors.otp.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" placeholder="••••••••" {...resetForm.register("newPassword")} />
                {resetForm.formState.errors.newPassword && (
                  <p className="text-sm text-destructive">{resetForm.formState.errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  {...resetForm.register("confirmPassword")}
                />
                {resetForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive">{resetForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Resetting..." : "Reset Password"}
              </Button>
              <button
                type="button"
                onClick={resendOtp}
                disabled={submitting}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
              <Button asChild className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          )}

          {step !== "done" && (
            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
