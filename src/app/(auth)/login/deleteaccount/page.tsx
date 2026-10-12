"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/shell/brand-logo";
import { ArrowLeft, CheckCircle2, Trash2 } from "lucide-react";

const deleteAccountFormSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or user ID"),
});

type DeleteAccountFormValues = z.infer<typeof deleteAccountFormSchema>;

export default function DeleteAccountRequestPage() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DeleteAccountFormValues>({ resolver: zodResolver(deleteAccountFormSchema) });

  const onSubmit = async (values: DeleteAccountFormValues) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await apiClient.post("/api/auth/delete-account-request", values);
      setSubmitted(true);
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <BrandLogo className="mx-auto h-16 w-16" />
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <Trash2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Delete Account Request</CardTitle>
          <CardDescription>
            {submitted
              ? "We've received your request."
              : "Enter your registered email or user ID. Your request will be sent to an admin for review."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
              <p className="text-sm text-muted-foreground">
                Your account deletion request has been submitted. An admin will review it and process the deletion.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="identifier">Email or User ID</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Email address or user ID"
                  autoFocus
                  {...register("identifier")}
                />
                {errors.identifier && <p className="text-sm text-destructive">{errors.identifier.message}</p>}
              </div>
              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
              <Button type="submit" variant="destructive" className="w-full" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Deletion Request"}
              </Button>
            </form>
          )}

          <Link
            href="/login"
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
