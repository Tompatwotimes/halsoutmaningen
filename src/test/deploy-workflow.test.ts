import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Structural guard for `.github/workflows/deploy-production.yml`'s shape.
 *
 * NOTE (confirmed 2026-09-12, docs/DEPLOYMENT.md §1.6 postmortem): this
 * workflow is NOT the active production release path — no
 * CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID secret or `production` GitHub
 * Environment has ever been configured for it. The real gate is Cloudflare's
 * own Branch control (the `production` git branch); code reaches production
 * by fast-forwarding `production` to a verified `main` SHA, never through
 * this workflow. These assertions just keep the file's shape sane (dispatch-
 * only trigger, environment-gated, wrangler-action, no secrets leaked) in
 * case it is ever wired up for real in the future.
 *
 * This is a static text check on purpose — it needs no YAML parser dependency
 * and it is exactly the invariant we care about.
 */
const repoRoot = process.cwd();
const workflowPath = path.join(
  repoRoot,
  '.github/workflows/deploy-production.yml',
);

describe('production deploy workflow', () => {
  it('exists', () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  const yaml = existsSync(workflowPath)
    ? readFileSync(workflowPath, 'utf8')
    : '';

  it('is triggered only by workflow_dispatch — never push or pull_request', () => {
    expect(yaml).toMatch(/^on:\s*$/m);
    expect(yaml).toContain('workflow_dispatch:');
    // No automatic triggers anywhere in the file.
    expect(yaml).not.toMatch(/^\s*push:/m);
    expect(yaml).not.toMatch(/^\s*pull_request:/m);
    expect(yaml).not.toMatch(/^\s*schedule:/m);
  });

  it('runs the deploy job through the `production` environment (approval gate)', () => {
    expect(yaml).toMatch(/environment:\s*\n\s*name:\s*production/);
  });

  it('deploys with wrangler-action using secrets, not a committed token', () => {
    expect(yaml).toContain('cloudflare/wrangler-action@v3');
    expect(yaml).toContain('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(yaml).toContain('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
    // The service-role key must never be built into the frontend.
    expect(yaml).not.toContain('SERVICE_ROLE');
  });
});

describe('database-tests workflow stays non-deploying', () => {
  it('never deploys anything', () => {
    const p = path.join(repoRoot, '.github/workflows/database-tests.yml');
    const yaml = readFileSync(p, 'utf8');
    // No step ever runs wrangler or a linked db push (mentions in comments,
    // e.g. "Never runs `supabase db push`", are fine).
    const runLines = yaml
      .split('\n')
      .filter((l) => /^\s*(run:|-\s*run:|uses:)/.test(l));
    for (const line of runLines) {
      expect(line).not.toMatch(/wrangler/);
      expect(line).not.toMatch(/db\s+push/);
      expect(line).not.toMatch(/--linked/);
    }
  });
});

describe('wrangler config', () => {
  const wrangler = readFileSync(path.join(repoRoot, 'wrangler.jsonc'), 'utf8');

  it('is a static-assets-only Worker with SPA routing', () => {
    expect(wrangler).toContain('"name": "halsoutmaningen"');
    expect(wrangler).toContain('"directory": "./dist"');
    expect(wrangler).toContain(
      '"not_found_handling": "single-page-application"',
    );
  });

  it('carries no secrets or service-role key', () => {
    expect(wrangler).not.toMatch(/service_role/i);
    expect(wrangler).not.toMatch(/SUPABASE_SERVICE/);
    expect(wrangler).not.toMatch(/anon[_-]?key"\s*:/i);
  });
});
