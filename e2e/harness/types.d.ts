// Ambient types for the chat scroll harness control surface (window.__chat).
interface ChatHarness {
  log: { t: number; ev: string; [k: string]: unknown }[];
  clearLog(): void;
  reset(): void;
  seed(opts?: Record<string, unknown>): { count: number; seqMax: number };
  open(): void;
  close(): void;
  setLoading(v: boolean): void;
  loadImages(): void;
  loadImagesStaggered(stepMs?: number): Promise<void>;
  addMessage(over?: Record<string, unknown>): number;
  refetchSameSeqs(): void;
  setHasNextPage(v: boolean): void;
  getState(): { open: boolean; messages: number; [k: string]: unknown };
}
interface Window {
  __chat: ChatHarness;
}
