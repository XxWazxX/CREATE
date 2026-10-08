/**
 * Public Supabase configuration, cleaned of copy-paste accidents (spaces,
 * quotes, trailing text like "… key"). A single stray character in a header
 * makes every browser request fail, so only the first token is kept.
 *
 * `process.env.NEXT_PUBLIC_*` must be written literally so Next inlines it.
 */
function clean(value: string | undefined): string {
  return (
    (value ?? "")
      .trim()
      .split(/\s+/)[0]
      ?.replace(/^["']+|["']+$/g, "") ?? ""
  );
}

export const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
