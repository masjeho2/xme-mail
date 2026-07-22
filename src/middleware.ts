import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/session";

const publicExact = new Set(["/login", "/api/auth/login"]);
const publicPrefixes = ["/api/inbound/cloudflare", "/api/v1/"];

/** Static asset extensions that may skip auth (files under /public, icons, etc.) */
const STATIC_EXT =
  /\.(?:js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|txt|xml|webmanifest|json)$/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Framework / static assets only — never skip auth for API-ish paths just because of a dot
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/icons/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    (STATIC_EXT.test(pathname) && !pathname.startsWith("/api/"))
  ) {
    return NextResponse.next();
  }

  const isPublic =
    publicExact.has(pathname) || publicPrefixes.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  // Read session from request cookies. Important: return the same response
  // object that iron-session may touch, so cookie seal stays consistent.
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  if (!session.isLoggedIn || !session.userId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
