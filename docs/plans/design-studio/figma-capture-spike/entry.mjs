import { createFigmaConverter } from "@figit/dom-to-figma";
import { encodeFigmaData, composeClipboardHtml, parseClipboardHtml, decodeFigmaData } from "@figit/fig-kiwi";
window.__toFigma = async (sel, width) => {
  const fontLoader = async ({ family, weight, italic }) => {
    const b64 = await window.__loadFont(family, weight, italic);
    return { bytes: Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer };
  };
  const root = document.querySelector(sel);
  const r = await createFigmaConverter({ fontLoader, trace: true }).convert({ element: root, width, height: Math.ceil(root.getBoundingClientRect().height), name: "Storefront / home" });
  // Anchor layers: frames whose source element carries a Shopify section id or data-mos-id get "mos:<anchor>"
  const key = g => `${g.sessionID}:${g.localID}`;
  const byGuid = new Map(r.document.nodeChanges.map(n => [key(n.guid), n]));
  let renamed = 0;
  for (const e of r.trace.entries) {
    if (e.kind === "text") continue;
    const el = e.domPath === ":scope" ? root : root.querySelector(e.domPath);
    const anchor = el?.dataset?.mosId || (el?.id?.startsWith("shopify-section-") ? el.id : null);
    const n = byGuid.get(key(e.guid));
    if (anchor && n) { n.name = `mos:${anchor}`; n.autoRename = false; renamed++; }
  }
  const meta = parseClipboardHtml(r.toClipboardHtml()).meta;
  const html = composeClipboardHtml(encodeFigmaData(r.document).base64, meta);
  // Round-trip check: decode what we'd put on the clipboard
  const back = decodeFigmaData(parseClipboardHtml(html).fig);
  const nodes = back.message?.nodeChanges ?? back.nodeChanges ?? [];
  return { renamed, traceEntries: r.trace.entries.length, bytes: html.length,
    anchors: nodes.filter(n => (n.name||"").startsWith("mos:")).map(n => `${n.type} ${n.name}`) };
};
