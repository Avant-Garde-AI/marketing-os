export default function ActivityPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Activity Feed</h1>
          <p className="text-muted-foreground">
            Track all AI-generated changes and skill executions
          </p>
        </div>

        <div className="mb-6">
          <div className="flex gap-2 border-b">
            <button className="px-4 py-2 border-b-2 border-primary font-medium">
              All
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              PRs
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              Skills
            </button>
            <button className="px-4 py-2 text-muted-foreground hover:text-foreground">
              Scheduled
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border rounded-lg p-6">
            <p className="text-muted-foreground text-sm text-center">
              No activity yet. Run a skill or make a change to see activity here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
