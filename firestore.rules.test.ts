import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Hardened Rules Verification & Dirty Dozen Static + Structural Audit
 * Validates that firestore.rules enforces all 12 Dirty Dozen invariants:
 * - Global default deny
 * - Verified email requirement
 * - Strict key allowlisting (hasAll + hasOnly)
 * - Validation helper wrapping on both create and update
 * - Immutable ownerId, guideId, and createdAt
 * - Server timestamp enforcement (request.time)
 * - Master Gate relational checks on subcollections
 * - Query enforcer on allow list
 */
describe('Firestore Security Rules — Dirty Dozen Audit', () => {
  const rulesPath = path.resolve(__dirname, 'firestore.rules');

  it('enforces global default deny and rules_version 2', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain("rules_version = '2';");
    expect(content).toContain('match /{document=**}');
    expect(content).toContain('allow read, write: if false;');
  });

  it('rejects unverified emails and enforces tenant identity isolation (Payloads 1, 2, 3)', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain('request.auth.token.email_verified == true');
    expect(content).toContain('request.auth.uid == userId');
    expect(content).toContain('data.ownerId == request.auth.uid');
    expect(content).toContain('existing().ownerId == request.auth.uid');
  });

  it('blocks shadow field injection and enforces strict blueprints on create and update (Payloads 4, 5, 7, 8)', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain('isValidUserSettings(incoming())');
    expect(content).toContain('isValidProduct(incoming())');
    expect(content).toContain('isValidGiftGuide(incoming())');
    expect(content).toContain('isValidGuideSection(incoming())');
    expect(content).toContain('isValidHtmlProject(incoming())');
    expect(content).toContain('affectedKeys().hasOnly(');
    expect(content).toContain('data.tags is list && data.tags.size() <= 20');
  });

  it('guards against ID poisoning, immutable field mutation, and forged timestamps (Payloads 6, 9, 10, 11)', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
    expect(content).toContain('incoming().ownerId == existing().ownerId');
    expect(content).toContain('incoming().createdAt == existing().createdAt');
    expect(content).toContain('incoming().createdAt == request.time');
    expect(content).toContain('incoming().updatedAt == request.time');
  });

  it('enforces Master Gate relational checks on GuideSection subcollections (Payload 12)', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain('exists(/databases/$(database)/documents/users/$(userId)/guides/$(guideId))');
    expect(content).toContain('get(/databases/$(database)/documents/users/$(userId)/guides/$(guideId)).data.ownerId == request.auth.uid');
  });

  it('permits owner existence checks (resource == null) on get before initial document creation', () => {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    expect(content).toContain('(resource == null || existing().ownerId == request.auth.uid)');
  });
});

