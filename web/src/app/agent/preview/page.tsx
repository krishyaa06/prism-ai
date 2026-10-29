import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentWorkspace } from "@/components/agent/workspace";
import "../agent.css";

export const metadata: Metadata = { title: "Prism Agent (preview)", robots: { index: false } };

// DEV-ONLY: renders the workspace with the mock event stream and no auth.
export default function AgentPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AgentWorkspace email="preview@localhost" forceMock />;
}
