# Arthaus — Visual Identity & Design Exploration Prompts

> **Pipeline artifact (spec 22 §Definition Pipeline, stage 4: VISUAL EXPLORATION).**
> The worked example of a design-exploration prompt pack: composed from the
> converged brand soul ([brand.md](./brand.md)) during the Arthaus redesign and
> fanned out to design/image-generation agents to produce many diverse visual
> identity candidates per surface. The owner-selected syntheses became
> [DESIGN.md](./DESIGN.md) and the canonical "vision PDP" reference. The
> generalizable template: a **Context Brief** (brand north star, aesthetic
> north star, aesthetic references, the two registers, implementation
> constraints — all derivable from brand.md) followed by **per-surface
> prompts**, each = PROMPT (structure + aesthetic direction) + EXPLORATION
> NOTES (the diversity axes to vary across generations). Surface set: PDP,
> collection/browse, AI-concierge micro-app, configurator, homepage,
> profile/personalization, editorial article, email system, component
> library, ad creative templates.


ARTHAUS
Art that lives where you do.

Visual Identity & Design Exploration Prompts
A brief for UX/graphic design exploration across key brand surfaces

CONFIDENTIAL  |  April 2026

Context Brief for Design Exploration
This document contains a series of design exploration prompts for a UX graphic design agent. Each prompt targets a specific brand surface or component and should be explored independently to generate raw visual inspiration. The outputs will be synthesized into a unified visual identity system and then taken through a full UX design process.
Brand North Star
Art that lives where you do.

