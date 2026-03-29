"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
      setMessage("Authentication failed. Please try again.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Invalid email or password. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border p-10">
      {/* Eyebrow */}
      <div className="flex items-center gap-4 mb-8">
        <span className="w-8 h-[1px] bg-secondary" />
        <span className="text-xs font-semibold text-secondary uppercase tracking-label">
          Authentication
        </span>
      </div>

      <h2 className="font-display text-3xl tracking-tight mb-8">Sign in</h2>

      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-label mb-3">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@localhost"
            required
            className="w-full px-4 py-3 border border-border bg-background text-foreground font-body focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-label mb-3">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            required
            className="w-full px-4 py-3 border border-border bg-background text-foreground font-body focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground py-3 font-medium text-sm uppercase tracking-label hover:shadow-card-lg disabled:opacity-50 transition-all"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {message && (
        <p
          className={`mt-6 text-sm text-center font-light ${
            isError ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-4">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-8">
            <span className="w-12 h-[1px] bg-secondary" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-label">
              Avant-Garde
            </span>
            <span className="w-12 h-[1px] bg-secondary" />
          </div>
          <h1 className="font-display text-5xl tracking-tight mb-4">
            Marketing <span className="italic">OS</span>
          </h1>
          <p className="text-muted-foreground font-light leading-relaxed">
            AI marketing operations for your Shopify store
          </p>
        </div>

        <Suspense fallback={<div className="bg-card border border-border p-10 animate-pulse h-80" />}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-muted-foreground font-light uppercase tracking-label">
          Default credentials are shown in the console after init
        </p>

        {/* Footer accent */}
        <div className="flex items-center justify-center gap-4 pt-4">
          <span className="w-8 h-[1px] bg-border" />
          <span className="font-script text-xl text-muted-foreground">Agentic Commerce</span>
          <span className="w-8 h-[1px] bg-border" />
        </div>
      </div>
    </div>
  );
}
