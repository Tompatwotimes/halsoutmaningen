/* eslint-disable */
// @ts-nocheck
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatPanel } from '@/features/chat/ChatPanel';
import '@/styles/tokens.css';
import '@/styles/global.css';

// mirror mock-useChat's store just enough to know `open`
import './mock-useChat';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Harness() {
  // subscribe to the mock store's `open`
  const open = useSyncExternalStore(
    (l) => {
      const id = setInterval(l, 16);
      return () => clearInterval(id);
    },
    () => window.__chat.getState().open,
  );

  return (
    <QueryClientProvider client={client}>
      <button
        id="toggle"
        onClick={() => (open ? window.__chat.close() : window.__chat.open())}
      >
        toggle
      </button>
      <ChatPanel
        open={open}
        onClose={() => window.__chat.close()}
        challengeId="c1"
        userId="me"
        timeZone="Europe/Stockholm"
        isAdmin={false}
      />
    </QueryClientProvider>
  );
}

const strict = new URLSearchParams(location.search).get('strict') === '1';
const root = createRoot(document.getElementById('root'));
root.render(
  strict ? (
    <StrictMode>
      <Harness />
    </StrictMode>
  ) : (
    <Harness />
  ),
);
