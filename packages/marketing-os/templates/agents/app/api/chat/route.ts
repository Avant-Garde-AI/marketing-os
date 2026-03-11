import { mastra } from "@/src/mastra";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const agent = mastra.getAgent("marketingAgent");
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    const result = await agent.generate(messages);

    return Response.json({ result });
  } catch (error) {
    console.error("Chat error:", error);
    return Response.json(
      { error: "Failed to process chat" },
      { status: 500 }
    );
  }
}
