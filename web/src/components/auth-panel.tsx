"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthPanel() {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://web-ten-ruby-10.vercel.app");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${siteOrigin}/auth/callback?next=/dashboard`,
          },
        });
        if (error) throw error;
        setMessage("Check your email to verify your account and continue to Prism.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${siteOrigin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setMessage("If that account exists, a password-reset link has been sent.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.user.email_confirmed_at) {
          await supabase.auth.signOut();
          throw new Error("Verify your email before signing in.");
        }
        window.location.assign("/dashboard");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auth-panel">
      <p className="eyebrow">YOUR PRISM ACCOUNT</p>
      <h2>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}</h2>
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode !== "reset" && <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
      </form>
      <p className="message" aria-live="polite">{message}</p>
      {mode === "signin" && <button className="link-button" onClick={() => { setMode("reset"); setMessage(""); }}>Forgot password?</button>}
      <button className="link-button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
        {mode === "signin" ? "New to Prism? Create an account" : "Return to sign in"}
      </button>
      <p className="fineprint">Email verification is required. Passwords and model credentials are never shown in the Android app.</p>
    </section>
  );
}
