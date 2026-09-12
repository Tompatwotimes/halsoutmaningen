export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** True on iOS Safari — the one major browser with no `beforeinstallprompt`. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAppleTouch =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as "Macintosh" but exposes multitouch.
    (ua.includes('Macintosh') && 'ontouchend' in document);
  return isAppleTouch;
}

/** True once the app is running installed (standalone), on any platform. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own legacy flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
