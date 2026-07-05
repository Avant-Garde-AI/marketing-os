"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eyebrow } from "@/components/primitives";

/**
 * Login — the console's one full-editorial surface (spec 13 §4).
 * Cream form panel · navy manifesto panel. Everything inside is quiet.
 */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "auth_failed") {
      setIsError(true);
      setMessage("That sign-in didn't work. Try again.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Invalid email or password."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin} className="animate-enter-2 space-y-5">
      <div>
        <label htmlFor="email" className="mb-2 block text-[13px] font-medium text-ink-2">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border border-hairline bg-raised px-4 py-3 text-[15px] transition-colors duration-[160ms] placeholder:text-ink-3 focus:border-gold focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-ink-2">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border border-hairline bg-raised px-4 py-3 text-[15px] transition-colors duration-[160ms] placeholder:text-ink-3 focus:border-gold focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-inverse py-3 text-[14px] font-medium text-paper transition-opacity duration-[160ms] hover:opacity-90 disabled:opacity-40"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      {message && (
        <p className={`text-center text-sm ${isError ? "text-danger" : "text-ink-2"}`}>
          {message}
        </p>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Form side — cream */}
      <div className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="animate-enter mb-10">
            <div className="mb-6">
              <Eyebrow draw>Marketing OS</Eyebrow>
            </div>
            <h1 className="text-[34px] leading-tight">
              Agentic <span className="italic">Commerce,</span>
              <br />
              In Practice.
            </h1>
            <p className="mt-3 text-[15px] text-ink-2">
              Sign in to your store&apos;s console.
            </p>
          </div>

          <Suspense fallback={<div className="skeleton h-64 w-full" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>

      {/* Manifesto side — the navy moment */}
      <div className="relative hidden items-center justify-center bg-inverse px-12 lg:flex">
        <div className="absolute left-8 top-8 h-16 w-16 border border-gold-line" />
        <div className="max-w-md">
          <div className="mb-8 flex items-center gap-4">
            <span className="rule" />
            <span className="eyebrow">Manifesto</span>
          </div>
          <blockquote className="font-display text-[28px] italic leading-snug text-paper">
            &ldquo;The future of commerce isn&apos;t just automated. It&apos;s
            autonomous, elegant, and intelligent.&rdquo;
          </blockquote>
          <div className="mt-8 flex items-center justify-between border-t border-paper-line pt-6">
            <span className="text-xs uppercase tracking-[0.2em] text-paper-2">
              Avant-Garde Labs
            </span>
            <span className="font-script text-3xl text-paper-2">Avant-Garde.</span>
          </div>
        </div>
        <div className="absolute bottom-8 right-8 h-16 w-16 border border-gold-line" />
      </div>
    </div>
  );
}
