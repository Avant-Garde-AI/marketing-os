# Original organic cohort: first complete-carousel recovery slice

Status: selected from source metadata on 2026-09-23; **no carousel media has been
recovered or extracted**. This is an acquisition worklist, not a set of observed
narrative patterns. See the [core architecture](../../STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md)
§10 and the [pilot report](CORPUS-PILOT.md).

The [machine-readable worklist](recovery-slice-2026-09-23.json) pins source
object, capture time, post URL, count and selection stratum for every row below.
Acquisition code should read that file rather than parse this table.

## Source and selection

Source: `gs://arthaus-creative-corpus/instagram-organic/2026-09-01/`, GCP
project `arthaus-us`. The 40 `artists/*.json` files were read directly. They
contain 923 post rows: 399 images, 345 sidecars, and 179 videos. This list uses
24 distinct sidecar posts from 24 accounts, six from each source tier. Within
each tier it assigns two short (2–3 child), two medium (4–6), and two long
(7–20) carousels. `field_society6` is a comparison stratum, not a claim that
those artists are on the Arthaus roster.

Frozen source checksum: SHA-256
`506146fcbcf2d449001cfd8e249a86f33117598b6e11a67d9ab2fabe7c773dad`
over lexically sorted filenames followed by NUL, exact file bytes, and NUL for
each of the 40 artist JSON files. Post identity is Instagram shortcode; do not
use the account handle alone as identity.

Selection was deterministic: assign scarce length bands to distinct eligible
accounts first, with account ties ordered by SHA-256 of
`storyboard-calibration-2026-09-23:<handle>:<band>`. For each selected account,
choose low, middle, or high likes within that account's posts in the assigned
length band. These labels describe _within-account sampling positions_, not
outcome classes. For an account with only one or two eligible posts, a middle
or high label has little comparative meaning. Likes were used only for sample
diversity; engagement must not enter the visual observation prompt.

| Tier           | Length | Target rank | Account             | Shortcode     | Expected children |
| -------------- | ------ | ----------- | ------------------- | ------------- | ----------------: |
| A 100k+        | Short  | Low         | kevinruss           | `DTbusF1GO7X` |                 3 |
| A 100k+        | Short  | Middle      | gebelia             | `CTpyKs_IMmX` |                 3 |
| A 100k+        | Medium | High        | benzank             | `DVjE9BdDtSD` |                 4 |
| A 100k+        | Medium | Low         | teaganwh            | `DPukaNjEnC2` |                 6 |
| A 100k+        | Long   | Middle      | pascalblanche       | `DQ9rwsbCcfB` |                10 |
| A 100k+        | Long   | High        | m_melgrati          | `DYxf8KViG8_` |                10 |
| B 20k–100k     | Short  | Low         | andywestface        | `DcOzDxkkkUT` |                 2 |
| B 20k–100k     | Short  | Middle      | vichys_art          | `DcoWECzFpPJ` |                 2 |
| B 20k–100k     | Medium | High        | alegiorgini         | `DQn_vMSDWpv` |                 6 |
| B 20k–100k     | Medium | Low         | hypathie_aswang_art | `DWn9eg1CM4-` |                 6 |
| B 20k–100k     | Long   | Middle      | esoastronomy        | `Dbuz2WfEbXW` |                 7 |
| B 20k–100k     | Long   | High        | sammyslabbinck      | `DZCt2IbDGel` |                 7 |
| C 5k–20k       | Short  | Low         | ecmazurart          | `DbdwgNREUOI` |                 2 |
| C 5k–20k       | Short  | Middle      | lidiebugdesign      | `CXC3GhALKAo` |                 2 |
| C 5k–20k       | Medium | High        | micklyn             | `B5SirPAHxMV` |                 5 |
| C 5k–20k       | Medium | Low         | craniodsgn          | `DZPIpANjCXi` |                 4 |
| C 5k–20k       | Long   | Middle      | girly_trend         | `DbrKcVgH03k` |                 9 |
| C 5k–20k       | Long   | High        | foxandvelvet        | `C_J4gtCy3GD` |                 7 |
| Society6 field | Short  | Low         | muhammedsalah\_     | `DAUQTbziC0A` |                 2 |
| Society6 field | Short  | Middle      | katja.perez         | `DGEbrxvq4KA` |                 2 |
| Society6 field | Medium | High        | jovymerryl          | `CVLCGKuB8G4` |                 5 |
| Society6 field | Medium | Low         | abigail_larson      | `DXKjnpsEySv` |                 6 |
| Society6 field | Long   | Middle      | haleytippmann       | `DcHhCe9jfsm` |                12 |
| Society6 field | Long   | High        | charlyclements      | `Db7wsrnE9-8` |                 9 |

The 24 metadata counts sum to 131 expected child items. That is a recovery
target, **not** 131 inspected images; mixed image/video children may increase
decoding and annotation work. Four original accounts have no usable posts or
sidecars for this selection; the table does not silently replace them.

## Acquisition and extraction gate

For each shortcode, request that exact post URL through the configured source
provider. Verify returned shortcode/account and source child order. Record the
provider's child IDs, types, count, request/capture times, and original source
references. Mirror each byte to a scoped durable object, decode the actual
MIME, and record checksum, dimensions, and any video duration. Do not infer
child identities from `childCount` or treat the cover URL as the full post.

Compare the recovered child count with the frozen metadata count. A mismatch
stays incomplete until investigated, even if the provider returns an apparently
usable subset. Preserve failed, removed, and private posts in the manifest with
reason; replace a failed calibration sample only with an explicit amendment to
this list and report planned versus realized denominators. Mixed child videos
need sampled frame times and separate audio/transcript coverage claims.

Use `CorpusSnapshot v2` and `assessSnapshot()` in
`packages/storyboard-corpus/src/acquire/manifest.ts` before any model call.
Start with three source posts of differing length to validate provider fields,
order, bytes, and cost. Then recover the remaining 21 under a bounded source
spend cap and per-post checkpoint. The acquisition adapter must not log tokens
or raw media URLs carrying credentials. A complete recovery record is necessary
for the v2 grounded observation and narrative annotation calibration; only
reviewed complete posts can support counted transition patterns.

## Current blocker

GCP access and Vertex extraction were verified on 2026-09-22. The active
environment has no `APIFY_TOKEN` or `APIFY_API_TOKEN`. Public Instagram HTML
was reachable for one sample post, but the installed media extractor reported
content unavailable, rate limited, or login required. Existing CDN image URLs
had already returned 403. The recovery run awaits a source-provider credential
or another verified full-media acquisition path. The manifest and frozen slice
let that run start without changing the research sample.
