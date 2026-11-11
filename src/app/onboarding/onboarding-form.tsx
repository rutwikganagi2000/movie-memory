"use client";

import { useActionState } from "react";
import { saveFavoriteMovie, type OnboardingState } from "./actions";
import { MOVIE_TITLE_MAX } from "@/lib/movie-title";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    saveFavoriteMovie,
    {},
  );

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="movie" className="block text-sm font-medium text-slate-700">
          Favorite movie
        </label>
        <input
          id="movie"
          name="movie"
          type="text"
          required
          maxLength={MOVIE_TITLE_MAX}
          defaultValue={state.value}
          placeholder="e.g. Spirited Away"
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "movie-error" : undefined}
          autoFocus
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
        />
        {state.error && (
          <p id="movie-error" role="alert" className="mt-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
