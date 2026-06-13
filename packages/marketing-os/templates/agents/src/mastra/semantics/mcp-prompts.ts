// agents/src/mastra/semantics/mcp-prompts.ts
//
// MCP prompts: parameterized analysis playbooks that walk a model through
// explore → query → synthesize with the right views and caveats pre-loaded.

export interface McpPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

export const PROMPTS: McpPrompt[] = [
  {
    name: "weekly_performance_review",
    description: "Summarize last week's site traffic and revenue with channel breakdown and notable changes.",
    arguments: [{ name: "period", description: "named range, e.g. last_7_days (default)", required: false }],
  },
  {
    name: "landing_page_analysis",
    description: "Find the best- and worst-performing landing pages by engagement and tie them to revenue where possible.",
    arguments: [{ name: "period", description: "named range, e.g. last_30_days (default)", required: false }],
  },
  {
    name: "acquisition_audit",
    description: "Audit acquisition: which channels and campaigns drive new users and key events, and where efficiency is slipping.",
    arguments: [{ name: "period", description: "named range, e.g. last_30_days (default)", required: false }],
  },
];

function instructions(body: string): { description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] } {
  const preamble =
    "You have access to a Marketing OS semantic layer over this store's data. " +
    "Start with explore_schema to see available views. For any field you haven't used, " +
    "call describe_field. Use query for data; prefer the semantic views over raw provider " +
    "tools. Read semantic://glossary before comparing metrics across systems. Report numbers " +
    "with their currency and note freshness/caveats from the result envelope.\n\n";
  return {
    description: body.split("\n")[0],
    messages: [{ role: "user", content: { type: "text", text: preamble + body } }],
  };
}

export function getPrompt(name: string, args: Record<string, string>): ReturnType<typeof instructions> | null {
  const period = args.period;
  switch (name) {
    case "weekly_performance_review":
      return instructions(
        `Produce a weekly performance review for the period ${period ?? "last_7_days"}.\n` +
          `1. query traffic: sessions, total_users by channel.\n` +
          `2. query commerce: orders, gross_revenue, aov (by date, grain=day).\n` +
          `3. Call out the biggest channel by sessions and the revenue trend.\n` +
          `4. Flag anything notable, with caveats about GA4 vs Shopify attribution.`
      );
    case "landing_page_analysis":
      return instructions(
        `Analyze landing-page performance for ${period ?? "last_30_days"}.\n` +
          `1. query traffic: sessions, engaged_sessions, engagement_rate by landing_page, ordered by engagement_rate desc, limit 20.\n` +
          `2. Identify the top 5 and bottom 5 landing pages.\n` +
          `3. Where commerce data allows, relate high-traffic pages to revenue.\n` +
          `4. Recommend 2–3 concrete improvements.`
      );
    case "acquisition_audit":
      return instructions(
        `Audit acquisition for ${period ?? "last_30_days"}.\n` +
          `1. query acquisition: sessions, new_users, key_events, session_key_event_rate by channel.\n` +
          `2. Repeat by campaign to find the best/worst campaigns.\n` +
          `3. Highlight channels where the key-event rate is dropping.\n` +
          `4. If ads_performance is unavailable, note that connecting Google Ads/Meta would enable spend/ROAS.`
      );
    default:
      return null;
  }
}
