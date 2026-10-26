"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  FileText,
  Sparkles,
  ShieldCheck,
  Layers3,
} from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Context-aware workspace",
    text: "Keep documents, notes and ideas together in one focused workspace.",
  },
  {
    icon: BrainCircuit,
    title: "AI-assisted thinking",
    text: "Explore concepts, summarize documents and turn research into useful insights.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    text: "Keep sensitive keys server-side and make security part of the product.",
  },
];

export default function Home() {
  return (
    <main>
      <nav className="navbar">
        <div className="brand">
          <span className="brandMark">◇</span>
          PRISM <strong>AI</strong>
        </div>

        <div className="navLinks">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#about">About</a>
          <button className="outlineButton">Sign in</button>
        </div>
      </nav>

      <section className="hero">
        <div className="heroGlow" />

        <motion.div
          className="heroContent"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          <div className="eyebrow">
            <Sparkles size={15} />
            AI workspace for curious builders
          </div>

          <h1>
            Turn ideas into <span>clarity.</span>
          </h1>

          <p>
            Prism AI brings your documents, research and creative thinking into
            one beautiful workspace built for the next generation of developers.
          </p>

          <div className="heroActions">
            <button className="primaryButton">
              Explore Prism <ArrowRight size={17} />
            </button>

            <button className="secondaryButton">View on GitHub</button>
          </div>

          <div className="trustLine">
            <span className="statusDot" />
            Open source starter · Built for learning · Designed with intent
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
              <div>◌ Citations</div>
            </aside>

            <div className="workspace">
              <small>MONDAY, OCTOBER 26</small>
              <h3>Good morning, builder.</h3>
              <p>What will you explore today?</p>

              <div className="stats">
                <div>
                  <b>12</b>
                  <small>Documents</small>
                </div>
                <div>
                  <b>28</b>
                  <small>Saved ideas</small>
                </div>
                <div>
                  <b>94%</b>
                  <small>Focus score</small>
                </div>
              </div>

              <div className="promptBox">
                Ask Prism anything...
                <span>↗</span>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      <section id="features" className="featuresSection">
        <div className="sectionHeader">
          <div className="eyebrow">BUILT FOR MOMENTUM</div>
          <h2>
            Simple tools for <span>serious thinking.</span>
          </h2>
        </div>

        <div className="featureGrid">
          {features.map((feature, index) => {
            const Icon = feature.icon;

            return (
              <motion.article
                className="featureCard"
                key={feature.title}
                whileHover={{ y: -7 }}
                transition={{ type: "spring", stiffness: 260 }}
              >
                <div className="featureIcon">
                  <Icon size={20} />
                </div>

                <span className="featureNumber">
                  0{index + 1}
                </span>

                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <footer>
        <div className="brand">
          <span className="brandMark">◇</span>
          PRISM <strong>AI</strong>
        </div>
        <span>Build. Explore. Create.</span>
      </footer>
    </main>
  );
}
