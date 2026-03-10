"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // TODO: Implement Supabase magic link login
      setMessage("Check your email for the magic link!");
    } catch (error) {
      setMessage("Error sending magic link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">Marketing OS</h1>
          <p className="text-muted-foreground">
            AI marketing operations for your Shopify store
          </p>
        </div>

        <div className="bg-card border rounded-lg p-8">
          <h2 className="text-2xl font-semibold mb-6">Sign in</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 border rounded-md bg-background"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
          </form>

          {message && (
            <p className="mt-4 text-sm text-center text-muted-foreground">
              {message}
            </p>
          )}
        </div>

        <p className="text-center text-sm text-muted-foreground">
          No password required. We'll send you a magic link to sign in.
        </p>
      </div>
    </div>
  );
}
