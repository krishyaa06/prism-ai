<div align="center">

# ◇ Prism AI

**Build. Explore. Create.**

A developer-first AI workspace for documents, ideas and research, with a streaming AI assistant that works out of the box.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Open-6C63FF?style=for-the-badge&logo=vercel&logoColor=white)](https://prism-ai-umber.vercel.app)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-00D4FF?style=for-the-badge)

</div>

## ✨ Features

- **Workspace dashboard** with a live greeting, momentum score, recent documents, ideas and chats
- **Markdown documents**: write / split / preview modes, tags, pins, autosave, copy and `.md` download
- **AI Assistant** with streaming answers, chat history, stop, retry, regenerate and *Save as doc*
- **Document context**: attach any document to a chat, or use *Ask AI → Summarize / Improve / Outline* from the editor
- **Ideas**: quick capture, mark done, expand with AI or turn into a document
- **Command palette** (`Ctrl/⌘ + K`) to search everything or ask Prism directly
- **Multi-provider AI**: Groq, Gemini, OpenAI or OpenRouter, via server env vars *or* a key pasted in Settings
- **Offline demo mode**: works with zero setup; rule-based summaries, ideas and plans when no key is set
- **Your data, your browser**: everything is stored in `localStorage`, with JSON export / import and reset
- Animated landing page, responsive mobile layout, custom 404 page and `prefers-reduced-motion` support

## 🛠️ Tech Stack

| Layer | Tools |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript |
| Styling | Hand-written CSS design system (dark, cyan/violet) |
| Animation & icons | Framer Motion, Lucide React |
| AI | OpenAI-compatible streaming Chat Completions (Groq, Gemini, OpenAI, OpenRouter) |
| Hosting | Vercel |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
git clone https://github.com/krishyaa06/prism-ai.git
cd prism-ai
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The workspace is at [/dashboard](http://localhost:3000/dashboard).

### Enable full AI answers (optional)

Copy `.env.example` to `.env.local` and add **one** key:

```bash
GROQ_API_KEY=your_key        # free: https://console.groq.com/keys
# or GEMINI_API_KEY=...      # free: https://aistudio.google.com/apikey
# or OPENAI_API_KEY=...
# or OPENROUTER_API_KEY=...
```

No key? Prism still works in **demo mode**. Users can also paste their own key in **Settings → AI provider**; it is stored only in their browser.

## 📜 Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |

## 📁 Project Structure

```
app/
├── api/chat/route.ts          # Streaming AI endpoint (multi-provider + demo fallback)
├── dashboard/
│   ├── page.tsx               # /dashboard
│   └── _components/           # workspace, overview, documents, assistant, ideas, settings, palette
├── layout.tsx                 # Fonts, metadata, viewport
├── page.tsx                   # Animated landing page
├── not-found.tsx              # Custom 404
├── icon.svg                   # Favicon
└── globals.css                # Design system
lib/
├── ai.ts                      # Client streaming helper + AI actions
├── demo.ts                    # Offline demo-mode replies
├── markdown.tsx               # Safe Markdown renderer
└── store.ts                   # localStorage state, seed data, helpers
```

## 🔌 API

`GET /api/chat` returns the server AI status:

```json
{ "mode": "live", "provider": "Groq", "model": "llama-3.3-70b-versatile" }
```

`POST /api/chat` streams a plain-text answer:

```json
{
  "messages": [{ "role": "user", "content": "Explain RAG simply" }],
  "context": "optional document text",
  "provider": "groq",
  "apiKey": "optional user key",
  "model": "optional model id"
}
```

The response header `X-Prism-Mode` is `live` or `demo`.

## ☁️ Deployment

Push to GitHub and import the repo on [Vercel](https://vercel.com/new). To turn on full AI for every visitor, add `GROQ_API_KEY` (or another provider key) under **Project → Settings → Environment Variables** and redeploy.

## 🔷 Part of Prism Protocol

Prism AI is built by [Soumya Bhandare](https://github.com/krishyaa06), founder of [Prism Protocol](https://dc.gg/prismprotocol), a tech community for young builders.

## 📄 License

Released under the [MIT License](LICENSE).
