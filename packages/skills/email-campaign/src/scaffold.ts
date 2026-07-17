/**
 * WS2-R6 — the email design-system scaffold (06 §2/§3/§4).
 *
 * `scaffoldEmailSystem(tokens, opts)` produces the Arthaus-shaped `email/`
 * design system for ANY store repo: brand-tokenized partials, starter
 * archetype templates, the agent-facing authoring README, an empty registry,
 * and a render-check fixture. It is the PRD §8 Q5 cold-start answer — the
 * scaffold IS the platform default skeleton, brand-tokenized; when Klaviyo
 * ingestion (04 §3) later yields usable frame pieces, ingested partials
 * REPLACE these defaults (provenance recorded).
 *
 * PURE AND DETERMINISTIC: same tokens + opts → the same Record, byte for
 * byte. No Date, no randomness — any version stamp comes from `opts`. Repo
 * writes happen at the caller's seam (hosted runtime tool or a coding-agent
 * session); the generator never touches git.
 *
 * The generalized partials follow the PROVEN as-built Arthaus
 * `marketplace/emails/` system (06 §0 — its pattern and abstraction are
 * binding): `<!--PARTIAL:name-->` markers composed by email-assembly's
 * `composePartials` (marker-identical to Arthaus compose.js), Klaviyo Django
 * tags preserved verbatim, table layouts, inline styles, 600px column, VML
 * button fallback, dark-mode head block.
 *
 * Klaviyo-Django discipline inherited from the Arthaus README (the single
 * highest-value piece of agent knowledge, shipped in the scaffolded
 * email/README.md): no Shopify-only filters, and NEVER template-tag syntax
 * inside HTML comments — the engine parses comments too.
 */

import { resolveEmailBrandTheme, type DtcgLikeTokens, type EmailBrandTheme } from "./brand-tokens";

export interface ScaffoldEmailSystemOptions {
  /** The store's display name — wordmark bar, legal line, README. */
  storeName: string;
  /** Storefront URL the wordmark (and starter links) point at. */
  storeUrl: string;
  /**
   * Mailing address for the footer's legal line. Omitted → a visible
   * placeholder the owner must replace (CAN-SPAM requires a physical
   * address).
   */
  legalAddress?: string;
  /** From-address documented in the README (placeholder when omitted). */
  fromAddress?: string;
  /**
   * Version stamp recorded in generated files (e.g. the pack version or a
   * DESIGN.md version). Caller-supplied — the generator never reads a clock.
   */
  version?: string;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

/** Trim the leading newline template literals pick up, keep the trailing one. */
function file(content: string): string {
  return content.replace(/^\n/, "");
}

function stamp(opts: ScaffoldEmailSystemOptions): string {
  return `scaffolded by @avant-garde/skill-email-campaign${opts.version ? ` v${opts.version}` : ""}`;
}

// ---------------------------------------------------------------------------
// Partials.
// ---------------------------------------------------------------------------

function headPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  const paletteVars = t.palette
    .map((c) => `      --color-${c.name}: ${c.hex};`)
    .join("\n");
  return file(`
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <!-- ${opts.storeName} email head — ${stamp(opts)}. Token values are inlined below; the CSS custom properties are a reference table (most mail clients ignore them). -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title><!--TITLE--></title>

  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->

  <style>
    /* ── Reset ── */
    * { box-sizing: border-box; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; line-height: 100%; outline: none; text-decoration: none; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    #MessageViewBody a { color: inherit; text-decoration: none; font-size: inherit; font-family: inherit; font-weight: inherit; line-height: inherit; }

    /* ── ${opts.storeName} tokens (from DESIGN.md via DTCG; email subset) ── */
    :root {
${paletteVars ? paletteVars + "\n" : ""}      --color-surface: ${t.surface};
      --color-ink:     ${t.ink};
      --color-accent:  ${t.accent};
      --color-muted:   ${t.muted};
      --color-border:  ${t.border};
      --color-card:    ${t.card};
    }

    /* ── Body ── */
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: ${t.surface};
      font-family: ${t.bodyStack};
      font-size: ${t.base.bodyFontSize}px;
      line-height: ${t.base.bodyLineHeight};
      color: ${t.ink};
    }

    /* ── Responsive ── */
    .email-wrapper { width: 100% !important; }
    .email-container { max-width: 600px !important; margin: 0 auto !important; }

    @media screen and (max-width: 480px) {
      .email-container { width: 100% !important; }
      .mobile-full { width: 100% !important; display: block !important; }
      .mobile-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .mobile-center { text-align: center !important; }
      .mobile-hide { display: none !important; }
      .col-half { width: 100% !important; display: block !important; }
    }

    /* ── Dark mode (Apple Mail / iOS) — damage control, not control ── */
    @media (prefers-color-scheme: dark) {
      .dark-bg        { background-color: #1E1E1E !important; }
      .dark-bg-card   { background-color: #2A2A2A !important; }
      .dark-text      { color: ${t.surface} !important; }
      .dark-text-mute { color: ${t.muted} !important; }
      .dark-border    { border-color: #3A3A3A !important; }
      /* Prevent Outlook dark mode double-inversion */
      [data-ogsc] .dark-bg        { background-color: ${t.surface} !important; }
      [data-ogsc] .dark-text      { color: ${t.ink} !important; }
    }
  </style>
</head>
`);
}

function headerPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  return file(`
<!-- ${opts.storeName} header — wordmark bar -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
  <tr>
    <td style="background-color: ${t.ink}; padding: 24px 40px; text-align: center;">
      <a href="${opts.storeUrl}" style="text-decoration: none; display: inline-block;">
        <span class="brand-wordmark" style="
          font-family: ${t.displayStack};
          font-size: 22px;
          font-weight: ${t.displayWeight};
          color: ${t.surface};
          letter-spacing: 0.25em;
          text-transform: uppercase;
          text-decoration: none;
        ">${opts.storeName.toUpperCase()}</span>
      </a>
    </td>
  </tr>
  <!-- Accent line -->
  <tr>
    <td style="height: 2px; background-color: ${t.accent}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
</table>
`);
}

function footerPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  const address = opts.legalAddress ?? "SET-YOUR-MAILING-ADDRESS (physical address required by CAN-SPAM)";
  return file(`
<!-- ${opts.storeName} footer — links, legal, unsubscribe -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
  <!-- Top border -->
  <tr>
    <td style="height: 1px; background-color: ${t.border}; font-size: 0; line-height: 0;">&nbsp;</td>
  </tr>
  <tr>
    <td style="background-color: ${t.card}; padding: 40px 40px 16px; text-align: center;">
      <!-- Navigation links row — placeholder; replace with this store's real footer navigation -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
        <tr>
          <td style="padding: 0 12px;">
            <a href="${opts.storeUrl}" style="font-family: ${t.bodyStack}; font-size: 12px; color: ${t.muted}; text-decoration: none; letter-spacing: 0.08em; text-transform: uppercase;">Shop</a>
          </td>
        </tr>
      </table>

      <!-- Divider -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px; margin-bottom: 24px;">
        <tr><td style="height: 1px; background-color: ${t.border}; font-size: 0; line-height: 0;">&nbsp;</td></tr>
      </table>

      <!-- Address + legal -->
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.muted}; margin: 0 0 8px; line-height: 1.6;">
        ${opts.storeName} · ${address}
      </p>
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.muted}; margin: 0 0 16px; line-height: 1.6;">
        You're receiving this because you subscribed or made a purchase.
      </p>

      <!-- COMPLIANCE: the two Klaviyo tags below are LOAD-BEARING. Klaviyo renders them
           as the unsubscribe and manage-preferences links; removing or altering them is a
           compliance incident and Klaviyo may refuse the send. Note that the tags live in
           the markup below, never in a comment - the template engine parses comments too. -->
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.muted}; margin: 0;">
        {% unsubscribe %}
        &nbsp;·&nbsp;
        {% manage_preferences %}
      </p>
    </td>
  </tr>
  <tr>
    <td style="background-color: ${t.card}; padding: 24px 0 32px; text-align: center;">
      <span style="font-family: ${t.displayStack}; font-size: 13px; color: ${t.border}; letter-spacing: 0.25em; text-transform: uppercase;">${opts.storeName.toUpperCase()}</span>
    </td>
  </tr>
</table>
`);
}

function buttonPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  const radius = t.base.buttonRadiusPx;
  const arcsize = `${Math.round((radius / 52) * 100)}%`;
  return file(`
<!-- ${opts.storeName} button — VML Outlook fallback + table-cell pattern -->
<!-- Usage: replace BUTTON_URL and BUTTON_LABEL before including -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
  <tr>
    <td align="center" style="border-radius: ${radius}px; background-color: ${t.ink};" class="button-td">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="BUTTON_URL"
        style="height:52px; width:260px; v-text-anchor:middle;"
        arcsize="${arcsize}"
        strokecolor="${t.ink}"
        fillcolor="${t.ink}">
        <w:anchorlock/>
        <center style="color:${t.surface}; font-family:${t.bodyStack.replace(/"/g, "'")}; font-size:15px; font-weight:400; letter-spacing:0.04em;">BUTTON_LABEL</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="BUTTON_URL"
        style="
          display: inline-block;
          background-color: ${t.ink};
          color: ${t.surface};
          font-family: ${t.bodyStack};
          font-size: 15px;
          font-weight: 400;
          line-height: 1;
          letter-spacing: 0.04em;
          text-decoration: none;
          padding: 16px 40px;
          border-radius: ${radius}px;
          mso-hide: all;
          white-space: nowrap;
        "
        class="button-a">
        BUTTON_LABEL
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
`);
}

function dividerPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  return file(`
<!-- ${opts.storeName} divider — hairline rule -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 8px 0;">
  <tr>
    <td style="padding: 0 40px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="height: 1px; background-color: ${t.border}; font-size: 0; line-height: 0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`);
}

function productCardPartial(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  return file(`
<!-- ${opts.storeName} product card — 2-column grid item -->
<!-- Use inside a 2-col table, within a Klaviyo for-loop that binds each row to \`item\`. -->
<!-- (Do not write literal template tags in comments — the engine parses them.) -->
<td class="col-half" style="width: 50%; padding: 8px; vertical-align: top;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${t.card}; overflow: hidden;">
    <tr>
      <td>
        <a href="{{ item.product_url }}">
          <img
            src="{{ item.image_url }}"
            alt="{{ item.title }}"
            width="260"
            height="325"
            style="width: 100%; height: auto; display: block; object-fit: cover;"
          >
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding: 16px;">
        <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px;">{{ item.vendor }}</p>
        <h3 style="font-family: ${t.displayStack}; font-size: 18px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 8px; line-height: 1.3;">{{ item.title }}</h3>
        <p style="font-family: ${t.bodyStack}; font-size: 15px; color: ${t.ink}; margin: 0 0 12px; font-weight: 400;">{{ item.price }}</p>
        <a href="{{ item.product_url }}" style="font-family: ${t.bodyStack}; font-size: 12px; color: ${t.accent}; text-decoration: none; letter-spacing: 0.04em;">View →</a>
      </td>
    </tr>
  </table>
</td>
`);
}

// ---------------------------------------------------------------------------
// Starter archetype templates (Arthaus editorial.html structure; Django-safe).
// ---------------------------------------------------------------------------

