/** Browser notification + soft chime for new inbound mail */

const SOUND_KEY = "xme-mail-sound";
const NOTIF_KEY = "xme-mail-desktop-notif";

export function getSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(SOUND_KEY);
  return v === null ? true : v === "1";
}

export function setSoundEnabled(on: boolean) {
  localStorage.setItem(SOUND_KEY, on ? "1" : "0");
}

export function getDesktopNotifEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(NOTIF_KEY);
  return v === null ? true : v === "1";
}

export function setDesktopNotifEnabled(on: boolean) {
  localStorage.setItem(NOTIF_KEY, on ? "1" : "0");
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/** Call from a user click to unlock autoplay for later chimes */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") await ctx.resume();
    // tiny silent blip to fully unlock some browsers
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/** Soft two-tone chime via Web Audio (no external file) */
export function playNewMailSound(force = false) {
  if (typeof window === "undefined") return;
  if (!force && !getSoundEnabled()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const audio = ctx; // narrowed for nested function
    if (audio.state === "suspended") {
      // best-effort; may fail until unlockAudio() from a click
      void audio.resume();
    }
    const now = audio.currentTime;

    function tone(freq: number, start: number, dur: number, gain = 0.08) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(gain, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(g);
      g.connect(audio.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }

    tone(880, 0, 0.12, 0.09);
    tone(1174.7, 0.12, 0.2, 0.08);
  } catch {
    /* ignore autoplay / audio errors */
  }
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function showNewMailNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}) {
  if (typeof window === "undefined") return;
  if (!getDesktopNotifEnabled()) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag || "xme-mail-new",
      icon: "/favicon.ico",
      silent: true, // we play our own sound
    });
    n.onclick = () => {
      try {
        window.focus();
        opts.onClick?.();
      } catch {
        /* ignore */
      }
      n.close();
    };
    window.setTimeout(() => n.close(), 8000);
  } catch {
    /* ignore */
  }
}

export function notifyNewMails(
  items: Array<{ id: string; from: string; subject: string }>,
  onOpen?: (id: string) => void
) {
  if (!items.length) return;
  playNewMailSound();

  if (items.length === 1) {
    const m = items[0];
    showNewMailNotification({
      title: "Email baru",
      body: `${m.from}\n${m.subject || "(no subject)"}`,
      tag: `xme-${m.id}`,
      onClick: () => onOpen?.(m.id),
    });
  } else {
    showNewMailNotification({
      title: `${items.length} email baru`,
      body: items
        .slice(0, 3)
        .map((m) => `${m.from}: ${m.subject || "(no subject)"}`)
        .join("\n"),
      tag: "xme-mail-batch",
    });
  }
}
