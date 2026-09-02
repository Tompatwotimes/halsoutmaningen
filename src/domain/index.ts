/**
 * Domain layer — pure, framework-free challenge logic.
 *
 * Everything here is deterministic and unit-tested. It mirrors the canonical
 * PostgreSQL logic for optimistic UI; the database remains authoritative for
 * anything security- or money-sensitive.
 */

export * from './dates';
export * from './time';
export * from './challenge';
export * from './membership';
export * from './penalties';
export * from './dayState';
export * from './streaks';
export * from './liability';
export * from './format';
