/** Deterministic production steps. Every mutation is a registered gate Action. */
import { z } from "zod";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { socialRepo } from "./repo";
import { parsePost, postPath, serializePost, renderedVideoSchema } from "./artifacts";
import { generationPlanSchema } from "./generation-plan";
import { socialAutopilotPolicySchema, autopilotWindow } from "./autopilot";
import { loadSocialBacklog, socialBacklogSchema } from "./backlog";
import { readGenerationInput } from "./generation-input";
import { loadGenerationJobForPost, loadGenerationJobsForMonth } from "./generation-review";
import {
  generationDeliveryPath,
  generationDeliverySchema,
  renderGenerationScene,
} from "./generation-delivery";
import {
  generationCarouselPath,
  generationCarouselSchema,
  loadGenerationCarousel,
} from "./generation-carousel";
import {
  loadVerifiedLoopExport,
  loopExportManifestPath,
  loopExportBytesPath,
  parseLoopExportManifest,
  decodeVerifiedLoopExport,
} from "./generation-export";
import { createSocialActions } from "./actions";
import { socialActionDeps } from "./register-actions";
import {
  readPublishableCarousel,
  persistCarouselBinding,
  carouselManifestHash,
} from "./generation-publishing";
import { validateGeneratedVideo } from "./generation-video";
import { saveSocialImage } from "../storyboard/assets";
import { saveSocialVideo } from "./video-assets";
import { registerAction } from "../actions/registry";
import { hashPreview } from "../actions/hash";
import { getTenant } from "../tenant-context";
import { instagramIdentity } from "./channels/instagram";
import { brokerTokenSource } from "./channels";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const prepare = z
  .object({
    policy: socialAutopilotPolicySchema,
    index: z.number().int().min(0).max(1000),
    grantId: z.string().uuid(),
    recipeHash: hash,
    captions: z.array(z.string().min(1).max(2200)).length(14).optional(),
  })
  .strict();
type Preparation = z.infer<typeof prepare>;
const batchPath = (from: string) => `social/drafts/auto-${from}/batch.json`;
const variations = [
  "early morning light, warm natural textures",
  "late afternoon shadows and tactile stone",
  "soft overcast daylight and sculptural timber",
  "golden hour light, layered textiles",
  "blue hour light and warm practical lamps",
  "clear daylight, generous negative space",
  "dappled light with rich natural surfaces",
];

