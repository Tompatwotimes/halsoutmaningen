import { describe, expect, it } from 'vitest';
import { deriveReplyTarget, replyQuoteText } from './replyPreview';
import { HIDDEN_MESSAGE_PLACEHOLDER } from './chat';
import type { ChatMessage, ReplyPreview } from './types';

function preview(over: Partial<ReplyPreview> = {}): ReplyPreview {
  return {
    deleted: false,
    messageId: 'p1',
    seq: 12,
    senderType: 'participant',
    senderUserId: 'u2',
    senderDisplayName: 'Anna',
    kind: 'text',
    text: 'Golf räknas inte som träning enligt reglerna',
    hasImage: false,
    training: null,
    ...over,
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    seq: 5,
    challengeId: 'c1',
    senderType: 'participant',
    senderUserId: 'u2',
    senderDisplayName: 'Anna',
    body: 'Golf räknas inte',
    status: 'active',
    attachments: [],
    trainingCard: null,
    hiddenReason: null,
    gameMasterEventId: null,
    replyToMessageId: null,
    replyPreview: null,
    likeCount: 0,
    likedByMe: false,
    createdAt: '2026-09-05T12:00:00Z',
    ...over,
  };
}

describe('replyQuoteText', () => {
  it('renders a text preview as the sender label + the (already truncated) text', () => {
    const { senderLabel, line } = replyQuoteText(preview(), 'u1');
    expect(senderLabel).toBe('Anna');
    expect(line).toBe('Golf räknas inte som träning enligt reglerna');
  });

  it('labels the viewer’s own quoted message as "Du"', () => {
    const { senderLabel } = replyQuoteText(
      preview({ senderUserId: 'u1' }),
      'u1',
    );
    expect(senderLabel).toBe('Du');
  });

  it('labels a Game Master parent as GAME MASTER', () => {
    const { senderLabel, line } = replyQuoteText(
      preview({
        senderType: 'game_master',
        senderUserId: null,
        senderDisplayName: null,
        kind: 'game_master',
        text: 'Systemet observerar er alla.',
      }),
      'u1',
    );
    expect(senderLabel).toBe('GAME MASTER');
    expect(line).toBe('Systemet observerar er alla.');
  });

  it('renders an image-only parent as 📷 Bild', () => {
    const { line } = replyQuoteText(
      preview({ kind: 'image', text: null, hasImage: true }),
      'u1',
    );
    expect(line).toBe('📷 Bild');
  });

  it('renders a training-card parent as 🏃 activity · minutes', () => {
    const { line } = replyQuoteText(
      preview({
        kind: 'training_card',
        text: null,
        training: { activity: 'Löpning', durationMinutes: 45 },
      }),
      'u1',
    );
    expect(line).toBe('🏃 Löpning · 45 min');
  });

  it('falls back to "Träning" when a training-card parent has no activity', () => {
    const { line } = replyQuoteText(
      preview({
        kind: 'training_card',
        text: null,
        training: { activity: null, durationMinutes: 30 },
      }),
      'u1',
    );
    expect(line).toBe('🏃 Träning · 30 min');
  });

  it('falls back to "Deltagare" when a participant parent has no display name', () => {
    const { senderLabel } = replyQuoteText(
      preview({ senderDisplayName: null }),
      'u1',
    );
    expect(senderLabel).toBe('Deltagare');
  });

  it('renders the canonical placeholder and NO sender for a hidden (deleted) parent', () => {
    const { senderLabel, line } = replyQuoteText(
      { ...preview(), deleted: true },
      'u1',
    );
    expect(senderLabel).toBe('');
    expect(line).toBe(HIDDEN_MESSAGE_PLACEHOLDER);
    expect(line).toBe('[Borttaget av administratör]');
  });

  it('never leaks parent text for a deleted parent even if the payload wrongly carries it', () => {
    const { line } = replyQuoteText(
      { ...preview({ text: 'hemlig text' }), deleted: true },
      'u1',
    );
    expect(line).not.toContain('hemlig');
  });

  it('handles a null viewer id without labelling a null-sender parent as "Du"', () => {
    const { senderLabel } = replyQuoteText(
      preview({ senderType: 'game_master', senderUserId: null }),
      null,
    );
    expect(senderLabel).toBe('GAME MASTER');
  });
});

describe('deriveReplyTarget', () => {
  it('carries the message id and a viewer-relative label + line for a text message', () => {
    const t = deriveReplyTarget(
      message({ id: 'm7', body: 'Hej på dig' }),
      'u1',
    );
    expect(t).toEqual({
      messageId: 'm7',
      senderLabel: 'Anna',
      line: 'Hej på dig',
    });
  });

  it('labels the viewer’s own message as "Du"', () => {
    const t = deriveReplyTarget(message({ senderUserId: 'u1' }), 'u1');
    expect(t.senderLabel).toBe('Du');
  });

  it('summarises an image-only message as 📷 Bild', () => {
    const t = deriveReplyTarget(
      message({
        body: null,
        attachments: [{ position: 1, path: 'c/u/m/1.jpg' }],
      }),
      'u1',
    );
    expect(t.line).toBe('📷 Bild');
  });

  it('summarises a training-card message as 🏃 activity · minutes', () => {
    const t = deriveReplyTarget(
      message({
        senderType: 'training_card',
        body: null,
        trainingCard: {
          entryId: 'e1',
          activity: 'Simning',
          durationMinutes: 60,
          note: null,
          challengeDate: '2026-09-05',
          entryStatus: 'active',
          trainedAt: '2026-09-05T12:00:00Z',
          proofs: [],
        },
      }),
      'u1',
    );
    expect(t.line).toBe('🏃 Simning · 60 min');
  });

  it('labels a Game Master message as GAME MASTER', () => {
    const t = deriveReplyTarget(
      message({
        senderType: 'game_master',
        senderUserId: null,
        senderDisplayName: null,
        body: 'Kör hårt.',
      }),
      'u1',
    );
    expect(t.senderLabel).toBe('GAME MASTER');
    expect(t.line).toBe('Kör hårt.');
  });
});
