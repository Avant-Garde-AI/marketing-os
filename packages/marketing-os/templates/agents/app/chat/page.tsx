"use client";

export default function ChatPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-2xl">
          <h1 className="text-3xl font-bold mb-4">Chat with your Marketing Agent</h1>
          <p className="text-muted-foreground mb-8">
            Ask questions about your store, generate ad copy, or request improvements.
          </p>
          <div className="bg-card border rounded-lg p-8">
            <p className="text-muted-foreground">
              Chat interface coming soon...
              <br />
              Will use assistant-ui + Mastra chatRoute
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