/** Read only. Store recipes hold the catalog and thematic decisions; core holds mechanics. */
export async function planSocialWindow(raw: Preparation) {
  const p = prepare.parse(raw),
    window = autopilotWindow(p.policy, p.index);
  const source = await socialRepo.readFile("social/autopilot/recipes.json");
  if (!source || source.length > 250000 || digest(Buffer.from(source)) !== p.recipeHash)
    throw Error("Social recipes changed; re-read the source catalog");
  const pool = JSON.parse(source) as {
    schemaVersion: number;
    entries: {
      recipeId: string;
      caption: string;
      targetLink: string;
      body: string;
      artistHandles: string[];
      plans: unknown[];
    }[];
  };
  if (pool.schemaVersion !== 1 || !Array.isArray(pool.entries) || pool.entries.length < 2)
    throw Error("Social recipe pool unavailable");
  const allowed = pool.entries.filter((e) => p.policy.recipeIds.includes(e.recipeId));
  const groups = [
    allowed.filter((e) => e.plans.length === 1),
    allowed.filter((e) => e.plans.length === 3),
  ];
  if (groups.some((g) => !g.length))
    throw Error("Both animation and carousel recipes are required");
  const jobs: any[] = [],
    plans: any[] = [],
    posts: any[] = [];
  for (let n = 0; n < 14; n++) {
    const group = groups[n % 2],
      entry = group[(Math.floor(n / 2) + p.index * 7) % group.length];
    const slot = window.slots[n],
      postId = `${slot.date}-instagram-auto-${entry.recipeId}`;
    const caption = p.captions?.[n] ?? entry.caption;
    if (
      entry.artistHandles.some((h) => !caption.includes(h)) ||
      (n % 2 === 1 && !/imagined|imagine|pictured/i.test(caption))
    )
      throw Error("Caption lost artist credit or imagined-scene disclosure");
    const inputs: string[] = [];
    for (const [j, rawPlan] of entry.plans.entries()) {
      const prior = generationPlanSchema.parse(rawPlan),
        artifactId = `auto-${slot.date}-${n % 2 === 0 ? "loop" : `scene-${j + 1}`}`;
      const plan = generationPlanSchema.parse({
        ...prior,
        id: artifactId,
        postId: n % 2 === 0 ? postId : `${postId}-slide-${j + 1}`,
        slotId: postId,
        caption,
        prompt:
          prior.prompt +
          (n % 2 === 1
            ? ` Lighting and material direction: ${variations[(p.index + n + j) % variations.length]}.`
            : ""),
      });
      if (plan.prompt.length > 4000) throw Error("Recipe prompt exceeds provider limit");
      plans.push(plan);
      inputs.push(`social/production/jobs/${artifactId}.json`);
      jobs.push({
        artifactId,
        postId: plan.postId,
        parentPostId: postId,
        mechanic: plan.mechanic,
        maximumCredits: plan.mechanic === "artwork-loop" ? 8 : 3,
      });
    }
    posts.push({
      id: postId,
      date: slot.date,
      plannedAt: slot.scheduledAt,
      caption,
      generationInputs: inputs,
      recipeId: entry.recipeId,
      targetLink: entry.targetLink,
      body: entry.body,
      artistHandles: entry.artistHandles,
    });
  }
  const batch = socialBacklogSchema.parse({
    schemaVersion: 1,
    id: `auto-${window.from}`,
    range: { from: window.from, through: window.through },
    timeZone: p.policy.timeZone,
    maximumCredits: p.policy.maximumCredits,
    reservedMaximumCredits: jobs.reduce((s, j) => s + j.maximumCredits, 0),
    posts,
    generationJobs: jobs,
    grantId: p.grantId,
    policyHash: hashPreview(p.policy),
    recipeHash: p.recipeHash,
  });
  return { batch, plans };
}

registerAction("social.autopilot_prepare", () => ({
  kind: "social.autopilot_prepare",
  title: "Prepare fourteen daily social posts",
  risk: "medium",
  scopes: ["social:write"],
  paramsSchema: prepare,
  async preview(p) {
    const { batch, plans } = await planSocialWindow(p);
    return {
      summary: `Prepare ${batch.posts.length} posts for ${batch.range.from}–${batch.range.through}; reserve ${batch.reservedMaximumCredits} credits`,
      previewHash: hashPreview({ batch, plans }),
    };
  },
  async execute(p) {
    const { batch, plans } = await planSocialWindow(p);
    const prior = await socialRepo.readFile(batchPath(batch.range.from));
    if (prior && prior !== JSON.stringify(batch, null, 2))
      throw Error("Existing batch differs; never overwrite an in-flight window");
    for (const plan of plans) {
      const path = `social/production/jobs/${plan.id}.json`,
        encoded = JSON.stringify(plan, null, 2),
        old = await socialRepo.readFile(path);
      if (old && old !== encoded) throw Error("Generation input already differs");
      if (!old) await socialRepo.writeFile(path, encoded);
    }
    for (const item of batch.posts) {
      const path = postPath(item.id),
        old = await socialRepo.readFile(path);
      if (old) {
        const post = parsePost(old);
        if (post.copy !== item.caption || post.plannedAt !== item.plannedAt)
          throw Error("Draft already differs");
        continue;
      }
      await socialRepo.writeFile(
        path,
        serializePost({
          id: item.id,
          groupId: item.id,
          channel: "instagram",
          copy: item.caption,
          plannedAt: item.plannedAt,
          status: "proposed",
          automation: { grantId: p.grantId, batchId: batch.id, windowFrom: batch.range.from },
          assetRefs: [],
          targetLink: String(item.targetLink),
          provenance: [],
          body: String(item.body),
        })
      );
    }
    if (!prior)
      await socialRepo.writeFile(batchPath(batch.range.from), JSON.stringify(batch, null, 2));
    await socialRepo.writeFile(
      "social/autopilot/current-backlog.json",
      JSON.stringify({ batchId: batch.id })
    );
    return {
      ok: true,
      summary: "Fourteen source-bound drafts prepared",
      detail: { batchId: batch.id },
    };
  },
}));

