import type { Session } from "./types.js";

type StoredId = {
  expiresAt: number;
};

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly processedEventIds = new Map<string, StoredId>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  get(userId: string): Session | undefined {
    this.cleanup();
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    if (this.isExpired(session.updatedAt)) {
      this.sessions.delete(userId);
      return undefined;
    }
    return session;
  }

  set(userId: string, session: Omit<Session, "updatedAt">): Session {
    const next = { ...session, updatedAt: this.now() };
    this.sessions.set(userId, next);
    return next;
  }

  delete(userId: string): void {
    this.sessions.delete(userId);
  }

  markProcessed(eventId: string | undefined): boolean {
    if (!eventId) return false;
    this.cleanup();
    if (this.processedEventIds.has(eventId)) return true;
    this.processedEventIds.set(eventId, { expiresAt: this.now() + this.ttlMs });
    return false;
  }

  private isExpired(updatedAt: number): boolean {
    return this.now() - updatedAt > this.ttlMs;
  }

  private cleanup(): void {
    const now = this.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.updatedAt > this.ttlMs) this.sessions.delete(userId);
    }
    for (const [eventId, stored] of this.processedEventIds) {
      if (stored.expiresAt <= now) this.processedEventIds.delete(eventId);
    }
  }
}
