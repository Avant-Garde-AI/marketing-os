/**
 * The public Brand Portal (spec 22 §Portal) — a store's Brand Soul rendered as
 * an editorial, magazine-grade read in the Avant-Garde theme: warm paper,
 * ink + gold, Playfair display over Lora prose, hairline rules, generous air.
 * The human face of the same manifest agents fetch at ./llms.txt.
 */
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getPortalData } from "@/src/mastra/brand/portal";

export const runtime = "nodejs";
export const revalidate = 300;

const INK = "#1b263b";
const GOLD = "#9a784e";
const PAPER = "#faf8f4";
const MUTED = "rgba(27,38,59,0.55)";
const HAIR = "1px solid rgba(27,38,59,0.14)";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPortalData(slug);
  if (!data) return { title: "Brand not found" };
  return {
    title: `${data.name} — Brand Soul`,
    description: data.essence ?? `The brand identity of ${data.name}`,
    alternates: { types: { "text/markdown": `/brand/${slug}/file/brand.md` } },
  };
}

const mdComponents = {
  p: (props: any) => <p style={{ margin: "0 0 1.1em", lineHeight: 1.75 }} {...props} />,
  strong: (props: any) => <strong style={{ fontWeight: 600, color: INK }} {...props} />,
  em: (props: any) => <em style={{ color: "rgba(27,38,59,0.78)" }} {...props} />,
  a: (props: any) => <a style={{ color: GOLD, textDecoration: "underline" }} {...props} />,
  ul: (props: any) => <ul style={{ margin: "0 0 1.1em", paddingLeft: 22, lineHeight: 1.7 }} {...props} />,
  ol: (props: any) => <ol style={{ margin: "0 0 1.1em", paddingLeft: 22, lineHeight: 1.7 }} {...props} />,
  blockquote: (props: any) => (
    <blockquote
      style={{
        margin: "1.6em 0",
        padding: "0.2em 0 0.2em 22px",
        borderLeft: `2px solid ${GOLD}`,
        fontFamily: "'Playfair Display', Georgia, serif",
        fontStyle: "italic",
        fontSize: 21,
        lineHeight: 1.55,
        color: "rgba(27,38,59,0.85)",
      }}
      {...props}
    />
  ),
  h3: (props: any) => (
    <h3 style={{ fontFamily: "Lora, Georgia, serif", fontSize: 19, margin: "1.6em 0 0.6em", color: INK }} {...props} />
  ),
  table: (props: any) => (
    <div style={{ overflowX: "auto", margin: "1.2em 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }} {...props} />
    </div>
  ),
  th: (props: any) => (
    <th style={{ textAlign: "left", padding: "8px 14px 8px 0", borderBottom: `2px solid ${INK}`, fontWeight: 600 }} {...props} />
  ),
  td: (props: any) => <td style={{ padding: "9px 14px 9px 0", borderBottom: HAIR, verticalAlign: "top", lineHeight: 1.55 }} {...props} />,
  code: (props: any) => (
    <code style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.88em", background: "rgba(27,38,59,0.05)", padding: "1px 5px" }} {...props} />
  ),
  hr: () => <hr style={{ border: "none", borderTop: HAIR, margin: "2em 0" }} />,
};

export default async function BrandPortal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPortalData(slug);
  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: PAPER, display: "grid", placeItems: "center", fontFamily: "Lora, serif", color: INK }}>
        <p>No published brand here (yet).</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK, fontFamily: "Lora, Georgia, serif" }}>
      {/* Masthead */}
      <header style={{ maxWidth: 900, margin: "0 auto", padding: "72px 24px 0", textAlign: "center" }}>
        <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, letterSpacing: "0.28em", textTransform: "uppercase", color: MUTED }}>
          A Brand Soul
        </div>
        <h1
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: "clamp(40px, 7vw, 72px)",
            fontWeight: 500,
            margin: "18px 0 10px",
            letterSpacing: "0.01em",
          }}
        >
          {data.name}
        </h1>
        {data.essence && (
          <p style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic", fontSize: "clamp(19px, 3vw, 26px)", color: "rgba(27,38,59,0.8)", margin: "0 0 26px" }}>
            {data.essence}
          </p>
        )}
        <div style={{ width: 48, height: 2, background: GOLD, margin: "0 auto 22px" }} />
        <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 12.5, color: MUTED }}>
          brand.md v{data.version}
          {data.updated ? ` · ${data.updated}` : ""} · versioned & provenance-tagged · distilled with Marketing OS
        </div>
      </header>

      {/* North star lede */}
      {data.northStar && (
        <section style={{ maxWidth: 720, margin: "56px auto 0", padding: "0 24px", textAlign: "center" }}>
          <p style={{ fontSize: 18.5, lineHeight: 1.8, color: "rgba(27,38,59,0.85)" }}>
            <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: GOLD, display: "block", marginBottom: 12 }}>
              The brand is succeeding when a customer says
            </span>
            <em style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, lineHeight: 1.6 }}>
              {data.northStar.replace(/^A customer describes .*?: ?/i, "")}
            </em>
          </p>
        </section>
      )}

      {/* Palette spread */}
      {Object.keys(data.designColors).length > 0 && (
        <section style={{ maxWidth: 900, margin: "64px auto 0", padding: "0 24px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 0, border: HAIR }}>
            {Object.entries(data.designColors)
              .filter(([, hex], i, arr) => arr.findIndex(([, h]) => h === hex) === i)
              .slice(0, 8)
              .map(([name, hex]) => (
                <div key={name} style={{ flex: "1 1 100px", minWidth: 100 }}>
                  <div style={{ height: 110, background: hex }} />
                  <div style={{ padding: "10px 8px 12px", textAlign: "center", borderTop: HAIR, background: "#fff" }}>
                    <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 11.5, fontWeight: 600 }}>{name}</div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: MUTED, marginTop: 2 }}>{hex}</div>
                  </div>
                </div>
              ))}
          </div>
          <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 11.5, color: MUTED, textAlign: "center", marginTop: 10 }}>
            The visual system, from DESIGN.md v{data.designVersion} — the soul&apos;s sibling document
          </div>
        </section>
      )}

      {/* Sections — the magazine body */}
      <main style={{ maxWidth: 680, margin: "24px auto 0", padding: "0 24px 40px", fontSize: 16.5 }}>
        {data.sections.map((s, i) => (
          <section key={s.heading} style={{ paddingTop: 56 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, borderBottom: HAIR, paddingBottom: 10, marginBottom: 22 }}>
              <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, color: GOLD, fontStyle: "italic" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 style={{ fontFamily: "Lora, Georgia, serif", fontSize: 26, fontWeight: 500, margin: 0 }}>{s.heading}</h2>
            </div>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {s.body}
            </ReactMarkdown>
          </section>
        ))}
      </main>

      {/* For agents */}
      <footer style={{ borderTop: HAIR, marginTop: 48, background: "#fff" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Inter, system-ui, sans-serif" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: GOLD, marginBottom: 12 }}>For agents</div>
          <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6, margin: "0 0 14px" }}>
            This brand publishes its identity in <a href="https://github.com/google-labs-code/design.md" style={{ color: GOLD }}>DESIGN.md</a> and
            brand.md — machine-readable formats you can fetch directly:
          </p>
          <pre style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, background: "rgba(27,38,59,0.04)", border: HAIR, padding: "14px 16px", overflowX: "auto", lineHeight: 1.8 }}>
            {`/brand/${data.slug}/llms.txt\n/brand/${data.slug}/file/brand.md\n/brand/${data.slug}/file/DESIGN.md`}
          </pre>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 18 }}>
            Brand Soul portal · Marketing OS · brand.md/v0 — versioned, provenance-tagged, owner-approved.
          </p>
        </div>
      </footer>
    </div>
  );
}
