import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth";
import { AuthPanel } from "@/components/auth-panel";

export default async function HomePage() {
  if (await getVerifiedUser()) redirect("/dashboard");
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PRISM • PERSONAL DIGITAL WORKER</p>
        <h1>Your AI.<br />Your tools.<br /><span>Your control.</span></h1>
        <p className="intro">
          Connect your own model endpoint. Prism plans multi-step tasks in the cloud
          and your Android device executes approved actions locally.
        </p>
        <div className="notice">
          Cloud tasks send the screen context you approve to your configured Prism model endpoint.
          Android permissions and protected surfaces remain in force.
        </div>
      </section>
      <AuthPanel />
    </main>
  );
}
