import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-level checks for the reduced-motion contract (§19 — CSS animation
 * timing in jsdom is brittle/unreliable; the CSS module's own rules are the
 * stable, meaningful thing to assert on). Real animated behaviour was
 * verified visually via Playwright screenshots during the v1.11.1 polish
 * pass (see the PR description), not re-asserted here.
 */
const css = readFileSync(
  join(import.meta.dirname, 'DoublePassStar.module.css'),
  'utf-8',
);

describe('DoublePassStar — reduced-motion contract (source-level)', () => {
  it('has a prefers-reduced-motion block', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('turns off the shimmer sweep animation under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(block).toMatch(/\.shimmer\s*{[^}]*animation:\s*none/);
  });

  it('turns off both sparkle animations under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(block).toMatch(/\.sparkleA,\s*\n?\s*\.sparkleB\s*{[^}]*animation:\s*none/);
  });

  it('stops the breathing glow animation under reduced motion', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(block).toMatch(/\.wrap::before\s*{[^}]*animation:\s*none/);
  });

  it('keeps the metallic gradient, edge and specular highlight defined unconditionally (never inside a reduced-motion gate)', () => {
    // Strip every `@media (prefers-reduced-motion...) { ... }` block (both
    // the breathing-glow one and the shimmer/sparkle one) and confirm the
    // core metallic look is still fully defined in what's left — i.e. none
    // of it lives only inside a reduced-motion conditional.
    const withoutReducedMotionBlocks = css.replace(
      /@media \(prefers-reduced-motion: reduce\)\s*{(?:[^{}]*{[^{}]*})*[^{}]*}/g,
      '',
    );
    expect(withoutReducedMotionBlocks).toMatch(/\.stop1\s*{/);
    expect(withoutReducedMotionBlocks).toMatch(/\.body\s*{[^}]*stroke:/);
    expect(withoutReducedMotionBlocks).toMatch(/\.specular\s*{/);
  });
});