function editorialTemplate(t: EmailBrandTheme): string {
  return file(`
<!--PARTIAL:head-->
<body>
<div class="email-wrapper" style="background-color: ${t.surface}; padding: 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-wrapper">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">

  <!--PARTIAL:header-->

  <!-- Hero image -->
  <tr>
    <td style="padding: 0;">
      <a href="{{ editorial.url }}">
        <img src="{{ editorial.hero_image }}" alt="{{ editorial.title }}" width="600" height="340" style="width: 100%; height: auto; display: block; object-fit: cover;">
      </a>
    </td>
  </tr>

  <!-- Editorial content block -->
  <tr>
    <td style="background-color: ${t.card}; padding: 40px 40px 32px;" class="dark-bg-card mobile-pad">
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 12px;">{{ editorial.eyebrow|default:'The Edit' }}</p>
      <h1 style="font-family: ${t.displayStack}; font-size: 34px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 16px; line-height: 1.2;" class="dark-text">{{ editorial.title }}</h1>
      <p style="font-family: ${t.bodyStack}; font-size: 16px; color: ${t.muted}; margin: 0 0 24px; line-height: 1.7;" class="dark-text-mute">{{ editorial.body }}</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="border-radius: ${t.base.buttonRadiusPx}px; background-color: ${t.ink};">
            <a href="{{ editorial.url }}" style="display: inline-block; background-color: ${t.ink}; color: ${t.surface}; font-family: ${t.bodyStack}; font-size: 14px; text-decoration: none; padding: 14px 32px; letter-spacing: 0.04em; border-radius: ${t.base.buttonRadiusPx}px;">
              {{ editorial.cta_label|default:'Explore' }} →
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!--PARTIAL:divider-->

  <!-- Featured products grid -->
  <tr>
    <td style="background-color: ${t.surface}; padding: 32px 40px;" class="mobile-pad">
      <h2 style="font-family: ${t.displayStack}; font-size: 22px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 20px; text-align: center;" class="dark-text">In This Edit</h2>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          {% for item in editorial.products %}
          <!--PARTIAL:product-card-->
          {% endfor %}
        </tr>
      </table>
    </td>
  </tr>

  <!--PARTIAL:footer-->

</table>
</td></tr>
</table>
</div>
</body>
</html>
`);
}

function productReminderTemplate(t: EmailBrandTheme): string {
  return file(`
<!--PARTIAL:head-->
<body>
<div class="email-wrapper" style="background-color: ${t.surface}; padding: 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-wrapper">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">

  <!--PARTIAL:header-->

  <!-- Product hero image -->
  <tr>
    <td style="padding: 0;">
      <a href="{{ product.url }}">
        <img src="{{ product.image }}" alt="{{ product.title }}" width="600" height="500" style="width: 100%; height: auto; display: block; object-fit: cover;">
      </a>
    </td>
  </tr>

  <!-- Intro -->
  <tr>
    <td style="background-color: ${t.card}; padding: 40px 40px 24px; text-align: center;" class="dark-bg-card mobile-pad">
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 12px;">Still Thinking It Over?</p>
      <h1 style="font-family: ${t.displayStack}; font-size: 30px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 12px; line-height: 1.25;" class="dark-text">It's still available.</h1>
      <p style="font-family: ${t.bodyStack}; font-size: 15px; color: ${t.muted}; margin: 0; line-height: 1.7;" class="dark-text-mute">Hi {{ first_name|default:'there' }}, you left something behind.</p>
    </td>
  </tr>

  <!-- Product details card -->
  <tr>
    <td style="background-color: ${t.card}; padding: 24px 40px 40px;" class="dark-bg-card mobile-pad">
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px;">{{ product.vendor }}</p>
      <h2 style="font-family: ${t.displayStack}; font-size: 26px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 8px;" class="dark-text">{{ product.title }}</h2>

      <!-- Selection recap -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${t.surface}; padding: 16px; margin-bottom: 16px;">
        <tr>
          <td style="padding: 12px 16px;">
            <p style="font-family: ${t.bodyStack}; font-size: 12px; color: ${t.muted}; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.06em;">Your selection</p>
            <p style="font-family: ${t.bodyStack}; font-size: 14px; color: ${t.ink}; margin: 0;" class="dark-text">{{ product.variant }}{% if product.frame %}&nbsp;·&nbsp;{{ product.frame }}{% endif %}</p>
          </td>
        </tr>
      </table>

      <p style="font-family: ${t.displayStack}; font-size: 28px; color: ${t.ink}; margin: 0 0 24px;" class="dark-text">{{ product.price }}</p>

      <!-- CTA -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="border-radius: ${t.base.buttonRadiusPx}px; background-color: ${t.ink};">
            <a href="{{ product.checkout_url }}" style="display: inline-block; background-color: ${t.ink}; color: ${t.surface}; font-family: ${t.bodyStack}; font-size: 15px; text-decoration: none; padding: 16px 40px; border-radius: ${t.base.buttonRadiusPx}px; letter-spacing: 0.04em;">
              Complete Your Order →
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!--PARTIAL:footer-->

</table>
</td></tr>
</table>
</div>
</body>
</html>
`);
}

