import { SessionOptions } from "iron-session";

export type SessionData = {
  userId?: string;
  email?: string;
  isLoggedIn: boolean;
};

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production (min 32 characters)");
    }
    // Dev-only fallback — never used when NODE_ENV=production
    return "dev-auth-secret-change-me-to-32chars-min!!";
  }
  if (secret.length < 32) {
    throw new Error(`AUTH_SECRET must be at least 32 characters (got ${secret.length})`);
  }
  return secret;
}

export const sessionOptions: SessionOptions = {
  password: authSecret(),
  cookieName: "xme_mail_session",
  cookieOptions: {
    // Default secure for production HTTPS. Override with COOKIE_SECURE=false for pure local HTTP.
    secure:
      process.env.COOKIE_SECURE != null
        ? process.env.COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  },
};
