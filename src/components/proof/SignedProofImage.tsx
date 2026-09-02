import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ImageOffIcon } from '@/components/icons';
import styles from './SignedProofImage.module.css';

export interface SignedProofImageProps {
  /** Short-lived signed URL from Supabase Storage — never a public URL. */
  src: string;
  alt: string;
}

/**
 * Renders a private proof photo from a short-lived signed URL, with its own
 * loading and failed-to-load states (Part 8 of the real-data phase). The URL
 * itself is requested by the caller only when the detail view is opened.
 */
export function SignedProofImage({ src, alt }: SignedProofImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );

  return (
    <div className={styles.frame}>
      {status !== 'error' && (
        <img
          src={src}
          alt={alt}
          className={styles.img}
          style={status === 'loading' ? { display: 'none' } : undefined}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
      {status === 'loading' && (
        <Skeleton width="100%" height="100%" radius="0" />
      )}
      {status === 'error' && (
        <div className={styles.fallback}>
          <ImageOffIcon className={styles.fallbackIcon} />
          <span>Bilden kunde inte laddas.</span>
        </div>
      )}
    </div>
  );
}
