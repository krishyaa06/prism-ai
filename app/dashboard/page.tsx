import type { Metadata } from "next";
import { Workspace } from "./_components/workspace";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your Prism AI workspace: documents, ideas and an AI assistant.",
};

export default function DashboardPage() {
  return <Workspace />;
}
