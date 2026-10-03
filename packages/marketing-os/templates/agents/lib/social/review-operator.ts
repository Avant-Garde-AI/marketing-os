/** Unlike review-link possession, getUser() verifies a signed-in console operator with Supabase. */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { HOSTED } from "../tenant-context";
export async function socialReviewOperator() {
  if (HOSTED || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  const jar = await cookies();
  const client = createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    cookies: { getAll: () => jar.getAll(), setAll: items => {
      for (const { name, value, options } of items) jar.set(name, value, options);
    } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}
