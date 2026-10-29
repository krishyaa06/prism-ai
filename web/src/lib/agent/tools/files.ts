import { z } from "zod";
import type { Artifact, ArtifactKind } from "../events";
import { defineTool, shortSummary } from "./types";

export const ARTIFACT_KINDS = ["markdown", "html", "code", "csv", "json", "svg", "text"] as const satisfies readonly ArtifactKind[];
export const MAX_ARTIFACT_CHARS = 400_000;
const MAX_ARTIFACTS = 30;

export function inferKind(name: string): ArtifactKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  if (ext === "svg") return "svg";
  if (ext === "txt") return "text";
  return "code";
}

export const createFileTool = defineTool({
  name: "create_file",
  description:
    "Create a file artifact shown to the user in the workspace: reports and documents (markdown), interactive pages, dashboards, charts and small apps (self-contained html — inline CSS/JS; CDN scripts allowed; rendered in a sandboxed iframe), data (csv/json), images (svg), or source code (code + language). Put long deliverables here instead of the chat answer.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name with extension, e.g. report.md, dashboard.html, data.csv." },
      kind: { type: "string", enum: [...ARTIFACT_KINDS] },
      content: { type: "string", description: "Full file content." },
      language: { type: "string", description: "Programming language when kind is code (e.g. python, typescript)." },
    },
    required: ["name", "kind", "content"],
    additionalProperties: false,
  },
  schema: z.object({
    name: z.string().trim().min(1).max(120).transform((v) => v.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")),
    kind: z.enum(ARTIFACT_KINDS).optional(),
    content: z.string().max(MAX_ARTIFACT_CHARS),
    language: z.string().trim().max(40).optional(),
  }),
  label: (args) => `Creating ${args.name}`,
  run: async (args, ctx) => {
    if (ctx.state.artifacts.size >= MAX_ARTIFACTS) {
      return { ok: false, summary: "Too many files in this conversation.", content: `Limit of ${MAX_ARTIFACTS} files reached; update an existing file instead.` };
    }
    const existing = [...ctx.state.artifacts.values()].find((a) => a.name === args.name);
    const id = existing?.id ?? `a${Date.now().toString(36)}${(++ctx.state.artifactSeq).toString(36)}`;
    const artifact: Artifact = {
      id,
      name: args.name,
      kind: args.kind ?? inferKind(args.name),
      content: args.content,
      ...(args.language ? { language: args.language } : {}),
    };
    ctx.state.artifacts.set(id, artifact);
    ctx.emit({ type: "artifact", artifact });
    return {
      ok: true,
      summary: shortSummary(`${existing ? "Replaced" : "Created"} ${artifact.name} (${artifact.content.length.toLocaleString("en")} chars)`),
      content: `${existing ? "Replaced existing" : "Created"} file id=${id} name=${artifact.name} kind=${artifact.kind}. The user can see it in the workspace; do not repeat its content in chat.`,
      data: { id, name: artifact.name, kind: artifact.kind },
    };
  },
});

export const updateFileTool = defineTool({
  name: "update_file",
  description: "Replace the full content of an existing file artifact by id.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Artifact id from create_file or the files list." },
      content: { type: "string", description: "New full content." },
    },
    required: ["id", "content"],
    additionalProperties: false,
  },
  schema: z.object({ id: z.string().trim().min(1).max(80), content: z.string().max(MAX_ARTIFACT_CHARS) }),
  label: (args) => `Updating file ${args.id}`,
  run: async (args, ctx) => {
    const current = ctx.state.artifacts.get(args.id) ?? [...ctx.state.artifacts.values()].find((a) => a.name === args.id);
    if (!current) {
      const ids = [...ctx.state.artifacts.values()].map((a) => `${a.id} (${a.name})`).join(", ") || "none";
      return { ok: false, summary: `No file with id ${args.id}.`, content: `No file with id ${args.id}. Existing files: ${ids}.` };
    }
    const artifact: Artifact = { ...current, content: args.content };
    ctx.state.artifacts.set(artifact.id, artifact);
    ctx.emit({ type: "artifact", artifact });
    return {
      ok: true,
      summary: shortSummary(`Updated ${artifact.name} (${artifact.content.length.toLocaleString("en")} chars)`),
      content: `Updated file id=${artifact.id} name=${artifact.name}.`,
      data: { id: artifact.id, name: artifact.name, kind: artifact.kind },
    };
  },
});
