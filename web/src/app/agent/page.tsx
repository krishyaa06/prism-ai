import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth";
import { AgentWorkspace } from "@/components/agent/workspace";
import "./agent.css";

export const metadata: Metadata = {
  title: "Prism Agent",
  description: "Give Prism a goal: it plans, researches, runs code, writes files and asks before consequential actions.",
};

export default async function AgentPage() {
  const user = await getVerifiedUser();
  if (!user) redirect("/");
  return <AgentWorkspace email={user.email ?? ""} />;
}