function winbackTemplate(t: EmailBrandTheme): string {
  return file(`
<!--PARTIAL:head-->
<body>
<div class="email-wrapper" style="background-color: ${t.surface}; padding: 32px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-wrapper">
<tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container">

  <!--PARTIAL:header-->

  <!-- Warm personal message -->
  <tr>
    <td style="background-color: ${t.card}; padding: 48px 40px 32px; text-align: center;" class="dark-bg-card mobile-pad">
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 12px;">We Miss You</p>
      <h1 style="font-family: ${t.displayStack}; font-size: 34px; font-weight: ${t.displayWeight}; color: ${t.ink}; margin: 0 0 20px; line-height: 1.2;" class="dark-text">Welcome back, {{ first_name|default:'friend' }}.</h1>
      <p style="font-family: ${t.bodyStack}; font-size: 16px; color: ${t.muted}; margin: 0 0 24px; line-height: 1.7;" class="dark-text-mute">
        It's been a while. There's new work you haven't seen yet, and we'd love to welcome you back with something special.
      </p>
    </td>
  </tr>

  <!--PARTIAL:divider-->

  <!-- Discount code band -->
  <tr>
    <td style="background-color: ${t.ink}; padding: 40px;" class="mobile-pad">
      <p style="font-family: ${t.bodyStack}; font-size: 11px; color: ${t.accent}; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 12px; text-align: center;">A Gift, From Us</p>
      <p style="font-family: ${t.displayStack}; font-size: 22px; color: ${t.surface}; text-align: center; margin: 0 0 20px; line-height: 1.3;">{{ discount.percent_off }}% off your next order</p>

      <!-- Code box -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 300px; margin: 0 auto 20px;">
        <tr>
          <td style="background-color: ${t.surface}; padding: 16px 24px; text-align: center;">
            <p style="font-family: ${t.monoStack ?? t.bodyStack}; font-size: 22px; color: ${t.ink}; margin: 0; letter-spacing: 0.15em; font-weight: 600;">{{ discount.code }}</p>
          </td>
        </tr>
      </table>

      <p style="font-family: ${t.bodyStack}; font-size: 12px; color: ${t.muted}; text-align: center; margin: 0 0 24px;">
        Valid until {{ discount.expires_at }}. One use per customer.
      </p>

      <!-- CTA -->
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
        <tr>
          <td style="border-radius: ${t.base.buttonRadiusPx}px; background-color: ${t.accent};">
            <a href="{{ shop_url }}/collections/all?discount={{ discount.code }}" style="display: inline-block; color: ${t.base.accentTextColor}; font-family: ${t.bodyStack}; font-size: 15px; text-decoration: none; padding: 16px 40px; border-radius: ${t.base.buttonRadiusPx}px; letter-spacing: 0.04em;">
              Shop Now →
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!--PARTIAL:footer-->

</table>
</td></tr>
</table>
</div>
</body>
</html>
`);
}

// ---------------------------------------------------------------------------
// README (06 §3 — the agent-facing authoring guide).
// ---------------------------------------------------------------------------

