import { redirect } from "next/navigation";

/** Skills is now Playbooks (spec 13 §1 — site framing). */
export default function SkillsRedirect() {
  redirect("/playbooks");
}
