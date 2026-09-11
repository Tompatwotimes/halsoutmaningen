/* eslint-disable */
// @ts-nocheck
/**
 * Browser harness mock for `src/features/chat/useChat.ts`.
 *
 * Aliased in place of the real module by e2e/harness/vite.config.ts so the REAL
 * ChatPanel / Sheet / MessageRow / CSS / portal / ResizeObserver run against
 * fixture data controlled from Playwright via `window.__chat`.
 *
 * It deliberately mirrors the real cache semantics that matter for the scroll
 * bug: on a "cached open" the messages are present synchronously on the first
 * render with `isLoading` false (no loading→loaded transition).
 */
import { useSyncExternalStore, useCallback, useRef } from 'react';

// ---- external store -------------------------------------------------------
const state = {
  open: false,
  messages: [] /* ChatMessage[] */,
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  isError: false,
  // per-image "signed url ready" — keyed by messageId
  imageReady: {} /* Record<string, boolean> */,
};
const listeners = new Set();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function snap() {
  return version;
}

const log = [];
function record(ev, extra) {
  log.push({ t: performance.now(), ev, ...(extra || {}) });
}

// ---- fixture builders ---------------------------------------------------
let seqCounter = 0;
function mkMsg(over = {}) {
  const seq = over.seq ?? ++seqCounter;
  return {
    id: over.id ?? `m${seq}`,
    seq,
    challengeId: 'c1',
    senderType: over.senderType ?? 'participant',
    senderUserId:
      over.senderUserId ?? (over.isSelf ? 'me' : `u${(seq % 5) + 2}`),
    senderDisplayName:
      over.senderDisplayName ??
      (over.senderType === 'game_master'
        ? null
        : ['Anna', 'Erik', 'Johan', 'Lisa', 'Tomas'][seq % 5]),
    body: over.body ?? `Meddelande ${seq}`,
    status: over.status ?? 'active',
    attachments: over.attachments ?? [],
    trainingCard: over.trainingCard ?? null,
    hiddenReason: null,
    gameMasterEventId: null,
    replyToMessageId: over.replyPreview ? over.replyPreview.messageId : null,
    replyPreview: over.replyPreview ?? null,
    likeCount: over.likeCount ?? 0,
    likedByMe: over.likedByMe ?? false,
    createdAt:
      over.createdAt ??
      new Date(Date.UTC(2026, 8, 5, 12, 0, seq)).toISOString(),
  };
}

// ---- hooks (public surface of useChat.ts consumed by ChatPanel) --------
export const chatKeys = {
  messages: (id) => ['chat', 'messages', id],
  unread: (id, u) => ['chat', 'unread', id, u],
  unreadRoot: (id) => ['chat', 'unread', id],
};

export function useChatMessages(challengeId) {
  useSyncExternalStore(subscribe, snap, snap);
  record('useChatMessages:render', { challengeId, n: state.messages.length });
  return {
    messages: challengeId == null ? [] : state.messages,
    isLoading: challengeId == null ? false : state.isLoading,
    isError: state.isError,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: state.isFetchingNextPage,
    fetchNextPage: () => {
      record('fetchNextPage');
      return Promise.resolve();
    },
  };
}

export function useUnreadChatCount() {
  return { data: 0, isLoading: false };
}

export function usePostChatMessage() {
  return {
    mutate: (_vars, opts) => {
      record('post.mutate');
      window.setTimeout(() => opts?.onSuccess?.(), 10);
      window.setTimeout(() => opts?.onSettled?.(), 12);
    },
    isPending: false,
    isError: false,
    error: null,
  };
}

export function useMarkChatRead() {
  return {
    mutate: (v) => record('markRead', v),
  };
}

export function useSetChatMessageLike() {
  const inFlight = useRef(new Set());
  const setLike = useCallback((vars) => {
    record('setLike', vars);
    // optimistic: flip the fixture row, preserving other identities
    state.messages = state.messages.map((m) =>
      m.id === vars.messageId
        ? {
            ...m,
            likedByMe: vars.liked,
            likeCount: Math.max(
              0,
              m.likeCount +
                (vars.liked === m.likedByMe ? 0 : vars.liked ? 1 : -1),
            ),
          }
        : m,
    );
    emit();
  }, []);
  return {
    setLike,
    isPending: (id) => inFlight.current.has(id),
    error: null,
    reset: () => {},
  };
}

// images: ChatImageGrid calls this; models a signed-URL React Query that starts
// isLoading:true and resolves async (mirroring the real N-queries-on-open path).
export function useChatImageUrls(messageId, attachments) {
  useSyncExternalStore(subscribe, snap, snap);
  const ready = state.imageReady[messageId];
  return {
    data: ready
      ? attachments.map((a) => ({
          position: a.position,
          url:
            'data:image/svg+xml;utf8,' +
            encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520"><rect width="400" height="520" fill="#345"/></svg>`,
            ),
        }))
      : [],
    isLoading: !ready,
  };
}