Arthaus is a curated online art marketplace positioned between gallery platforms (Artsy, Saatchi Art) and mass-market decor (Society6, Amazon). We serve the Modern Nest Curator: a design-driven, time-pressed professional (28–40, urban/suburban, $80K–$150K HHI) who wants cohesive, modern art for her home without gallery-level overwhelm. She thinks in rooms, not artists. She buys in sets, not single pieces.
Aesthetic North Star
Our established aesthetic reference is a vision PDP mockup that we consider the canonical expression of the brand:
	•	Contemplative whitespace — the pacing of a gallery monograph, not an e-commerce product grid.
	•	Warm parchment/cream backgrounds (#F5F2ED) — the color of good cotton paper, never stark white.
	•	Editorial serif titles (Canela/Freight Display/Noe Display family) — literary warmth, not geometric coldness.
	•	Art shown framed with natural shadow on warm surfaces — physical presence, not flat digital files.
	•	Thin bronze accent lines (#B07D4F) — evoking framing, craftsmanship, warmth.
	•	Natural wood (raw oak, light ash) as a recurring material texture.
	•	Clean humanist sans-serif (Inter/Söhne/Graphik) for body and UI.
	•	Minimal UI chrome — the art provides all visual energy; the brand provides the frame.
Aesthetic References
	•	Kinfolk magazine — editorial pacing, whitespace, warm photography.
	•	The Line (theline.com) — curated home goods with editorial restraint.
	•	Cereal Magazine — contemplative photography, minimal type treatment.
	•	Aesop — warm minimalism in e-commerce, monastic restraint.
	•	Schoolhouse — warm materiality, craft-forward, livable design.
	•	Ace Hotel lobbies — warm, layered, lived-in, culturally literate.
Two Registers
The brand expresses in two visual registers that share the same palette, typography, and material language:
Editorial register: PDP, Collection pages, Academy, email. Contemplative pacing, large serif titles, single-focal-point layouts, generous whitespace. The “parked in front of a piece” feeling.
Interactive register: Picasso concierge, room analyzer, Quick Shop, configurators. Same palette but denser — card-based layouts, tag chips, swatches, AI-powered recommendations. The “walking through the gallery with a guide” feeling. Still warm and human, never tech-forward.
Constraints
	•	Platform: Shopify storefront with a drop-in micro JS app for Picasso experiences. All designs must be implementable in this context.
	•	The ARTHAUS wordmark (spaced serif letterforms) is retained. Explore how it scales and adapts, not whether to replace it.
	•	Mobile-first. All explorations should lead with mobile and show how they extend to desktop.
	•	Existing long-tail PDP traffic must be preserved — new aesthetic applied to existing URL structure.

Design Exploration Prompts

Prompt 1: The Art-Forward PDP — Mobile
PROMPT:
Design a mobile Product Detail Page for an online art marketplace called Arthaus. This is the single most important page in the experience — it’s where the buyer decides to purchase.
The PDP follows a three-act structure:
Act 1 — Editorial Hero: The artwork title in a large editorial serif (Canela or similar), centered, with extreme whitespace above. A thin bronze accent line beneath the title. The artist name in clean sans-serif below. A 2–3 sentence editorial description in italic sans-serif, centered, warm gray. Then the hero image: the artwork shown framed (natural wood frame) with soft natural shadow on a warm parchment/cream surface, photographed at a slight angle. The image should feel like a physical object you want to own, not a flat digital file.
Act 2 — Configure & Convert: Below the hero, the experience shifts to practical conversion. Size selection as horizontal pill selectors showing dimensions. Frame selection as real texture swatches (natural wood grain, matte black, warm white, unframed) — NOT flat color circles. A material specification callout in a subtle card with monospace type for specs. Price displayed large with a small artist-share callout (“$25 goes to the artist”). Full-width Add to Cart button in charcoal. Trust badges beneath (100-Day Guarantee, Free Shipping, Sustainable Materials, Authentic Art) as small icons with labels.
Act 3 — Deepen & Discover: Art Analysis section with 2–4 thematic tag cards (e.g., “Emotional Intimacy,” “Natural Sanctuary”) each with a bold label and one-sentence description. Meet the Artist section with a small circular photo, name, location, short bio, and a link to their collection. You Might Also Like section as a horizontal scroll of product cards with lifestyle thumbnails.
Overall aesthetic: Warm parchment backgrounds (#F5F2ED), charcoal text (#2D2D2D), bronze accents (#B07D4F). The pacing of a Kinfolk editorial spread — generous breathing room between every section. The art is always the hero. Typography is modern serif for titles, humanist sans-serif for body. The whole page should feel like slowing down to appreciate something beautiful.
A sticky “Add to Cart” bar appears at the bottom of the viewport once the user scrolls past the native CTA button.
EXPLORATION NOTES:
	•	Explore different approaches to the hero image treatment — the framed-with-shadow version vs. a full-bleed lifestyle room shot vs. a clean flat image on parchment.
	•	Try different levels of whitespace in Act 1 — the current vision mock has extreme breathing room; explore whether a slightly more compact version maintains the editorial feel while reducing scroll depth.
	•	Experiment with the frame swatch UI — texture photography vs. material illustrations vs. a hybrid.
	•	The sticky CTA bar should feel like a natural extension of the page, not a floating widget. Explore semi-transparent parchment backgrounds with subtle borders.


Prompt 2: The Room-Forward Collection Page — Mobile
PROMPT:
Design a mobile Collection page for Arthaus — this is the primary landing page for cold traffic from ads and editorial content. It’s room-forward: organized around a spatial/mood theme, not an artist or genre.
The page represents a thematic collection called “Quiet Earth: Warm Abstracts for Living Spaces.”
Structure:
Hero: A full-width lifestyle photograph showing 2–3 pieces from the collection displayed on a warm, naturally-lit living room wall. The collection title in editorial serif overlaid or positioned below the image. A 2–3 sentence curatorial description explaining why these pieces work together: the color relationship, the mood, the spatial logic. Written in a warm, confident voice.
Featured Gallery-Wall Set: Immediately below the hero, feature a pre-curated gallery-wall set as a first-class product. Show the complete arrangement (3 pieces together on a wall), the set name, piece count, total price with per-piece comparison, and a prominent “Shop the Set” CTA. This is NOT an upsell sidebar — it’s the primary product on the page.
Individual Pieces Grid: Below the featured set, individual works from the collection displayed in a relaxed 2-column grid with generous spacing. Each card shows: a lifestyle/in-room thumbnail as the primary image, the artwork title in serif, the artist name in sans-serif, and the price. A “Quick Add” button appears on hover/tap for buyers who don’t need the full PDP.
Art Graph Tags: Visible clickable tags that define this collection’s thematic DNA (e.g., “Warm Earth,” “Contemplative,” “Living Room Scale,” “Organic Texture”). Tapping a tag navigates to an adjacent thematic collection. These create the browse loop.
Curatorial Note: A short mid-page editorial insertion — 1–2 sentences from a curator or the Picasso AI about how to style these pieces. In the warm, knowledgeable-friend voice.
Overall aesthetic: Same warm palette as the PDP but slightly denser — this is a browse page, not a contemplation page. The grid should feel like a curated gallery wall, not a search results page. Lifestyle imagery is primary; flat art images are secondary. Generous margins and rounded card corners maintain the warmth.
EXPLORATION NOTES:
	•	Explore the hero image treatment — full-bleed lifestyle photo with text overlay vs. photo above with title below on parchment.
	•	Try different gallery-wall set presentations — a large lifestyle hero shot of the set vs. an arrangement diagram with individual piece thumbnails.
	•	Experiment with grid density — 2 columns tight vs. 2 columns with generous gaps vs. alternating 1-column features and 2-column grids for visual rhythm.
	•	The Quick Add interaction needs to feel native, not overlay-heavy. Explore inline expansion vs. bottom sheet vs. subtle modal.
	•	Art graph tags could be displayed as a horizontal scroll at the top (filter-like), as floating pills within the grid, or as a dedicated section. Explore all three.


Prompt 3: Picasso Room Analyzer — Mobile Micro-App
PROMPT:
Design the mobile experience for Arthaus’s Picasso AI room analyzer — a micro-app that integrates into the Shopify storefront as a slide-up or pop-up panel. The user uploads or captures a photo of their room, and Picasso analyzes it to recommend art that fits the space.
This is the interactive register of the Arthaus brand — same warm palette, same typography, same material language as the rest of the experience, but functionally denser because it’s a tool. It should feel like getting styling advice from a gallery concierge, not running an AI analysis tool.
Flow:
Screen 1 — Entry: A warm, inviting prompt to share a room photo. “Show me your space and I’ll find art that belongs there.” Camera capture button and photo library option. The tone is conversational and human, not technical.
Screen 2 — Room Analysis: The uploaded room photo displayed large, with subtle visual indicators of what Picasso detected. Below the image: extracted room attributes presented as editorial observations, not technical readouts. Instead of “Detected: Mid-century Modern, Natural Light, Large Wall Space” render them as: “Your space has a modern, minimalist feel with strong natural light and a generous wall above the sofa that’s ready for a statement piece.” Then show the extracted Room Color Palette as large, elegant swatches with subtle color names beneath in monospace type.
Screen 3 — Art Recommendations: Headline in editorial serif: “For Your [Room Type].” A curated set of 4–6 recommended pieces, each shown as a card with: a lifestyle mockup (ideally showing the piece in a similar room context), the artwork title in serif, the artist name, the price, and a subtle affinity indicator expressed in the brand voice (“Palette harmony with your room” or “Scale match for your wall”) rather than a percentage badge. Include a “See as Gallery Wall” option that shows 2–3 recommended pieces arranged together.
Screen 4 — Deep Dive (Optional): Tapping a recommended piece transitions smoothly to its full PDP within the main Shopify experience. The micro-app dismisses naturally.
Overall aesthetic: The micro-app uses the same warm parchment background, bronze accents, and editorial typography as the rest of Arthaus. Card elements have generous padding, rounded corners (8–12px), and subtle warm shadows. The AI intelligence is conveyed through the quality and specificity of recommendations, not through tech-forward UI elements like percentage badges, loading spinners with “analyzing...” labels, or algorithmic terminology. Everything should feel like a human stylist working in real time.
The slide-up/pop-up container should have a subtle rounded top with a pull-down handle. It should feel like a warm drawer opening, not a modal interrupting.
EXPLORATION NOTES:
	•	Explore the entry point — a floating button on the PDP/Collection page, a navigation tab, or an inline prompt within the browse experience.
	•	The room analysis visualization is key. Explore subtle highlight overlays on the room photo vs. annotated callouts vs. simply showing the editorial summary without any visual overlay on the photo.
	•	For affinity indicators, explore different alternatives to percentage badges: verbal descriptors (“Perfect palette match”), visual connectors (a line from room swatch to art swatch), or simply omitting explicit match language and letting the curation speak for itself.
	•	The transition from the micro-app to the main PDP needs to feel seamless. Explore a slide-right transition, a card-expand animation, or a gentle dissolve.
	•	Consider how the Room Color Palette extraction could become a persistent element that follows the user through their shopping session (“shopping for your living room” context bar).


Prompt 4: Gallery-Wall Set Builder — Mobile
PROMPT:
Design a mobile gallery-wall configuration experience for Arthaus. This tool lets the buyer see how multiple pieces look together on a wall, adjust the arrangement, swap individual pieces, and purchase the complete set.
The buyer arrives here from either a Collection page (“Shop the Set”) or from the Picasso room analyzer (“See as Gallery Wall”).
Flow:
Screen 1 — The Wall Preview: A large, clean visualization showing the selected pieces arranged on a warm, neutral wall. The arrangement should feel like a real gallery wall, not a technical diagram. Pieces are shown framed with subtle shadows. Below the preview: the set name, total price with per-piece breakdown, and an “Add Set to Cart” CTA.
Screen 2 — Customize: Beneath the wall preview, each piece in the set is shown as a horizontal card with a small thumbnail, the title, the artist name, the selected size, and a “Swap” option that lets the user replace it with an alternative from the same thematic collection. Tapping “Swap” opens a bottom sheet with 3–4 alternatives that maintain the set’s thematic coherence (powered by the art graph).
Screen 3 — Layout Options: An option to switch between 2–3 pre-designed layout arrangements (horizontal row, staggered salon, grid) with a visual preview of each. Selecting a layout updates the wall preview in real time.
Screen 4 — AR Preview: A button to “See on Your Wall” that activates an AR camera view, placing the complete gallery-wall arrangement on the user’s actual wall. This is the ultimate spatial confidence tool.
Overall aesthetic: Same warm palette. The wall preview visualization is the hero — it should take up at least 60% of the first viewport. Cards, selectors, and CTAs follow the same warm, rounded, generous-padding treatment as the rest of the brand. The experience should feel like rearranging art in your living room with a stylist, not configuring a product in a tool.
EXPLORATION NOTES:
	•	The wall preview visualization is the most important element. Explore different rendering styles: photographic (pieces on a real wall texture), illustrative (clean vector wall with shadow), or blended (real frame textures on a simplified background).
	•	The swap interaction needs to feel curated, not overwhelming. Explore bottom sheets with 3–4 options vs. an inline carousel vs. a full-screen selection overlay.
	•	Consider whether layout options should be abstract icons or thumbnail previews of the actual arrangement with the selected art.
	•	AR preview is a stretch goal but the button/entry point should be designed regardless. Explore how to make it feel like a natural extension of the wall preview, not a separate feature.
	•	Pricing display: explore showing the set discount prominently (“Save $39 as a set”) vs. subtly (“$189 for the set” with per-piece breakdown available on tap).


Prompt 5: Homepage — Mobile
PROMPT:
Design the mobile homepage for Arthaus. This is the brand’s front door — it must communicate the essence (“art that lives where you do”) within the first viewport and guide the Nest Curator into the room-forward discovery experience.
Structure:
Hero: A large, warm lifestyle image of art beautifully displayed in a real home. The brand tagline or a rotating editorial headline in serif overlaid or positioned below. A single CTA that leads into the discovery experience (“Find Art for Your Space” or “Explore Collections”).
Featured Collections: 2–3 thematic collection cards, each showing a lifestyle thumbnail, the collection name in serif, a one-line mood descriptor, and a subtle arrow or CTA. These should feel like editorial spreads, not product tiles. Horizontal scroll or stacked vertically with generous spacing.
Gallery-Wall Sets: A “Ready-to-Hang Sets” section featuring 2–3 pre-curated gallery-wall sets with arrangement thumbnails, set names, and prices. The visual treatment should emphasize that these are complete, styled solutions.
New Arrivals or Weekly Drop: A section featuring the latest pieces, presented as a visually rich horizontal scroll with lifestyle imagery.
Picasso Entry Point: A warm, inviting prompt to try the room analyzer. “Upload a photo of your room and let Picasso find art that fits.” This should feel like a friendly invitation, not a feature announcement.
Artist Spotlight: A compact feature on one artist with a studio photo, a pull quote in serif italic, and a link to their collection.
Overall aesthetic: The homepage should feel like the cover and first few pages of a Kinfolk-style home and art magazine. Warm, spacious, editorially paced. Every element earns its space. No clutter, no banners, no pop-ups competing for attention. The scroll rhythm should alternate between large visual moments (hero, lifestyle images) and compact informational elements (collection cards, set previews) for natural visual breathing.
EXPLORATION NOTES:
	•	The hero is make-or-break. Explore: a single full-bleed lifestyle image, a slow auto-playing lifestyle video loop, or a split-screen with lifestyle left and editorial text right.
	•	Collection cards could be full-width stacked, half-width grid, or horizontal scroll. The editorial feel favors full-width stacked, but test the density trade-off.
	•	The Picasso entry point needs to feel organic to the page, not like a banner ad for a feature. Explore inline placement between sections vs. a persistent subtle floating element.
	•	Consider how the homepage adapts seasonally or based on the art graph’s trending collections without losing its editorial calm.
	•	Explore a “zero-state” personalized homepage for returning visitors: “Welcome back, here’s what’s new in palettes you love.”


Prompt 6: My Style DNA & Profile — Mobile
PROMPT:
Design the user profile and Style DNA experience for Arthaus. This is the personalization hub — it shows the user her aesthetic preferences, saved spaces, and how the platform understands her taste.
Structure:
Profile Header: The user’s name, a minimal avatar, and a persona label that evolves with engagement (starts as “Art Explorer,” graduates to “Nest Curator,” and eventually “Emerging Collector” as behavior shifts). The label should feel warm and aspirational, not clinical.
My Style DNA: A visual representation of the user’s aesthetic preferences, derived from browsing behavior, saves, and purchases. Explore this as: a mood board of saved/purchased pieces, a color palette map of preferred tones, a set of thematic affinity tags (e.g., “Warm Earth | Organic Texture | Contemplative”), or a combination of all three. This should feel like a personal style profile, not a data dashboard.
My Spaces: Saved room photos (from Picasso room analysis or uploaded photos) with the extracted color palette and a count of matched recommendations. Tapping a space should navigate to a personalized Collection page filtered for that specific room.
Saved Art: A grid of saved/wishlisted pieces, displayed with the same warm card treatment as the rest of the site.
Purchase History: Past purchases with artist names and a “Complete the Wall” suggestion for each room context.
Overall aesthetic: This should be the quietest, most editorial part of the experience. Profile pages have the PDP’s breathing room and contemplative pacing. The Style DNA visualization should feel like a personal artifact — something the user is proud of and might share. Think of it as a curated mood board, not a settings page.
EXPLORATION NOTES:
	•	The Style DNA visualization is the creative challenge. Explore: a collage/mood board of saved pieces, an abstract color-field visualization, a set of large tag cards, or a minimal editorial layout that simply lists preferences in beautiful typography.
	•	The persona label graduation (“Art Explorer” → “Nest Curator” → “Emerging Collector”) should feel like an achievement, not a classification. Explore subtle gamification vs. purely editorial labeling.
	•	My Spaces could be presented as room “cards” with the photo and palette, or as a visual gallery. The key is that each space should feel like a project you’re working on.
	•	Consider how this page could serve as a sharing artifact — a shareable “My Style DNA” card for social media that doubles as brand awareness.


Prompt 7: Arthaus Academy Article — Mobile
PROMPT:
Design a mobile article page for Arthaus Academy (arthaus.academy), the brand’s editorial content site. Academy articles capture informational intent, nurture trust, and guide the reader toward curated product collections.
The article is titled “How to Style a Gallery Wall in a Small Apartment.”
Structure:
Article Header: The title in large editorial serif on a warm parchment background with generous top padding. A subtitle or description in sans-serif. Author/curator attribution. Estimated reading time. A hero image showing a beautifully styled small-apartment gallery wall.
Body: Long-form editorial content written in the brand’s knowledgeable-friend voice. Interspersed with: lifestyle photographs of gallery walls in small apartments, layout diagrams showing specific arrangements with dimensions, pull quotes in serif italic, and embedded product callouts. The product callouts should feel native to the editorial flow — a warm card with a lifestyle thumbnail, piece name, artist, price, and a subtle “Shop” link. NOT a disruptive product carousel.
Mid-Article Collection Link: After the most helpful section, a warm, editorial prompt: “If you’re drawn to this look, explore our Quiet Earth collection — curated for exactly this palette.” With a large lifestyle image linking to the Collection page.
Related Articles: 2–3 related articles at the bottom, presented as editorial cards with large thumbnails and serif titles.
Overall aesthetic: The article should feel like a beautifully typeset magazine feature, not a blog post. Large serif headlines, generous line-height in body text (1.6+), wide margins, and warm photography. The commerce integration is there but it never disrupts the editorial value. The reader should feel smarter and more confident by the end, and the product links should feel like natural next steps, not sales pitches.
EXPLORATION NOTES:
	•	Explore the product callout treatment — inline card vs. sidebar-style float vs. a subtle end-of-section block.
	•	The collection link is the critical conversion moment. Explore: a full-width image card with overlay text, a warm editorial prompt with a small thumbnail, or a dedicated “Shop the Look” section.
	•	Consider how Academy articles could include interactive elements (swipeable before/after layout comparisons, tappable arrangement diagrams) without breaking the editorial calm.
	•	The Academy has its own subdomain (arthaus.academy). Explore whether it needs its own slightly differentiated header/navigation or if it uses the marketplace navigation with an “Academy” context indicator.


Prompt 8: Email Design System — Nurture & Post-Purchase
PROMPT:
Design two email templates for Arthaus:
Email 1 — Nurture: “Still thinking about that gallery wall?” A warm, personal email sent to a user who browsed a thematic collection but didn’t purchase. It features: 2–3 pieces from the collection she viewed, shown as warm lifestyle thumbnails with titles and prices. A curated gallery-wall set suggestion. A soft CTA (“See the full collection”). The tone is the warm, personal voice — like a text from a friend who knows your taste.
Email 2 — Post-Purchase Day 7: “Meet the artist behind your new piece.” Features: a hero section with the piece the customer purchased (lifestyle image), followed by a compact artist profile with a studio photo, 2–3 sentences about their practice, and a “See more from [Artist Name]” link. Then a “Complete the Wall” section showing 2–3 companion pieces that pair with their purchase.
Overall aesthetic: Emails use the same warm parchment background, serif headings, and bronze accents. Maximum 600px width. Generous padding. Very minimal — 2–3 content blocks max per email. The art is always shown as lifestyle thumbnails (in-room or framed-with-shadow), never as flat files. CTAs are charcoal buttons with white text, same as the PDP. No banners, no discount badges, no urgency language.
EXPLORATION NOTES:
	•	Explore the nurture email as a single-column editorial flow vs. a 2-up product grid.
	•	The post-purchase artist feature should feel like receiving a personal note, not a marketing email. Explore handwritten-style elements or a more personal layout.
	•	Consider a “framing” metaphor for the email template itself — subtle border treatments that echo the physical framing experience.
	•	Test how the warm parchment background renders across email clients (Outlook, Gmail, Apple Mail). May need a fallback to a web-safe warm off-white.


Prompt 9: Core Component Library — Bridging Elements
PROMPT:
Design the shared UI components that appear across both the editorial and interactive registers of the Arthaus experience. These are the unifying elements that make the PDP, Collection pages, Picasso concierge, and Academy all feel like the same brand.
Components to design:
1. Art Graph Tag Chip: A tappable tag that represents a thematic concept from the art knowledge graph (e.g., “Warm Earth,” “Emotional Intimacy,” “Organic Texture”). Used on PDPs, Collection pages, and Picasso recommendations. Design for resting, hover/pressed, and active/selected states.
2. Product Card: The standard card for displaying an individual artwork. Two variants: (a) Lifestyle variant — primary image is an in-room shot, used on Collection pages and recommendations. (b) Editorial variant — primary image is framed-with-shadow on parchment, used on the PDP “You Might Also Like” and email. Both variants show: title (serif), artist name (sans), price, and a Quick Add or CTA.
3. Gallery-Wall Set Card: A card representing a complete gallery-wall set. Shows: the arrangement image (all pieces together on a wall), set name (serif), piece count, total price, and a “Shop the Set” CTA.
4. Artist Mini-Profile: A compact artist representation used on PDPs, Picasso recommendations, and emails. Circular or rounded-square photo, name, location, 1–2 sentence bio, and a collection link.
5. Color Palette Swatch Strip: A horizontal row of color swatches extracted from either a room photo (in Picasso) or a thematic collection. Shows 4–6 colors with optional monospace labels beneath.
6. Frame Texture Swatch: Individual frame option selectors showing real material texture (wood grain, matte black, warm white). Design for resting, selected, and unavailable states.
7. Trust Badge Row: The 4-icon trust badge strip (100-Day Guarantee, Free Shipping, Sustainable Materials, Authentic Art). Icons should be warm, minimal line illustrations — not clip art.
8. Bronze Accent Divider: The thin decorative line used beneath artwork titles and between sections. Define exact weight, color, and width relative to content.
9. Sticky CTA Bar: The Add to Cart bar that fixes to the bottom of the viewport on scroll. Semi-transparent warm background, price, and button.
10. Section Heading: The editorial serif heading treatment used for PDP sections (Art Analysis, Meet the Artist) and Collection page sections. Define size, weight, spacing, and when to use serif vs. sans heading styles.
For each component, design at both mobile and desktop scales. Show all interactive states. Annotate with exact colors (hex), type sizes, padding, and border-radius values.
EXPLORATION NOTES:
	•	The Art Graph Tag Chip is the most important unifying element — it must feel at home on a quiet PDP and an interactive Picasso screen.
	•	Product cards need to scale gracefully from a Collection grid (compact) to a recommendation row (medium) to an email (large).
	•	Frame texture swatches should feel tactile — explore whether a subtle inner shadow or border treatment helps convey materiality on screen.
	•	Trust badge icons: explore a set that feels hand-drawn/artisanal vs. clean geometric vs. somewhere between. The icons should reinforce the “craft” and “care” brand qualities.


Prompt 10: P-Max Ad Creative Templates — Thematic Collection Ads
PROMPT:
Design a set of Performance Max ad creative templates for Arthaus. These ads drive cold traffic from Google to thematic Collection pages. They must work across Google’s ad placements: Search, Display, YouTube, Discover, and Gmail.
The ads represent a thematic collection called “Quiet Earth: Warm Abstracts for Living Spaces.”
Templates needed:
1. Square (1:1) Static — Display/Discover: A lifestyle image showing 2–3 pieces from the collection on a warm living room wall. The Arthaus wordmark in the top-left corner. A headline in editorial serif overlaid on a warm parchment bar at the bottom: “Your living room is one gallery wall away.” Minimal — the image does the selling.
2. Landscape (1.91:1) Static — Display/Gmail: Split composition. Left: the lifestyle wall image. Right: warm parchment background with the collection name in serif, a one-line description, and a subtle CTA (“Explore the Collection”). The Arthaus wordmark anchors the top.
3. Portrait (4:5) Static — Discover/Social: Before-and-after composition. Top half: a bare, empty wall. Bottom half: the same wall with a gallery-wall set installed. The headline: “That blank wall above the sofa? It’s ready.” Parchment strip at bottom with Arthaus wordmark and CTA.
4. Short Video (6–15 sec, 9:16) — YouTube Shorts/Discover: Opens on a bare room. Camera slowly pushes in as art appears on the wall (transition, not animation). End frame holds on the styled wall with the collection name and Arthaus wordmark. No voiceover — warm ambient music. Text overlay: “Art that lives where you do.”
Overall creative direction: The ads should feel like a glimpse into the Arthaus editorial experience, not traditional e-commerce ads. Warm photography, minimal text, no discount badges or urgency language, no “SHOP NOW” buttons. The CTA is always soft and inviting. The brand signal is taste, confidence, and warmth. Every ad should make the viewer think: “I want my home to look like that.”
EXPLORATION NOTES:
	•	Explore whether the lifestyle imagery should feature recognizable room styles (mid-century, Scandinavian, Japandi) to match the art graph’s thematic targeting, or stay neutral to appeal broadly.
	•	The before/after concept is the strongest formula per our creative intelligence. Explore different executions: literal side-by-side, scroll-reveal, or the slow-zoom video treatment.
	•	The parchment text bar at the bottom of static ads is a brand signature element. Explore different heights, opacities, and serif/sans combinations for headline and CTA.
	•	For the video template, explore the transition from empty wall to styled wall: instant cut, a slow dissolve, or a physical “hanging” motion.



ARTHAUS
Art that lives where you do.

Each prompt should be explored independently. Outputs will be synthesized into a unified visual identity system.
