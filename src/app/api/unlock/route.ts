import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessToken, safeEqual } from "@/lib/access";

// Small in-memory brake against guessing (per server instance).
const attempts = new Map<string, { n: number; until: number }>();

/** Checks the device access code and remembers this device for a year. */
export async function POST(req: Request) {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(req.url).hostname);
    return local
      ? Response.json({ ok: true })
      : Response.json({ error: "APP_ACCESS_CODE n'est pas configuré sur le serveur." }, { status: 503 });
  }

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  const a = attempts.get(ip);
  if (a && a.until > Date.now() && a.n >= 5) {
    return Response.json({ error: "Trop de tentatives. Réessaie dans une minute." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const given = typeof body.code === "string" ? body.code.trim() : "";
  const [want, got] = await Promise.all([accessToken(code), accessToken(given)]);
  if (!given || !safeEqual(want, got)) {
    const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 60_000 };
    attempts.set(ip, { n: cur.n + 1, until: cur.until });
    return Response.json({ error: "Code incorrect" }, { status: 401 });
  }
  attempts.delete(ip);

  const secure = new URL(req.url).protocol === "https:";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${ACCESS_COOKIE}=${want}; Path=/; Max-Age=${ACCESS_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      },
    },
  );
}
