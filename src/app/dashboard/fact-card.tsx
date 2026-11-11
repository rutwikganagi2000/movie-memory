"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FactResponse } from "@/lib/facts/api-types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Extract<FactResponse, { fact: unknown }> };

const NOTES: Record<string, string> = {
  cache: "New facts are generated at most once a minute — this one is still fresh.",
  in_progress: "A new fact is being generated in another tab or request.",
  stale_fallback: "We couldn't reach our fact generator, so here's your most recent fact.",
};

/**
 * Fetches GET /api/fact. All caching/locking decisions live on the server;
 * this component only renders loading / error / success states.
 */
export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ status: "loading" });

    try {
      const res = await fetch("/api/fact", { cache: "no-store", signal: controller.signal });
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      const body = (await res.json()) as FactResponse;
      if ("error" in body) setState({ status: "error", message: body.error.message });
      else setState({ status: "ready", data: body });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState({ status: "error", message: "Something went wrong. Please try again." });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load]);

  return (
    <section className="mt-6 rounded-2xl bg-indigo-600 p-6 text-white shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium tracking-wide text-indigo-200 uppercase">Fun fact</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium transition hover:bg-white/25 disabled:opacity-60"
        >
          Get another fact
        </button>
      </div>

      <div className="mt-3 min-h-16" aria-live="polite">
        {state.status === "loading" && (
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-full rounded bg-white/20" />
            <div className="h-4 w-2/3 rounded bg-white/20" />
          </div>
        )}
        {state.status === "error" && <p className="text-indigo-50">{state.message}</p>}
        {state.status === "ready" && (
          <>
            <p className="text-lg leading-relaxed">{state.data.fact.content}</p>
            {NOTES[state.data.source] && (
              <p className="mt-3 text-sm text-indigo-200">{NOTES[state.data.source]}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
