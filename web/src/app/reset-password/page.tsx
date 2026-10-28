import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth";
import { PasswordResetForm } from "@/components/password-reset-form";

export default async function ResetPasswordPage() {
  if (!(await getVerifiedUser())) redirect("/");
  return <PasswordResetForm />;
}
