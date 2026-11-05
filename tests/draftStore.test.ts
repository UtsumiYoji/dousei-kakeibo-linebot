import { describe, expect, it } from "vitest";
import { DraftStore } from "../src/draftStore.js";

function setup() {
  let now = 0;
  let id = 0;
  const store = new DraftStore(1000, () => now, () => `draft-${(id += 1)}`);
  return { store, tick: (ms: number) => { now += ms; } };
}

const fields = { date: "2026-11-05" };

describe("DraftStore", () => {
  it("取り出せるのは1回だけ", () => {
    const { store } = setup();
    const draft = store.create("chat", "user", fields);

    expect(store.take(draft.id, "chat")?.id).toBe(draft.id);
    expect(store.take(draft.id, "chat")).toBeUndefined();
  });

  it("restoreで戻せる", () => {
    const { store } = setup();
    const draft = store.create("chat", "user", fields);
    const taken = store.take(draft.id, "chat");

    store.restore(taken!);

    expect(store.get(draft.id, "chat")).toBeDefined();
  });

  it("別のチャットからは見えない", () => {
    const { store } = setup();
    const draft = store.create("chat", "user", fields);

    expect(store.get(draft.id, "other")).toBeUndefined();
    expect(store.take(draft.id, "other")).toBeUndefined();
    expect(store.latest("other")).toBeUndefined();
  });

  it("期限が切れると消える", () => {
    const { store, tick } = setup();
    const draft = store.create("chat", "user", fields);

    tick(1001);

    expect(store.get(draft.id, "chat")).toBeUndefined();
  });

  it("更新すると期限が延びる", () => {
    const { store, tick } = setup();
    const draft = store.create("chat", "user", fields);

    tick(800);
    store.update(draft.id, { amountYen: 100 });
    tick(800);

    expect(store.get(draft.id, "chat")?.amountYen).toBe(100);
  });

  it("本人の下書きを優先し、なければチャットの直近を返す", () => {
    const { store, tick } = setup();
    const own = store.create("chat", "user-a", fields);
    tick(1);
    const other = store.create("chat", "user-b", fields);

    expect(store.latest("chat", "user-a")?.id).toBe(own.id);
    expect(store.latest("chat", "user-c")?.id).toBe(other.id);
    expect(store.latest("chat")?.id).toBe(other.id);
  });
});
