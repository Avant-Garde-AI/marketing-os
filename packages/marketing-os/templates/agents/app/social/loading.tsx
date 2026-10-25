export default function LoadingSocial() {
  return <main className="px-4 py-8 sm:px-8 sm:py-10" aria-busy="true" aria-label="Loading social posts">
    <div className="mx-auto max-w-[1200px]">
      <p className="mb-3 text-sm text-ink-3">Social</p>
      <h1 className="font-display text-3xl">Your social publishing workflow</h1>
      <p role="status" className="mt-4 text-ink-2">Loading posts and release status…</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map(i => <div key={i} className="h-64 animate-pulse border border-hairline bg-raised" />)}
      </div>
    </div>
  </main>;
}
