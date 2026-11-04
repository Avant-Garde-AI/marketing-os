/** Stream the console shell immediately while a route reads its own data. */
export default function ConsoleLoading() {
  return <div className="mx-auto max-w-[1200px] px-8 py-10" role="status" aria-live="polite">
    <p className="text-sm text-ink-3">Loading your workspace…</p>
    <div className="mt-6 h-9 w-72 animate-pulse bg-gold-quiet" />
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="h-28 animate-pulse border border-hairline bg-raised" />)}</div>
    <div className="mt-8 h-64 animate-pulse border border-hairline bg-raised" />
  </div>;
}
