import Link from "next/link";
import { PageHeader, Chip } from "@/components/primitives";

/**
 * Playbooks — the console's capability library (spec 13 §4), framed the way
 * avant-garde.ai frames its open playbooks: numbered volumes, one-line
 * descriptions, a single Run action. Mirrors the registered Mastra skills.
 */

const PLAYBOOKS = [
  {
    vol: "01",
    id: "store-health-check",
    name: "Store Health Check",
    description:
      "Analyze your store's recent performance across orders, traffic, and key metrics.",
    category: "Analytics",
    prompt: "Run the store health check and summarize what needs attention.",
  },
  {
    vol: "02",
    id: "ad-copy-generator",
    name: "Ad Copy Generator",
    description:
      "Generate Meta and Google ad copy variants grounded in your brand voice and products.",
    category: "Creative",
    prompt: "Generate ad copy variants for our current bestseller.",
  },
  {
    vol: "03",
    id: "weekly-digest",
    name: "Weekly Performance Digest",
    description:
      "A comprehensive weekly performance summary — also runs on a schedule, every Monday.",
    category: "Analytics",
    prompt: "Generate this week's performance digest.",
  },
];

export default function PlaybooksPage() {
  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-[1200px]">
        <PageHeader
          eyebrow="Playbooks"
          title="The library"
          sub="Vetted procedures your agents execute on demand — or on a schedule."
        />

        <div className="animate-enter-2 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PLAYBOOKS.map((pb) => (
            <article
              key={pb.id}
              className="group flex flex-col border border-hairline bg-raised p-6 transition-shadow duration-[160ms] hover:bar-active hover:shadow-card"
            >
              <div className="mb-5 flex items-baseline justify-between">
                <span className="tnum font-display text-lg italic text-gold">
                  Vol. {pb.vol}
                </span>
                <Chip variant="outline">{pb.category}</Chip>
              </div>
              <h2 className="mb-2 font-body text-[17px] font-medium tracking-normal">
                {pb.name}
              </h2>
              <p className="mb-6 flex-1 text-sm leading-relaxed text-ink-2">
                {pb.description}
              </p>
              <div className="flex items-center justify-between border-t border-hairline pt-4">
                <Link
                  href={`/chat?prompt=${encodeURIComponent(pb.prompt)}`}
                  className="arrow-link text-[15px]"
                >
                  Run
                </Link>
                <Chip variant="filled">In practice</Chip>
              </div>
            </article>
          ))}
        </div>

        <p className="animate-enter-3 mt-8 text-sm text-ink-3">
          More playbooks arrive with the skill library — pinned, versioned, and
          improved by outcomes across the network.
        </p>
      </div>
    </div>
  );
}
