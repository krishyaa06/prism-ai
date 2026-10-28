import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DashboardPanel } from "@/components/dashboard-panel";

export default async function DashboardPage() {
  const user = await getVerifiedUser();
  if (!user) redirect("/");

  const supabase = createSupabaseAdminClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Could not load Prism account role.");
  if (!profile) throw new Error("Account profile is missing. Apply the Supabase database migration.");

  return <DashboardPanel email={user.email ?? ""} isAdmin={profile.role === "admin"} />;
}