function readme(t: EmailBrandTheme, opts: ScaffoldEmailSystemOptions): string {
  const paletteRows = t.palette.map((c) => `| \`${c.name}\` | \`${c.hex}\` |`).join("\n");
  return file(`
# ${opts.storeName} Email Design System

Store-repo email authoring system for Klaviyo campaign and lifecycle
templates — ${stamp(opts)}, seeded from this store's DESIGN.md design tokens.
Future coding-agent sessions: read this file first, then \`strategy.md\`.

## Tree

\`\`\`
email/
├── README.md            # this file — the authoring guide
├── strategy.md          # the standing email strategy (audiences, archetypes, guardrails)
├── registry.json        # slug → Klaviyo template id (PATCH-not-duplicate; commit it)
├── partials/            # shared brand-frame components (included in every template)
│   ├── head.html        #   <head>: reset CSS, tokens, dark mode, MSO settings
│   ├── header.html      #   wordmark bar
│   ├── footer.html      #   links, legal, unsubscribe (COMPLIANCE — see below)
│   ├── button.html      #   CTA button (VML Outlook fallback)
│   ├── divider.html     #   hairline rule
│   └── product-card.html#   2-col product grid item
├── templates/           # archetype/lifecycle templates (author here)
│   ├── editorial.html   #   collection / editorial announcement
│   ├── product-reminder.html # abandoned-cart / product reminder
│   ├── winback.html     #   win-back with discount band
│   └── skeletons/{id}/  #   ingested campaign skeletons (pipeline artifacts)
├── fixtures/
│   └── sample-context.json # render-check context for the starter templates
├── calendar/{YYYY-MM}.md   # monthly campaign plans
└── campaigns/{id}/         # agent-run campaign artifacts (campaign.md, assets/, email.html)
\`\`\`

## Authoring templates — the PARTIAL convention

Templates include shared partials with \`<!--PARTIAL:name-->\` markers:

\`\`\`html
<!--PARTIAL:head-->
<body>
  <!--PARTIAL:header-->
  <!-- your template content -->
  <!--PARTIAL:footer-->
</body>
</html>
\`\`\`

Composition is a deterministic single-pass marker→partial splice
(\`composePartials\` in \`@avant-garde/email-assembly\`, marker-identical to the
original Arthaus \`compose.js\`). Klaviyo's own template tags
(\`{{ first_name }}\`, \`{% for item in items %}\`) are **preserved verbatim** —
the compose step never touches them.

## Design tokens (from DESIGN.md, compiled via DTCG)

Semantic roles used throughout the partials:

| Role | Value | Usage |
|---|---|---|
| surface | \`${t.surface}\` | email + board background |
| ink | \`${t.ink}\` | text, header bar, primary CTAs |
| accent | \`${t.accent}\` | eyebrows, accent line, links |
| muted | \`${t.muted}\` | secondary/footer text |
| border | \`${t.border}\` | dividers, hairlines |
| card | \`${t.card}\` | content cards / transactional panels |

Full palette:

| Token | Value |
|---|---|
${paletteRows || "| _(no palette tokens — email-safe defaults in use)_ | |"}

Font stacks (system fallbacks are guaranteed — Outlook ignores web fonts):

- display: \`${t.displayStack}\`
- body: \`${t.bodyStack}\`${t.monoStack ? `\n- mono: \`${t.monoStack}\`` : ""}

## Klaviyo Django vs Shopify Liquid — the split

Klaviyo's template engine is a Django subset, **not** Shopify Liquid. These
Shopify-isms break Klaviyo rendering and must be avoided in Klaviyo templates:

| Shopify Liquid (breaks Klaviyo) | Klaviyo / fix |
|---|---|
| \`{% assign x = '...' \\| split:',' %}\` | not supported — inline the values |
| \`{{ x \\| money }}\`, \`{{ x \\| img_url:'…' }}\` | Shopify-only filters — use plain values / pre-format |
| \`{{ x \\| truncatewords:30 }}\` | not supported — drop it (or pre-truncate) |
| \`{% for x in y limit:2 %}\` | \`limit:\`/\`\\|slice\` unsupported — plain \`{% for %}\`, cap the data |
| **literal \`{% … %}\` inside an HTML comment** | the engine parses tags even in comments → unclosed-tag error. Never write template syntax in comments. |

Order receipts are genuinely Shopify Liquid — they belong in Shopify
notifications, not Klaviyo.

## Email HTML constraints

- **Table-based layouts** — Outlook compatibility; no flex/grid.
- **Inline styles** — the \`<style>\` block carries only what cannot be
  inlined (media queries: mobile stacking, dark mode).
- **600px max width** — single column; stacks at 480px via \`.col-half\`/\`.mobile-*\`.
- **No JavaScript** — blocked everywhere.
- **VML fallbacks** — Outlook button rendering (see \`partials/button.html\`).
- **Explicit image dimensions** + meaningful \`alt\` on every image.
- **Dark mode** — \`prefers-color-scheme\` block in \`head.html\`; damage
  control, not control. Visual brand moments belong in exported boards that
  carry their own background to the edges.
- **Unsubscribe merge tags are LOAD-BEARING** — \`footer.html\` carries
  Klaviyo's unsubscribe + manage-preferences tags. Never remove, rewrite, or
  comment them; every assembled email is mechanically gated on their
  presence.

## Registry discipline

\`registry.json\` maps template slug → Klaviyo template id. First push
creates the template and records its id; every later push **PATCHes the same
id** — never create a duplicate for an existing slug. Campaign templates use
slug \`campaign-{id}\`; lifecycle templates keep their human slugs. Commit the
registry — it is shared team state (ids only, no secrets).

## Pointers

- \`email/strategy.md\` — the standing plan: audiences, archetypes, cadence guardrails.
- \`brand.md\` / \`DESIGN.md\` (repo root or \`agents/brand/\`) — the Brand Soul; copy
  formulas and the token source these partials were generated from.
- \`email/campaigns/{id}/\` — per-campaign artifacts the agent maintains.
- Sending: campaigns are drafted from ${opts.fromAddress ?? "SET-YOUR-FROM-ADDRESS"} via the
  Email Campaign Agent's gated Actions — nothing sends without a human approval.
`);
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function sampleContext(opts: ScaffoldEmailSystemOptions): string {
  const ctx = {
    first_name: "Alex",
    shop_url: opts.storeUrl,
    editorial: {
      url: `${opts.storeUrl}/collections/new`,
      hero_image: "https://example.com/fixtures/editorial-hero.jpg",
      eyebrow: "New Collection",
      title: "The Autumn Edit",
      body: "A short seasonal story introducing the collection, written in the brand voice.",
      cta_label: "Explore the Edit",
      products: [
        {
          product_url: `${opts.storeUrl}/products/example-one`,
          image_url: "https://example.com/fixtures/product-one.jpg",
          vendor: opts.storeName,
          title: "Example Piece One",
          price: "$120",
        },
        {
          product_url: `${opts.storeUrl}/products/example-two`,
          image_url: "https://example.com/fixtures/product-two.jpg",
          vendor: opts.storeName,
          title: "Example Piece Two",
          price: "$95",
        },
      ],
    },
    product: {
      url: `${opts.storeUrl}/products/example-one`,
      checkout_url: `${opts.storeUrl}/checkout`,
      image: "https://example.com/fixtures/product-one.jpg",
      vendor: opts.storeName,
      title: "Example Piece One",
      variant: "18 × 24",
      frame: "Walnut",
      price: "$120",
    },
    discount: {
      percent_off: 10,
      code: "WELCOMEBACK10",
      expires_at: "the end of the month",
    },
  };
  return `${JSON.stringify(ctx, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------

/**
 * Scaffold the `email/` design system: repo-relative path → file content.
 *
 * Pure + deterministic (06 §4 acceptance): double-run equality is a test.
 * The caller owns writing the record into the store repo; when reference
 * templates are later ingested (04 §3), ingested partials replace these
 * seeds with provenance recorded.
 */
export function scaffoldEmailSystem(
  tokens: DtcgLikeTokens | undefined,
  opts: ScaffoldEmailSystemOptions,
): Record<string, string> {
  const t = resolveEmailBrandTheme(tokens);
  return {
    "email/partials/head.html": headPartial(t, opts),
    "email/partials/header.html": headerPartial(t, opts),
    "email/partials/footer.html": footerPartial(t, opts),
    "email/partials/button.html": buttonPartial(t, opts),
    "email/partials/divider.html": dividerPartial(t, opts),
    "email/partials/product-card.html": productCardPartial(t, opts),
    "email/templates/editorial.html": editorialTemplate(t),
    "email/templates/product-reminder.html": productReminderTemplate(t),
    "email/templates/winback.html": winbackTemplate(t),
    "email/README.md": readme(t, opts),
    "email/registry.json": "{}\n",
    "email/fixtures/sample-context.json": sampleContext(opts),
  };
}
