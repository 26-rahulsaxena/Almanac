"use client";

// Shown instead of a blank crash page if something on the server fails.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg flex-1 px-4 py-24 text-center">
      <h1 className="font-serif text-4xl">Something went wrong.</h1>
      <p className="mt-3 text-muted">Google or the database didn&apos;t answer. Your calendar is untouched.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-full bg-ink px-5 py-2.5 text-paper">
        Try again
      </button>
    </main>
  );
}
