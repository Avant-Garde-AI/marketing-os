import { NextRequest, NextResponse } from "next/server";
import { mastra } from "@/src/mastra";
import { getSkill } from "@/src/mastra/skills/_registry";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  const { skillId } = await params;
  const skill = getSkill(skillId);

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = skill.inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await skill.tool.execute({
    context: parsed.data,
    mastra,
  });

  return NextResponse.json(result);
}
