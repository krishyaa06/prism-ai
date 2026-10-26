<div align="center">

# ◇ Prism AI

**Build. Explore. Create.**

A developer-first AI workspace for organizing ideas, documents and research, with a built-in AI assistant.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Open-6C63FF?style=for-the-badge&logo=vercel&logoColor=white)](https://prism-ai-umber.vercel.app)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-00D4FF?style=for-the-badge)

</div>

## ✨ Features

- **Animated landing page** with a modern dark developer aesthetic, built with Framer Motion
- **Workspace dashboard** (`/dashboard`) with recent documents, saved ideas and a weekly focus score
- **Prism AI Assistant**: ask questions straight from the dashboard, powered by the OpenAI API
- **Secure by default**: the API key stays on the server inside a Next.js route handler
- Responsive, mobile-friendly layout with `prefers-reduced-motion` support

## 🛠️ Tech Stack

| Layer | Tools |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Animation & icons | Framer Motion, Lucide React |
| AI | OpenAI Responses API (`gpt-4.1-mini`) |
| Hosting | Vercel |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm
- An [OpenAI API key](https://platform.openai.com/api-keys) (only needed for the assistant)

### Installation

```bash
git clone https://github.com/krishyaa06/prism-ai.git
cd prism-ai
npm install
```

### Environment variables

Create a `.env.local` file in the project root:

```bash
OPENAI_API_KEY=your_openai_api_key
```

> `.env*` files are git-ignored, so your key is never committed.

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page and [http://localhost:3000/dashboard](http://localhost:3000/dashboard) for the workspace.

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
├── api/chat/route.ts   # POST /api/chat → OpenAI assistant endpoint
├── dashboard/page.tsx  # Workspace dashboard
├── layout.tsx          # Root layout and metadata
├── page.tsx            # Animated landing page
└── globals.css         # Global styles (Tailwind)
public/                 # Static assets
```

## 🔌 API

`POST /api/chat`

```json
{ "message": "Summarize the key ideas of retrieval-augmented generation" }
```

Response:

```json
{ "answer": "..." }
```

## ☁️ Deployment

Deploy to [Vercel](https://vercel.com/new) and add `OPENAI_API_KEY` under **Project → Settings → Environment Variables**.

## 🔷 Part of Prism Protocol

Prism AI is built by [Soumya Bhandare](https://github.com/krishyaa06), founder of [Prism Protocol](https://dc.gg/prismprotocol), a tech community for young builders.

## 📄 License

Released under the [MIT License](LICENSE).
