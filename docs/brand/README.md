# Marketing OS — the mark

![Marketing OS](marketing-os-mark-512.png)

A Didot **M** in gold on ink. Both colours are the console's own tokens, not
approximations:

| Token | Value | Role |
|---|---|---|
| `--color-ink` | `#1b263b` | field |
| `--color-gold` | `#c4a47c` | letterform |

## Why this and not something cleverer

The mark's job is to be recognisable at 32px in a commit log, next to
`marketing-os-agent[bot]`. That is where it will actually be seen, far more
often than anywhere else.

A first pass set the M inside generous margins with a gold rule beneath it —
the editorial hairline that runs through the whole design system. It was the
better drawing at 256px and unusable below 64px: the rule collapsed to a single
grey pixel and read as dirt on the glyph, and the small M lost presence against
too much field. Rendering both variants down to 32px settled it in one look.

So: no rule, and the letterform fills the frame. Didot carries the same
high-contrast editorial register as the console's Playfair Display, which is
what makes it read as *this* product rather than a generic monogram.

## Files

| File | Use |
|---|---|
| `marketing-os-mark-1024.png` | source; regenerate other sizes from this |
| `marketing-os-mark-512.png` | GitHub App logo, OG images |
| `public/favicon.ico` | multi-resolution 16→256, shipped in each app |
| `public/apple-touch-icon.png` | 180px |
| `public/icon-512.png` | PWA / manifest |

## Where it is NOT used

The Arthaus console (`www.arthaus.cloud`) keeps its own mark. A client-owned
console is the client's brand surface; the platform does not stamp itself on it.
