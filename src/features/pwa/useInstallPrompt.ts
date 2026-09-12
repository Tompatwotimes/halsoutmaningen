import { useEffect, useState } from 'react';
import type { BeforeInstallPromptEvent } from './install';
import { isStandalone } from './install';

/**
 * Captures the browser's `beforeinstallprompt` event (Chrome/Edge/Android) so
 * the app can offer an explicit "Installera appen" affordance instead of the
 * browser's own address-bar icon. Never auto-prompts.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferredEvent(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function promptInstall(): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > {
    if (!deferredEvent) return 'unavailable';
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    setDeferredEvent(null);
    return choice.outcome;
  }

  return {
    canPrompt: deferredEvent !== null,
    installed,
    promptInstall,
  };
}