export function useTrainingCardProofUrls() {
  return { data: [], isLoading: false };
}

// ---- Playwright control surface ---------------------------------------
window.__chat = {
  log,
  clearLog: () => (log.length = 0),
  reset: () => {
    seqCounter = 0;
    state.messages = [];
    state.open = false;
    state.isLoading = false;
    state.hasNextPage = false;
    state.imageReady = {};
    emit();
  },
  /** seed N messages of a realistic mix; returns the fixture */
  seed: (opts = {}) => {
    const {
      count = 40,
      images = [3, 12, 25],
      cards = [7, 19],
      gm = [15],
      replies = [10, 30],
      likes = { 4: 3, 11: 1, 22: 6 },
      hidden = [],
      longAt = [2, 17, 33],
    } = opts;
    seqCounter = 0;
    const msgs = [];
    for (let i = 1; i <= count; i++) {
      const over = {};
      if (images.includes(i))
        over.attachments = [{ position: 1, path: `c/u/m${i}/1.webp` }];
      if (cards.includes(i)) {
        over.senderType = 'training_card';
        over.body = null;
        over.trainingCard = {
          entryId: `e${i}`,
          activity: 'Löpning',
          durationMinutes: 42,
          note: null,
          challengeDate: '2026-09-05',
          entryStatus: 'active',
          trainedAt: new Date(Date.UTC(2026, 8, 5, 11, 0, i)).toISOString(),
          proofs: [],
        };
      }
      if (gm.includes(i)) {
        over.senderType = 'game_master';
        over.senderUserId = null;
        over.senderDisplayName = null;
        over.body = 'GAME MASTER: systemet observerar er alla noggrant.';
      }
      if (replies.includes(i))
        over.replyPreview = {
          deleted: false,
          messageId: `m${i - 3}`,
          seq: i - 3,
          senderType: 'participant',
          senderUserId: 'u2',
          senderDisplayName: 'Anna',
          kind: 'text',
          text: `Meddelande ${i - 3}`,
          hasImage: false,
          training: null,
        };
      if (likes[i]) {
        over.likeCount = likes[i];
        over.likedByMe = likes[i] > 4;
      }
      if (hidden.includes(i)) {
        over.status = 'hidden';
        over.body = null;
      }
      if (longAt.includes(i))
        over.body =
          'Det här är ett långt meddelande som ska radbrytas över flera rader så att höjden blir rejält större än en enrads-bubbla. '.repeat(
            3,
          );
      if (i % 4 === 0) over.isSelf = true;
      msgs.push(mkMsg(over));
    }
    state.messages = msgs;
    state.isLoading = false;
    emit();
    return { count, seqMax: count };
  },
  open: () => {
    state.open = true;
    record('open=true');
    emit();
  },
  close: () => {
    state.open = false;
    record('open=false');
    emit();
  },
  setLoading: (v) => {
    state.isLoading = v;
    emit();
  },
  /** mark ALL image rows "url ready" in one commit → rows grow together */
  loadImages: () => {
    for (const m of state.messages)
      if (m.attachments.length) state.imageReady[m.id] = true;
    record('loadImages');
    emit();
  },
  /** resolve image URLs one-by-one over real time (mirrors N async signed-URL
   *  queries landing on separate microtask/frames after a cached open) */
  loadImagesStaggered: (stepMs = 8) =>
    new Promise((resolve) => {
      const ids = state.messages
        .filter((m) => m.attachments.length)
        .map((m) => m.id);
      let i = 0;
      const tick = () => {
        if (i >= ids.length) {
          record('loadImagesStaggered:done');
          resolve();
          return;
        }
        state.imageReady[ids[i++]] = true;
        emit();
        window.setTimeout(tick, stepMs);
      };
      record('loadImagesStaggered:start');
      window.setTimeout(tick, stepMs);
    }),
  addMessage: (over = {}) => {
    const m = mkMsg(over);
    state.messages = [...state.messages, m];
    record('addMessage', { seq: m.seq });
    emit();
    return m.seq;
  },
  /** replace with same seqs but a new array + new row identities (a Realtime refetch) */
  refetchSameSeqs: () => {
    state.messages = state.messages.map((m) => ({ ...m }));
    record('refetchSameSeqs');
    emit();
  },
  setHasNextPage: (v) => {
    state.hasNextPage = v;
    emit();
  },
  getState: () => ({ ...state, messages: state.messages.length }),
};