const realize = z
  .object({
    batchId: id,
    batchHash: hash,
    artifactId: id,
    delivery: generationDeliverySchema,
    loop: z
      .object({
        manifest: z.unknown(),
        reel: z.string().max(4000000),
        feed: z.string().max(4000000),
        poster: z.string().max(1000000),
      })
      .strict()
      .optional(),
  })
  .strict();
async function realization(p: z.infer<typeof realize>) {
  const loaded = await loadSocialBacklog(socialRepo, p.batchId);
  if (!loaded || loaded.hash !== p.batchHash) throw Error("Batch changed");
  const expected = loaded.batch.generationJobs.find((j) => j.artifactId === p.artifactId);
  if (!expected) throw Error("Unreserved generation");
  const job = await loadGenerationJobForPost(expected.postId);
  if (
    !job ||
    job.artifactId !== p.artifactId ||
    job.state !== "succeeded" ||
    job.inputHash !== p.delivery.inputHash ||
    p.delivery.postId !== expected.postId ||
    p.delivery.artifactId !== p.artifactId
  )
    throw Error("Generation result incomplete or changed");
  const input = await readGenerationInput(socialRepo, p.artifactId);
  if (input.inputHash !== job.inputHash || p.delivery.caption !== input.plan.caption)
    throw Error("Immutable generation input changed");
  if (expected.mechanic === "collection-scene") {
    if (!p.delivery.scene || p.loop) throw Error("Scene geometry required");
    return { job, expected, scene: await renderGenerationScene(socialRepo, job, p.delivery) };
  }
  if (!p.loop || p.delivery.scene) throw Error("Loop exports required");
  const { manifest, entries } = parseLoopExportManifest(JSON.stringify(p.loop.manifest), job);
  const reel = decodeVerifiedLoopExport(p.loop.reel, entries.get("reel")!),
    feed = decodeVerifiedLoopExport(p.loop.feed, entries.get("feed")!);
  const poster = Buffer.from(p.loop.poster, "base64"),
    meta = await sharp(poster).metadata();
  if (
    poster.toString("base64") !== p.loop.poster ||
    meta.format !== "jpeg" ||
    meta.width !== 1080 ||
    meta.height !== 1920
  )
    throw Error("Invalid Reel cover");
  return { job, expected, manifest, reel, feed, poster };
}
registerAction("social.autopilot_realize", () => ({
  kind: "social.autopilot_realize",
  title: "Realize source-bound social media",
  risk: "medium",
  scopes: ["social:write"],
  paramsSchema: realize,
  async preview(p) {
    await realization(p);
    return {
      summary: `Persist verified final media for ${p.artifactId}`,
      previewHash: hashPreview(p),
    };
  },
  async execute(p) {
    const r = await realization(p);
    const path = generationDeliveryPath(p.artifactId),
      encoded = JSON.stringify(p.delivery, null, 2),
      prior = await socialRepo.readFile(path);
    if (prior && prior !== encoded) throw Error("Delivery receipt already differs");
    // Receipt is written last: an interrupted realization resumes content-addressed writes.
    if (r.scene) {
      const sha = digest(r.scene);
      await socialRepo.writeFile(
        `social/production/renders/${sha}.jpeg.b64`,
        r.scene.toString("base64")
      );
    } else {
      await socialRepo.writeFile(loopExportManifestPath(p.artifactId), JSON.stringify(r.manifest));
      await socialRepo.writeFile(
        loopExportBytesPath(p.artifactId, "reel"),
        r.reel!.toString("base64")
      );
      await socialRepo.writeFile(
        loopExportBytesPath(p.artifactId, "feed"),
        r.feed!.toString("base64")
      );
      await saveSocialImage(
        socialRepo,
        getTenant().shop,
        r.poster!,
        process.env.MOS_AGENTS_PUBLIC_URL!
      );
      await socialRepo.writeFile(
        `social/production/exports/${p.artifactId}-poster.json`,
        JSON.stringify({ sha256: digest(r.poster!) })
      );
    }
    if (!prior) await socialRepo.writeFile(path, encoded);
    return {
      ok: true,
      summary: "Verified media persisted",
      detail: r.scene ? { sha256: digest(r.scene) } : { posterSha256: digest(r.poster!) },
    };
  },
}));

