import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, hasAccess } from "@/lib/access";

// Runs on the Edge runtime: Next 16's Node-only `proxy.ts` is not supported by
// the Cloudflare (OpenNext) adapter, `middleware.ts` is.

/** Public project links never get the owner session. */
const PUBLIC_PATHS = ["/p", "/api/p", "/api/health"];
/** The access-code screen itself. */
const UNLOCK_PATHS = ["/unlock", "/api/unlock"];

const matches = (pathname: string, list: string[]) => list.some((p) => pathname === p || pathname.startsWith(p + "/"));

/**
 * 1. Private app behind a device access code (APP_ACCESS_CODE, when set).
 * 2. No login screen: the owner (OWNER_EMAIL) is signed in automatically,
 *    server-side, so Row Level Security keeps scoping every query.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (matches(pathname, PUBLIC_PATHS) || matches(pathname, UNLOCK_PATHS)) return NextResponse.next({ request });

  // Fail closed: online, the private app never runs without its access code
  // or with a half-configured environment. Only variable NAMES are shown.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(request.nextUrl.hostname);
  const missing = [
    !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL (Build variable + Variable)",
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY (Build variable + Variable)",
    !process.env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY (Secret)",
    !process.env.OWNER_EMAIL && "OWNER_EMAIL (Variable)",
    !local && !process.env.APP_ACCESS_CODE && "APP_ACCESS_CODE (Secret)",
  ].filter(Boolean);
  if (missing.length) {
    const msg = `CREATE n'est pas encore configuré.\n\nVariables manquantes dans Cloudflare → Workers → create → Settings :\n- ${missing.join("\n- ")}\n\nAjoute-les puis redéploie (Deployments → Retry).`;
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: msg }, { status: 503 });
    return new NextResponse(msg, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  if (!(await hasAccess(request.cookies.get(ACCESS_COOKIE)?.value))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Accès refusé" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/unlock";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return response;

  try {
    await signInOwner(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[auth] automatic sign-in failed:", message);
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: message }, { status: 500 });
    return new NextResponse(
      `CREATE n'a pas pu ouvrir de session : ${message}\n\nVérifie OWNER_EMAIL, SUPABASE_SERVICE_ROLE_KEY et l'URL Supabase dans les variables d'environnement.`,
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return response;
}

/** Creates the owner account on first run, then opens a session via a server-verified magic link. */
async function signInOwner(supabase: SupabaseClient) {
  const email = process.env.OWNER_EMAIL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!email) throw new Error("OWNER_EMAIL n'est pas défini");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY n'est pas défini");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    // First run: the owner account doesn't exist yet.
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw new Error(`impossible de créer le compte propriétaire (${created.error.message})`);
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw new Error(link.error.message);
  }

  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (error) throw new Error(error.message);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|js|ico|woff2?)$).*)"],
};
