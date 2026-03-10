import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");

  // Verify webhook signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET!;
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;

  if (signature !== expected) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Handle PR events
  if (event === "pull_request") {
    await supabase.from("activity_log").insert({
      type: "pr",
      action: payload.action,
      pr_number: payload.pull_request.number,
      pr_title: payload.pull_request.title,
      pr_url: payload.pull_request.html_url,
      pr_status: payload.pull_request.merged
        ? "merged"
        : payload.pull_request.state,
      branch: payload.pull_request.head.ref,
      metadata: {
        additions: payload.pull_request.additions,
        deletions: payload.pull_request.deletions,
        changed_files: payload.pull_request.changed_files,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
