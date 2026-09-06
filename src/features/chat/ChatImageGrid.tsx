import { useState } from 'react';
import { ImageOffIcon } from '@/components/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useChatImageUrls } from './useChat';
import { ChatLightbox } from './ChatLightbox';
import type { ChatAttachment } from './types';
import styles from './ChatImageGrid.module.css';

/**
 * Thumbnail grid for a message's 1–4 image attachments. 1 → one contained
 * thumbnail; 2 → two columns; 3–4 → a 2×2 grid. Tapping a thumbnail opens a
 * full-screen `ChatLightbox`. Signed URLs are resolved lazily via
 * `useChatImageUrls`; a slot that resolves to `null` (denied — e.g. the
 * message was hidden between load and click) shows a broken-image fallback and
 * never crashes the bubble.
 */
export function ChatImageGrid({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: ChatAttachment[];
}) {
  const { data, isLoading } = useChatImageUrls(messageId, attachments);
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);

  const count = Math.min(attachments.length, 4);
  const urls = attachments.map(
    (a) => data?.find((d) => d.position === a.position)?.url ?? null,
  );

  return (
    <>
      <div
        className={styles.grid}
        data-count={count}
        data-testid="chat-image-grid"
      >
        {attachments.slice(0, 4).map((a, i) => (
          <Thumb
            key={a.path}
            url={isLoading ? undefined : urls[i]}
            index={i}
            total={count}
            onOpen={() => setLightboxAt(i)}
          />
        ))}
      </div>
      {lightboxAt !== null && (
        <ChatLightbox
          urls={urls}
          startIndex={lightboxAt}
          onClose={() => setLightboxAt(null)}
        />
      )}
    </>
  );
}

function Thumb({
  url,
  index,
  total,
  onOpen,
}: {
  /** undefined = still resolving; null = denied/failed. */
  url: string | null | undefined;
  index: number;
  total: number;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);

  if (url === undefined) {
    return <Skeleton width="100%" height="100%" radius="var(--radius-md)" />;
  }
  if (url === null || failed) {
    return (
      <div className={styles.broken} aria-label="Bilden kunde inte laddas">
        <ImageOffIcon />
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.thumbButton}
      onClick={onOpen}
      aria-label={`Öppna bild ${index + 1} av ${total}`}
    >
      <img
        src={url}
        alt=""
        className={styles.thumb}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  );
}