const bind = z
  .object({ batchId: id, batchHash: hash, postId: id, grantId: z.string().uuid() })
  .strict();
async function boundMaterial(p: z.infer<typeof bind>) {
  const loaded = await loadSocialBacklog(socialRepo, p.batchId);
  if (!loaded || loaded.hash !== p.batchHash || loaded.batch.grantId !== p.grantId)
    throw Error("Batch authority changed");
  const item = loaded.batch.posts.find((s) => s.id === p.postId);
  if (!item) throw Error("Post outside batch");
  const raw = await socialRepo.readFile(postPath(p.postId));
  if (!raw) throw Error("Missing draft");
  const draft = parsePost(raw);
  if (
    draft.automation?.grantId !== p.grantId ||
    draft.automation.batchId !== loaded.batch.id ||
    draft.copy !== item.caption ||
    draft.plannedAt !== item.plannedAt ||
    draft.channel !== "instagram"
  )
    throw Error("Editorial draft changed");
  if (draft.status !== "proposed") return { post: draft, raw, item };
  const account = await instagramIdentity(brokerTokenSource),
    base = process.env.MOS_AGENTS_PUBLIC_URL!;
  const jobs = loaded.batch.generationJobs.filter((j) => j.parentPostId === p.postId);
  if (jobs.length === 3) {
    const slides = [];
    for (const expected of jobs) {
      const job = await loadGenerationJobForPost(expected.postId);
      if (!job || job.state !== "succeeded" || job.artifactId !== expected.artifactId)
        throw Error("Carousel incomplete");
      const receiptRaw = await socialRepo.readFile(generationDeliveryPath(job.artifactId));
      if (!receiptRaw) throw Error("Scene receipt missing");
      const receipt = generationDeliverySchema.parse(JSON.parse(receiptRaw));
      const bytes = await renderGenerationScene(socialRepo, job, receipt),
        sha = digest(bytes);
      if (!(await socialRepo.readFile(`social/production/renders/${sha}.jpeg.b64`)))
        throw Error("Scene bytes not persisted");
      slides.push({
        artifactId: job.artifactId,
        postId: job.postId,
        inputHash: job.inputHash,
        finalImage: { sha256: sha, path: `social/production/renders/${sha}.jpeg.b64` },
      });
    }
    const manifest = generationCarouselSchema.parse({
      schemaVersion: 1,
      parentPostId: p.postId,
      caption: item.caption,
      slides,
    });
    return { post: draft, raw, item, manifest };
  }
  const expected = jobs[0],
    job = await loadGenerationJobForPost(p.postId);
  if (!job || job.state !== "succeeded" || job.artifactId !== expected.artifactId)
    throw Error("Loop incomplete");
  const deliveryRaw = await socialRepo.readFile(generationDeliveryPath(job.artifactId)),
    exportRaw = await socialRepo.readFile(loopExportManifestPath(job.artifactId));
  if (!deliveryRaw || !exportRaw) throw Error("Loop receipts missing");
  const exp = await loadVerifiedLoopExport(socialRepo, job, "reel"),
    posterRef = JSON.parse(
      (await socialRepo.readFile(`social/production/exports/${job.artifactId}-poster.json`)) ??
        "null"
    );
  if (!posterRef || !hash.safeParse(posterRef.sha256).success) throw Error("Loop cover missing");
  const input = await readGenerationInput(socialRepo, job.artifactId),
    prefix = `${base.replace(/\/$/, "")}/api/social/assets/${getTenant().shop}/`;
  const renderedVideo = renderedVideoSchema.parse({
    version: 1,
    origin: "generation-delivery",
    artifactId: job.artifactId,
    inputHash: job.inputHash,
    deliveryHash: hashPreview(JSON.parse(deliveryRaw)),
    exportHash: hashPreview(JSON.parse(exportRaw)),
    sources: input.plan.sources.map((s) => ({ ref: s.sourceRef, sha256: s.sourceSha256 })),
    video: {
      url: `${prefix}${exp.sha256}.mp4`,
      sha256: exp.sha256,
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationMs: Math.round(exp.durationSec * 1000),
    },
    poster: {
      url: `${prefix}${posterRef.sha256}.jpeg`,
      sha256: posterRef.sha256,
      width: 1080,
      height: 1920,
    },
  });
  return {
    raw,
    item,
    video: exp.bytes,
    post: {
      ...draft,
      status: "asset_ready" as const,
      channelAccount: account,
      renderedVideo,
      assetRefs: [
        `social/assets/${exp.sha256}.mp4.b64`,
        `social/assets/${posterRef.sha256}.jpeg.b64`,
      ],
    },
  };
}
registerAction("social.autopilot_bind", () => ({
  kind: "social.autopilot_bind",
  title: "Bind completed social post",
  risk: "medium",
  scopes: ["social:write"],
  paramsSchema: bind,
  async preview(p) {
    const m = await boundMaterial(p);
    return {
      summary: `Bind final media and caption for ${p.postId}`,
      previewHash: hashPreview({ p, raw: m.raw, manifest: m.manifest ?? null }),
    };
  },
  async execute(p) {
    const deps = socialActionDeps();
    return deps.withPostLock!(p.postId, async () => {
      const m = await boundMaterial(p),
        base = process.env.MOS_AGENTS_PUBLIC_URL!;
      if (m.manifest) {
        await socialRepo.writeFile(
          generationCarouselPath(p.postId),
          JSON.stringify(m.manifest, null, 2)
        );
        const account = await instagramIdentity(brokerTokenSource);
        const material = await readPublishableCarousel(
          socialRepo,
          {
            postId: p.postId,
            expectedManifestHash: carouselManifestHash(m.manifest),
            expectedDraftHash: hashPreview(m.post),
            accountId: account.id,
            accountUsername: account.username,
          },
          base
        );
        await persistCarouselBinding(socialRepo, material, base);
        await deps.onPostSaved?.(material.post);
      } else if (m.video) {
        await saveSocialVideo(socialRepo, getTenant().shop, m.video, base);
        await validateGeneratedVideo(socialRepo, m.post, base);
        if ((await socialRepo.readFile(postPath(p.postId))) !== m.raw)
          throw Error("Draft changed while binding");
        await socialRepo.writeFile(postPath(p.postId), serializePost(m.post));
        await deps.onPostSaved?.(m.post);
      }
      return { ok: true, summary: "Final social post is ready for review" };
    });
  },
}));

/** Read-only status the platform's durable worker uses after a lost response. */
export async function inspectSocialWindow(from: string) {
  const loaded = await loadSocialBacklog(socialRepo, `auto-${from}`);
  if (!loaded) return null;
  const months = [...new Set(loaded.batch.posts.map((p) => p.date.slice(0, 7)))];
  const jobs = (await Promise.all(months.map(loadGenerationJobsForMonth)))
    .flat()
    .filter((j) => loaded.batch.generationJobs.some((e) => e.artifactId === j.artifactId));
  const posts = await Promise.all(
    loaded.batch.posts.map(async (p) => {
      const raw = await socialRepo.readFile(postPath(p.id));
      return { id: p.id, plannedAt: p.plannedAt, status: raw ? parsePost(raw).status : "missing" };
    })
  );
  const realized = await Promise.all(
    loaded.batch.generationJobs.map(async (j) => ({
      artifactId: j.artifactId,
      ready: Boolean(await socialRepo.readFile(generationDeliveryPath(j.artifactId))),
    }))
  );
  return { ...loaded, jobs, posts, realized };
}
