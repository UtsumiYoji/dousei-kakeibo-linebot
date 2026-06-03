import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessionStore.js";

describe("SessionStore", () => {
  it("expires sessions after ttl", () => {
    let now = 0;
    const store = new SessionStore(1000, () => now);

    store.set("user", { step: "amount", draft: {} });
    expect(store.get("user")).toBeDefined();

    now = 1001;
    expect(store.get("user")).toBeUndefined();
  });

  it("detects duplicate processed event ids", () => {
    const store = new SessionStore(1000);

    expect(store.markProcessed("event-1")).toBe(false);
    expect(store.markProcessed("event-1")).toBe(true);
  });
});
