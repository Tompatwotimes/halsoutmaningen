import { test, expect, type Page } from '@playwright/test';

/**
 * P0: "when I open the chat I still have to scroll down."
 *
 * Every case asserts the scroll container lands at the ACTUAL bottom
 * (`scrollTop === scrollHeight - clientHeight`, within a few px), not merely
 * "the last message is somewhere on screen".
 */

const HARNESS = '/e2e/harness/index.html';

const RICH_SEED = {
  count: 46,
  images: [4, 10, 17, 24, 31, 38, 44],
  cards: [8, 28],
  gm: [15],
  replies: [12, 35],
  likes: { 6: 2, 21: 5 },
  longAt: [3, 19, 41],
};

async function geo(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('[role="log"]');
    if (!list) return { present: false as const };
    const sc = list.parentElement as HTMLElement;
    const max = sc.scrollHeight - sc.clientHeight;
    return {
      present: true as const,
      scrollTop: Math.round(sc.scrollTop),
      scrollHeight: Math.round(sc.scrollHeight),
      clientHeight: Math.round(sc.clientHeight),
      maxScroll: Math.round(max),
      distanceFromBottom: Math.round(max - sc.scrollTop),
    };
  });
}

async function expectAtBottom(page: Page, label: string) {
  const g = await geo(page);
  expect(g.present, `${label}: chat panel present`).toBe(true);
  if (!g.present) return;
  expect(
    Math.abs(g.distanceFromBottom),
    `${label}: at actual bottom (top ${g.scrollTop}/${g.maxScroll})`,
  ).toBeLessThanOrEqual(4);
}

async function seed(page: Page, opts: Record<string, unknown> = RICH_SEED) {
  await page.evaluate((o) => {
    window.__chat.reset();
    window.__chat.seed(o);
    window.__chat.clearLog();
  }, opts);
}
async function open(page: Page) {
  await page.evaluate(() => window.__chat.open());
  await page.waitForSelector('[role="log"]');
}
async function close(page: Page) {
  await page.evaluate(() => window.__chat.close());
  await page.waitForSelector('[role="log"]', { state: 'detached' });
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__chat);
});

test('cold first open — data arrives after a loading state', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__chat.reset();
    window.__chat.setLoading(true);
    window.__chat.open();
  });
  await page.waitForTimeout(30);
  await page.evaluate((o) => {
    window.__chat.setLoading(false);
    window.__chat.seed(o);
  }, RICH_SEED);
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__chat.loadImagesStaggered(10));
  await page.waitForTimeout(500);
  await expectAtBottom(page, 'cold open');
});

test('cached open — messages present on the first render, images resolve late', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.waitForTimeout(25);
  await expectAtBottom(page, 'cached open (skeletons)');
  await page.evaluate(() => window.__chat.loadImagesStaggered(10));
  await page.waitForTimeout(600);
  await expectAtBottom(page, 'cached open (images settled)');
});

test('reopen — after browsing history in the prior session', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.evaluate(() => window.__chat.loadImages());
  await page.waitForTimeout(200);
  // scroll far up
  await page.evaluate(() => {
    const sc = document.querySelector('[role="log"]')!
      .parentElement as HTMLElement;
    sc.scrollTop = 20;
  });
  await page.waitForTimeout(50);
  await close(page);
  await open(page);
  await page.waitForTimeout(25);
  await expectAtBottom(page, 'reopen (before images)');
  await page.evaluate(() => window.__chat.loadImagesStaggered(10));
  await page.waitForTimeout(600);
  await expectAtBottom(page, 'reopen (images settled)');
});

test('cached open with native scroll-anchoring disabled (Safari-equivalent)', async ({
  page,
}) => {
  await page.addStyleTag({
    content:
      '#root [role="log"], #root [role="log"] * { overflow-anchor: none !important }',
  });
  await seed(page);
  await open(page);
  await page.waitForTimeout(25);
  await page.evaluate(() => window.__chat.loadImagesStaggered(9));
  await page.waitForTimeout(600);
  await expectAtBottom(page, 'no-anchor cached open');
});

