import Link from "next/link";
import { SocialBacklogProduction } from "@/components/review/social-backlog-production";
export const dynamic="force-dynamic";
export default function BacklogPage(){return <main className="mx-auto max-w-5xl px-4 py-10"><Link href="/social" className="arrow-link">Back to Social</Link><h1 className="mt-6 font-display text-3xl">Social production backlog</h1><SocialBacklogProduction /></main>;}
