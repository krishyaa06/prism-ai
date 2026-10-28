"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";

export function PasswordResetForm() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      setMessage("Password updated. You can now sign in with the new password.");
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="reset-shell">
      <header className="reset-toolbar">
        <a className="landing-brand" href="/" aria-label="Prism home">
          <Image src="/prism-logo.png" alt="" width={42} height={42} />
          <span>PRISM<small>PERSONAL DIGITAL WORKER</small></span>
        </a>
        <ThemeToggle />
      </header>
      <section className="panel auth-panel">
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>Set a new password</h1>
        <form onSubmit={submit}>
          <label>New password
            <input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
        </form>
        <p className="message" aria-live="polite">{message}</p>
        <a className="link-button" href="/">Return to sign in</a>
      </section>
    </main>
  );
}