test('late whole-list reflow (web font swap) after the pin', async ({
  page,
}) => {
  await seed(page, {
    count: 46,
    images: [],
    cards: [8],
    gm: [15],
    longAt: [3, 12, 19, 27, 33, 41],
  });
  await open(page);
  await page.waitForTimeout(30);
  await page.evaluate(() =>
    requestAnimationFrame(() => {
      const st = document.createElement('style');
      st.textContent =
        '[data-testid="chat-message-body"]{line-height:2.6 !important;font-size:1.1rem !important}';
      document.head.appendChild(st);
    }),
  );
  await page.waitForTimeout(500);
  await expectAtBottom(page, 'after font reflow');
});

test('incoming message while at the bottom follows to the new message', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.evaluate(() => window.__chat.loadImages());
  await page.waitForTimeout(200);
  await expectAtBottom(page, 'before incoming');
  await page.evaluate(() =>
    window.__chat.addMessage({ body: 'ny inkommande' }),
  );
  await page.waitForTimeout(200);
  await expectAtBottom(page, 'after incoming (followed)');
});

test('user scrolls up mid-session → late growth does NOT yank them down', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.evaluate(() => window.__chat.loadImages());
  await page.waitForTimeout(150);

  // a real wheel gesture up
  await page.evaluate(() => {
    const sc = document.querySelector('[role="log"]')!
      .parentElement as HTMLElement;
    sc.scrollTop = Math.max(0, sc.scrollTop - 1200);
  });
  await page.waitForTimeout(60);
  const away = await geo(page);
  expect(
    away.present && away.distanceFromBottom,
    'user is away from bottom',
  ).toBeGreaterThan(200);

  // content grows below/around
  await page.evaluate(() =>
    requestAnimationFrame(() => {
      const st = document.createElement('style');
      st.textContent =
        '[data-testid="chat-message-body"]{padding-bottom:16px !important}';
      document.head.appendChild(st);
    }),
  );
  await page.evaluate(() =>
    window.__chat.addMessage({ body: 'annan inkommande' }),
  );
  await page.waitForTimeout(300);

  const after = await geo(page);
  expect(
    after.present && after.distanceFromBottom,
    'still reading history — not yanked to the bottom',
  ).toBeGreaterThan(200);
  // and the "Nya meddelanden" pill is offered instead
  await expect(
    page.getByRole('button', { name: /nya meddelanden/i }),
  ).toBeVisible();
});

test('tapping "Nya meddelanden" jumps to the actual bottom and re-arms follow', async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await page.evaluate(() => window.__chat.loadImages());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const sc = document.querySelector('[role="log"]')!
      .parentElement as HTMLElement;
    sc.scrollTop = 40;
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__chat.addMessage({ body: 'trigger pill' }));
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /nya meddelanden/i }).click();
  await page.waitForTimeout(150);
  await expectAtBottom(page, 'after tapping the pill');
  // a subsequent incoming message now follows again
  await page.evaluate(() =>
    window.__chat.addMessage({ body: 'follows again' }),
  );
  await page.waitForTimeout(200);
  await expectAtBottom(page, 'follow re-armed');
});

test('rapid open / close / open lands at bottom every time', async ({
  page,
}) => {
  await seed(page);
  for (let i = 0; i < 4; i++) {
    await open(page);
    await page.evaluate(() => window.__chat.loadImagesStaggered(4));
    await page.waitForTimeout(120);
    await expectAtBottom(page, `open #${i + 1}`);
    await close(page);
    await page.waitForTimeout(30);
  }
});

test('no console errors during the full open lifecycle', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await seed(page);
  await open(page);
  await page.evaluate(() => window.__chat.loadImagesStaggered(8));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__chat.addMessage({ body: 'x' }));
  await page.waitForTimeout(200);
  await close(page);
  expect(errors, errors.join('\n')).toEqual([]);
});
