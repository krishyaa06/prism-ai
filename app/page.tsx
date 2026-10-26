"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Command,
  FileText,
  KeyRound,
  Lightbulb,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { greeting, useNow } from "@/lib/store";

const features = [
  { icon: FileText, title: "Markdown documents", text: "Write with live preview, tags, pins and autosave. Export any page as Markdown." },
  { icon: BrainCircuit, title: "AI that knows your notes", text: "Attach a document to any chat so answers stay grounded in what you wrote." },
  { icon: Zap, title: "Streaming answers", text: "Responses appear word by word, with stop, retry and save-as-document built in." },
  { icon: Lightbulb, title: "Idea capture", text: "Jot thoughts in a second, then expand them with AI or turn them into documents." },
  { icon: Command, title: "Command palette", text: "Press ⌘K to jump to any document, idea or chat, or ask Prism directly." },
  { icon: ShieldCheck, title: "Private by design", text: "Your workspace lives in your browser. API keys stay server-side, never in the bundle." },
];

const steps = [
  { n: "01", title: "Capture", text: "Drop ideas and notes into one calm workspace the moment they appear." },
  { n: "02", title: "Explore", text: "Ask Prism to summarize, outline or question your documents." },
  { n: "03", title: "Create", text: "Turn answers into polished documents and ship your next project." },
];

const fade = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6 },
};

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export default function Home() {
  const now = useNow();
  const [menuOpen, setMenuOpen] = useState(false);
  const date = now
    ? new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()
    : "TODAY";

  return (
    <main className="landing">
      <nav className={`navbar ${menuOpen ? "open" : ""}`}>
        <Link href="/" className="brand" aria-label="Prism AI home">
          <span className="brandMark">◇</span>
          PRISM <strong>AI</strong>
        </Link>

        <button className="iconButton onlyMobile" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={menuOpen}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="navLinks" onClick={() => setMenuOpen(false)}>
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#about">About</a>
          <Link href="/dashboard" className="outlineButton">
            Open workspace
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="heroGlow" />

        <motion.div className="heroContent" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <div className="eyebrow">
            <Sparkles size={15} />
            AI workspace for curious builders
          </div>

          <h1>
            Turn ideas into <span>clarity.</span>
          </h1>

          <p>
            Prism AI brings your documents, research and creative thinking into one beautiful workspace built for the
            next generation of developers.
          </p>

          <div className="heroActions">
            <Link href="/dashboard" className="primaryButton">
              Explore Prism <ArrowRight size={17} />
            </Link>
            <a className="secondaryButton" href="https://github.com/krishyaa06/prism-ai" target="_blank" rel="noreferrer">
              <GithubMark /> View on GitHub
            </a>
          </div>

          <div className="trustLine">
            <span className="statusDot" />
            Free · No sign-up · Works offline in demo mode
          </div>
        </motion.div>

        <motion.div
          className="appPreview"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.15 }}
        >
          <div className="windowBar">
            <span />
            <span />
            <span />
            <label>prism / workspace</label>
          </div>

          <div className="previewBody">
            <aside className="sidebar">
              <div className="sidebarBrand">◇ PRISM</div>
              <div className="activeItem">⌂ Overview</div>
              <div>▧ Documents</div>
              <div>✦ AI Assistant</div>
              <div>◌ Ideas</div>
            </aside>

            <div className="workspace">
              <small>{date}</small>
              <h3>{greeting(now)}, builder.</h3>
              <p>What will you explore today?</p>

              <div className="stats">
                <div>
                  <b>4</b>
                  <small>Documents</small>
                </div>
                <div>
                  <b>12</b>
                  <small>Saved ideas</small>
                </div>
                <div>
                  <b>94%</b>
                  <small>Momentum</small>
                </div>
              </div>

              <Link href="/dashboard#assistant" className="promptBox">
                Ask Prism anything...
                <span>↗</span>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      <section id="features" className="featuresSection">
        <motion.div className="sectionHeader" {...fade}>
          <div className="eyebrow">BUILT FOR MOMENTUM</div>
          <h2>
            Simple tools for <span>serious thinking.</span>
          </h2>
        </motion.div>

        <div className="featureGrid">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article
                className="featureCard"
                key={feature.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: (index % 3) * 0.08 }}
                whileHover={{ y: -7 }}
              >
                <div className="featureIcon">
                  <Icon size={20} />
                </div>
                <span className="featureNumber">0{index + 1}</span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section id="workflow" className="workflowSection">
        <motion.div className="sectionHeader" {...fade}>
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>
            Three steps from <span>spark to shipped.</span>
          </h2>
        </motion.div>
        <div className="steps">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              className="step"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <span className="stepNumber">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </motion.div>
          ))}
        </div>

        <motion.div className="providerStrip" {...fade}>
          <KeyRound size={18} />
          <p>
            Bring your own AI: works with <b>Groq</b>, <b>Gemini</b>, <b>OpenAI</b> and <b>OpenRouter</b>, or try it
            instantly in offline demo mode.
          </p>
        </motion.div>
      </section>

      <section id="about" className="aboutSection">
        <motion.div className="aboutCard" {...fade}>
          <div>
            <div className="eyebrow">ABOUT</div>
            <h2>
              Made by <span>Prism Protocol.</span>
            </h2>
            <p>
              Prism Protocol is a next-gen tech community where young builders learn, ship and compete together
              through hackathons, ideathons and coding challenges. Prism AI is our open-source workspace for turning
              those ideas into real projects.
            </p>
            <div className="heroActions">
              <Link href="/dashboard" className="primaryButton">
                Start building <ArrowRight size={17} />
              </Link>
              <a className="secondaryButton" href="https://dc.gg/prismprotocol" target="_blank" rel="noreferrer">
                Join the community
              </a>
            </div>
          </div>
          <div className="aboutMark" aria-hidden>
            <span>◇</span>
          </div>
        </motion.div>
      </section>

      <footer className="siteFooter">
        <div className="brand">
          <span className="brandMark">◇</span>
          PRISM <strong>AI</strong>
        </div>
        <div className="footerLinks">
          <Link href="/dashboard">Workspace</Link>
          <a href="https://github.com/krishyaa06/prism-ai" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://dc.gg/prismprotocol" target="_blank" rel="noreferrer">
            Discord
          </a>
        </div>
        <span>© 2026 Prism Protocol · Build. Explore. Create.</span>
      </footer>
    </main>
  );
}
