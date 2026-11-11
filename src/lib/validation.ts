import { z } from "zod";
import { MOVIE_TITLE_MAX, MOVIE_TITLE_MIN } from "./movie-title";

// Shared by the server action (authoritative) and the form (UX hints only).
// Min length is 1 because real titles can be a single character ("M", "9").
export const movieTitleSchema = z
  .string({ error: "Please enter a movie title." })
  // Trim and collapse internal whitespace so "  The   Matrix " === "The Matrix".
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(MOVIE_TITLE_MIN, "Please enter a movie title.")
      .max(MOVIE_TITLE_MAX, `Movie title must be at most ${MOVIE_TITLE_MAX} characters.`)
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Movie title contains invalid characters."),
  );
