/** Tiny structured logger — avoids silent empty catches */

type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, extra?: unknown) {
  const line = `[xme-mail] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console[level === "info" ? "log" : level](line, extra);
  } else {
    // eslint-disable-next-line no-console
    console[level === "info" ? "log" : level](line);
  }
}

export const logger = {
  info: (msg: string, extra?: unknown) => log("info", msg, extra),
  warn: (msg: string, extra?: unknown) => log("warn", msg, extra),
  error: (msg: string, extra?: unknown) => log("error", msg, extra),
};
