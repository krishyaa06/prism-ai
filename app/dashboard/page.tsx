"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

const documents = [
  {
    title: "Building reliable AI workflows",
    type: "Research note",
    updated: "12 min ago",
    color: "cyan",
  },
  {
    title: "Product design systems",
    type: "Project document",
    updated: "Yesterday",
    color: "violet",
  },
  {
    title: "Open-source roadmap",
    type: "Planning note",
    updated: "2 days ago",
    color: "green",
  },
];

export default function DashboardPage() {
  return (
    <main className="dashboardPage">
      <aside className="dashboardSidebar">
        <div className="dashboardBrand">
          <span>◇</span> PRISM <b>AI</b>
        </div>

        <div className="sidebarSection">
          <small>WORKSPACE</small>

          <a className="dashboardActive" href="/dashboard">
            <LayoutDashboard size={16} />
            Overview
          </a>

          <a href="#documents">
            <FileText size={16} />
            Documents
          </a>

          <a href="#assistant">
            <MessageSquare size={16} />
            AI Assistant
          </a>

          <a href="#projects">
            <FolderKanban size={16} />
            Projects
          </a>

          <a href="#library">
            <BookOpen size={16} />
            Knowledge library
          </a>
        </div>

        <div className="sidebarSection sidebarBottom">
          <small>ACCOUNT</small>

          <a href="#settings">
            <Settings size={16} />
            Settings
          </a>

          <div className="profileCard">
            <div className="profileAvatar">K</div>
            <div>
              <strong>Krishyaa</strong>
              <small>Free workspace</small>
            </div>
          </div>
        </div>
      </aside>

      <section className="dashboardContent">
        <header className="dashboardHeader">
          <div>
            <div className="dashboardEyebrow">
              <Sparkles size={14} />
              YOUR WORKSPACE
            </div>

            <h1>Good morning, builder.</h1>
            <p>What will you explore today?</p>
          </div>

          <div className="headerActions">
            <button className="searchButton">
              <Search size={16} />
              Search
              <kbd>⌘ K</kbd>
            </button>

            <button className="newButton">
              <Plus size={17} />
              New document
            </button>
          </div>
        </header>

        <div className="dashboardGrid">
          <motion.div
            className="welcomeCard"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div>
              <div className="dashboardEyebrow">PRISM AI ASSISTANT</div>
              <h2>Start with a question.</h2>
              <p>
                Ask Prism to summarize your ideas, explain a concept or help
                you structure your next project.
              </p>

              <button className="assistantButton">
                Open AI Assistant <ArrowUpRight size={16} />
              </button>
            </div>

            <div className="orb">
              <span>✦</span>
            </div>
          </motion.div>

          <div className="statsCard">
            <div className="cardHeader">
              <span>THIS WEEK</span>
              <button>•••</button>
            </div>

            <div className="focusScore">94%</div>
            <p>Focus score</p>

            <div className="progressTrack">
              <div className="progressValue" />
            </div>

            <small>+12% from last week</small>
          </div>
        </div>

        <section id="documents" className="documentsSection">
          <div className="sectionTitle">
            <div>
              <span className="dashboardEyebrow">YOUR LIBRARY</span>
              <h2>Recent documents</h2>
            </div>

            <button className="viewAllButton">View all</button>
          </div>

          <div className="documentGrid">
            {documents.map((document, index) => (
              <motion.article
                className="documentCard"
                key={document.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                whileHover={{ y: -5 }}
              >
                <div className={`documentIcon ${document.color}`}>
                  <FileText size={20} />
                </div>

                <div className="documentInfo">
                  <h3>{document.title}</h3>
                  <p>{document.type}</p>
                </div>

                <div className="documentFooter">
                  <span>{document.updated}</span>
                  <ArrowUpRight size={15} />
                </div>
              </motion.article>
            ))}

            <button className="createCard">
              <span>
                <Plus size={20} />
              </span>
              <strong>Create a document</strong>
              <small>Start with a blank workspace</small>
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
