import { SessionOptions } from "iron-session";

export type SessionData = {
  userId?: string;
  email?: string;
  isLoggedIn: boolean;
};

function authSecret() {
  const secret = process.env.AUTH_SECRET || "dev-auth-secret-change-me-to-32chars-min!!";
  if (secret.length < 32) {
    // iron-session requires >= 32 characters
    return secret.padEnd(32, "0");
  }
  return secret;
}

export const sessionOptions: SessionOptions = {
  password: authSecret(),
  cookieName: "xme_mail_session",
  cookieOptions: {
    // Default secure for production HTTPS (mail.x-me.cloud). Override with COOKIE_SECURE=false for pure local HTTP.
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
