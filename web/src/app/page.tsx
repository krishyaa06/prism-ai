import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth";
import { AuthPanel } from "@/components/auth-panel";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function HomePage() {
  if (await getVerifiedUser()) redirect("/dashboard");
  return (
    <main className="shell landing-shell">
      <div className="landing-toolbar">
        <a className="landing-brand" href="/" aria-label="Prism home">
          <Image src="/prism-logo.png" alt="" width={46} height={46} priority />
          <span>PRISM<small>PERSONAL DIGITAL WORKER</small></span>
        </a>
        <ThemeToggle />
      </div>
      <section className="hero">
        <h1>Your AI.<br />Your tools.<br /><span>Your control.</span></h1>
        <p className="intro">
          Connect your own model endpoint. Prism Agent in the web console plans multi-step
          goals, searches the web, runs code in a sandbox, writes files and cites its sources,
          asking before anything consequential. On Android, Prism executes approved phone actions locally.
        </p>
        <div className="notice">
          Cloud tasks send the screen context you approve to your configured Prism model endpoint.
          Android permissions and protected surfaces remain in force.
        </div>
      </section>
      <AuthPanel />
      <footer className="legal-footer">
        <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/PRIVACY.md">Privacy draft</a>
        <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/TERMS.md">Terms draft</a>
        <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/ACCEPTABLE_USE.md">Acceptable use</a>
        <span>Drafts only; review with qualified counsel before launch.</span>
      </footer>
    </main>
  );
}
