import { describe, expect, it, vi } from "vitest";
import { ExpenseConversation } from "../src/conversation.js";
import { DraftStore } from "../src/draftStore.js";
import { ExpenseAssistant, type ChatContext } from "../src/expenseAssistant.js";
import type { LlmClient } from "../src/llmClient.js";
import { SessionStore } from "../src/sessionStore.js";
import type { BotReply, KakeiboClient } from "../src/types.js";

const GROUP = "group-1";
const NOW = new Date("2026-11-05T03:00:00.000Z");
const taro: ChatContext = { chatId: GROUP, chatType: "group", userId: "user-taro" };
const unmapped: ChatContext = { chatId: GROUP, chatType: "group", userId: "user-new" };
const noUserId: ChatContext = { chatId: GROUP, chatType: "group" };
const strangers: ChatContext = { chatId: "group-other", chatType: "group", userId: "user-taro" };
const direct: ChatContext = { chatId: "user-taro", chatType: "user", userId: "user-taro" };

function fakeKakeibo(overrides: Partial<KakeiboClient> = {}): KakeiboClient {
  return {
    listCategories: vi.fn(async () => [
      { id: "cat-food", name: "食費", displayOrder: 0 },
      { id: "cat-other", name: "その他", displayOrder: 1 }
    ]),
    listMembers: vi.fn(async () => [
      { id: "member-a", name: "太郎", displayOrder: 0, isActive: true },
      { id: "member-b", name: "花子", displayOrder: 1, isActive: true },
      { id: "member-x", name: "無効", displayOrder: 2, isActive: false }
    ]),
    listUnsettledExpenses: vi.fn(async () => []),
    listRecentExpenses: vi.fn(async () => []),
    getSettlementSummary: vi.fn(async () => ({ balances: [], suggestedTransfers: [] })),
    createExpense: vi.fn(async () => ({ id: "expense-1" })),
    ...overrides
  };
}

function setup(options: { responses?: unknown[]; kakeibo?: Partial<KakeiboClient>; withoutLlm?: boolean } = {}) {
  const kakeibo = fakeKakeibo(options.kakeibo);
  const responses = [...(options.responses ?? [])];
  const completeJson = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const llm: LlmClient = { completeJson };
  const sessions = new SessionStore(60_000);
  let id = 0;
  const assistant = new ExpenseAssistant({
    conversation: new ExpenseConversation(sessions, kakeibo, new Set(["user-taro"])),
    sessions,
    drafts: new DraftStore(60_000, undefined, () => `draft-${(id += 1)}`),
    kakeibo,
    llm: options.withoutLlm ? undefined : llm,
    allowedUserIds: new Set(["user-taro"]),
    allowedGroupIds: new Set([GROUP]),
    memberMap: new Map([["user-taro", "太郎"]]),
    now: () => NOW
  });
  return { assistant, kakeibo, completeJson };
}

const proposal = (overrides: Record<string, unknown> = {}) => ({
  action: "propose",
  amountYen: 3200,
  category: "食費",
  payer: "太郎",
  description: "スーパー",
  date: "2026-11-04",
  ...overrides
});

const receipt = (overrides: Record<string, unknown> = {}) => ({
  isReceipt: true,
  store: "テストマート",
  date: "2026-11-01",
  totalYen: 750,
  category: "食費",
  description: "牛乳ほか",
  ...overrides
});

const image = async () => Buffer.from("image");

function rowValue(reply: BotReply | undefined, label: string): string | undefined {
  return reply?.card?.rows.find((row) => row.label === label)?.value;
}

function buttonData(reply: BotReply | undefined, label: string): string {
  const data = reply?.card?.buttons.find((button) => button.label === label)?.data;
  if (!data) throw new Error(`button not found: ${label}`);
  return data;
}

describe("ExpenseAssistant: テキスト", () => {
  it("支出の発言から下書きを作るが、承認されるまで登録しない", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });

    const [reply] = await assistant.handleText(taro, "昨日スーパーで3200円使った");

    expect(rowValue(reply, "金額")).toBe("3,200円");
    expect(rowValue(reply, "支払者")).toBe("太郎");
    expect(rowValue(reply, "日付")).toBe("2026-11-04");
    expect(kakeibo.createExpense).not.toHaveBeenCalled();
  });

  it("承認すると日本時間の日付つきで登録する", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });
    const [draft] = await assistant.handleText(taro, "昨日スーパーで3200円使った");

    const [done] = await assistant.handlePostback(taro, buttonData(draft, "登録"));

    expect(done?.text).toContain("登録しました");
    expect(kakeibo.createExpense).toHaveBeenCalledWith({
      description: "スーパー",
      amountYen: 3200,
      categoryId: "cat-food",
      payerMemberId: "member-a",
      occurredAt: "2026-11-04T12:00:00+09:00"
    });
  });

  it("承認ボタンは下書きを作った人以外でも押せる", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });
    const [draft] = await assistant.handleText(taro, "昨日スーパーで3200円使った");

    await assistant.handlePostback(noUserId, buttonData(draft, "登録"));

    expect(kakeibo.createExpense).toHaveBeenCalledTimes(1);
  });

  it("承認ボタンを連打しても1回しか登録しない", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });
    const [draft] = await assistant.handleText(taro, "昨日スーパーで3200円使った");
    const data = buttonData(draft, "登録");

    await assistant.handlePostback(taro, data);
    const [second] = await assistant.handlePostback(taro, data);

    expect(second?.text).toContain("登録済みか");
    expect(kakeibo.createExpense).toHaveBeenCalledTimes(1);
  });

  it("登録に失敗したら下書きを残して再試行できる", async () => {
    const createExpense = vi.fn<KakeiboClient["createExpense"]>()
      .mockRejectedValueOnce(new Error("接続できません"))
      .mockResolvedValueOnce({ id: "expense-1" });
    const { assistant } = setup({ responses: [proposal()], kakeibo: { createExpense } });
    const [draft] = await assistant.handleText(taro, "昨日スーパーで3200円使った");
    const data = buttonData(draft, "登録");

    expect((await assistant.handlePostback(taro, data))[0]?.text).toContain("登録できませんでした");
    expect((await assistant.handlePostback(taro, data))[0]?.text).toContain("登録しました");
    expect(createExpense).toHaveBeenCalledTimes(2);
  });

  it("「登録」の発言でも直近の下書きを承認でき、「はい」では承認しない", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal(), { action: "none" }] });
    await assistant.handleText(taro, "昨日スーパーで3200円使った");

    await assistant.handleText(taro, "はい");
    expect(kakeibo.createExpense).not.toHaveBeenCalled();

    await assistant.handleText(taro, "登録");
    expect(kakeibo.createExpense).toHaveBeenCalledTimes(1);
  });

  it("取消で下書きを捨てる", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });
    const [draft] = await assistant.handleText(taro, "昨日スーパーで3200円使った");

    expect((await assistant.handlePostback(taro, buttonData(draft, "取消")))[0]?.text).toContain("取り消しました");
    expect((await assistant.handlePostback(taro, buttonData(draft, "登録")))[0]?.text).toContain("登録済みか");
    expect(kakeibo.createExpense).not.toHaveBeenCalled();
  });

  it("修正の発言は変わった項目だけ下書きへ反映する", async () => {
    const { assistant, completeJson } = setup({
      responses: [proposal(), { action: "update", amountYen: 3000, category: null, payer: null, description: null, date: null }]
    });
    await assistant.handleText(taro, "昨日スーパーで3200円使った");

    const [reply] = await assistant.handleText(taro, "やっぱ3000円だった");

    expect(rowValue(reply, "金額")).toBe("3,000円");
    expect(rowValue(reply, "内容")).toBe("スーパー");
    expect(rowValue(reply, "日付")).toBe("2026-11-04");
    expect(JSON.stringify(completeJson.mock.calls.at(-1))).toContain("現在の下書き");
  });

  it("金額がなければ尋ね、次の発言を同じ下書きへ反映する", async () => {
    const { assistant } = setup({
      responses: [
        { action: "ask", amountYen: null, category: "食費", payer: "太郎", description: "ご飯代", date: null },
        { action: "propose", amountYen: 1800, category: null, payer: null, description: null, date: null }
      ]
    });

    expect((await assistant.handleText(taro, "ご飯代払った"))[0]?.text).toContain("金額を送ってください");
    const [reply] = await assistant.handleText(taro, "1800");

    expect(rowValue(reply, "金額")).toBe("1,800円");
    expect(rowValue(reply, "内容")).toBe("ご飯代");
  });

  it("支出と無関係の発言には反応しない", async () => {
    const { assistant } = setup({ responses: [{ action: "none" }] });

    expect(await assistant.handleText(taro, "今日めっちゃ暑いね")).toEqual([]);
  });

  it("候補にないカテゴリは「その他」に丸め、未来の日付は今日にする", async () => {
    const { assistant } = setup({ responses: [proposal({ category: "交通費", date: "2099-01-01" })] });

    const [reply] = await assistant.handleText(taro, "電車代3200円");

    expect(rowValue(reply, "カテゴリ")).toBe("その他");
    expect(rowValue(reply, "日付")).toBe("2026-11-05");
  });

  it("LLMが失敗したら手入力を案内する", async () => {
    const { assistant } = setup({ responses: [new Error("429")] });

    expect((await assistant.handleText(taro, "スーパー 1200"))[0]?.text).toContain("支出登録");
  });

  it("同じ日付と金額の支出があれば警告する", async () => {
    const { assistant } = setup({
      responses: [proposal()],
      kakeibo: { listRecentExpenses: vi.fn(async () => [{ id: "e1", amountYen: 3200, occurredAt: "2026-11-04T01:00:00.000Z" }]) }
    });

    expect((await assistant.handleText(taro, "スーパー3200円"))[0]?.card?.warning).toContain("すでに登録");
  });

  it("重複の確認に失敗しても下書きは作る", async () => {
    const { assistant } = setup({
      responses: [proposal()],
      kakeibo: { listRecentExpenses: vi.fn(async () => { throw new Error("down"); }) }
    });

    expect(rowValue((await assistant.handleText(taro, "スーパー3200円"))[0], "金額")).toBe("3,200円");
  });
});

describe("ExpenseAssistant: レシート画像", () => {
  it("レシートから下書きを作り、支払者を送信者にする", async () => {
    const { assistant, kakeibo, completeJson } = setup({ responses: [receipt()] });

    const [reply] = await assistant.handleImage(taro, image);

    expect(rowValue(reply, "金額")).toBe("750円");
    expect(rowValue(reply, "支払者")).toBe("太郎");
    expect(rowValue(reply, "内容")).toBe("テストマート");
    expect(rowValue(reply, "日付")).toBe("2026-11-01");
    expect(JSON.stringify(completeJson.mock.calls[0])).toContain("data:image/jpeg;base64,");
    expect(kakeibo.createExpense).not.toHaveBeenCalled();
  });

  it("グループではレシート以外の画像に反応しない", async () => {
    const { assistant } = setup({ responses: [receipt({ isReceipt: false, totalYen: null })] });

    expect(await assistant.handleImage(taro, image)).toEqual([]);
  });

  it("金額が読めなければ金額を尋ねる", async () => {
    const { assistant } = setup({ responses: [receipt({ totalYen: null })] });

    expect((await assistant.handleImage(taro, image))[0]?.text).toContain("金額を送ってください");
  });

  it("読み取りに失敗したら案内する", async () => {
    const { assistant } = setup({ responses: [new Error("504")] });

    expect((await assistant.handleImage(taro, image))[0]?.text).toContain("支出登録");
  });

  it("複数枚は別々の下書きになる", async () => {
    const { assistant } = setup({ responses: [receipt(), receipt({ totalYen: 980 })] });

    const [first] = await assistant.handleImage(taro, image);
    const [second] = await assistant.handleImage(taro, image);

    expect(buttonData(first, "登録")).not.toBe(buttonData(second, "登録"));
  });
});

describe("ExpenseAssistant: メンバーの対応表にない送信者", () => {
  it("許可グループなら使え、支払者をボタンで選んでから登録する", async () => {
    const { assistant, kakeibo } = setup({ responses: [receipt()] });

    const [draft] = await assistant.handleImage(unmapped, image);
    expect(draft?.card?.title).toBe("支払者を選んでください");
    expect(draft?.card?.buttons.map((button) => button.label)).toEqual(["太郎", "花子", "取消"]);

    const [selected] = await assistant.handlePostback(unmapped, buttonData(draft, "花子"));
    expect(rowValue(selected, "支払者")).toBe("花子");

    await assistant.handlePostback(unmapped, buttonData(selected, "登録"));
    expect(kakeibo.createExpense).toHaveBeenCalledWith(expect.objectContaining({ payerMemberId: "member-b" }));
  });

  it("支払者が未定なら「登録」と送っても登録しない", async () => {
    const { assistant, kakeibo } = setup({ responses: [receipt()] });
    await assistant.handleImage(unmapped, image);

    await assistant.handleText(unmapped, "登録");

    expect(kakeibo.createExpense).not.toHaveBeenCalled();
  });

  it("発言に名前がなければ、LLMが推測した支払者を採用しない", async () => {
    const { assistant } = setup({ responses: [proposal({ payer: "太郎" })] });

    expect(rowValue((await assistant.handleText(unmapped, "スーパー3200円"))[0], "支払者")).toBe("未設定");
  });

  it("発言に名前があれば支払者にする", async () => {
    const { assistant } = setup({ responses: [proposal({ payer: "花子" })] });

    expect(rowValue((await assistant.handleText(unmapped, "花子がスーパーで3200円"))[0], "支払者")).toBe("花子");
  });
});

describe("ExpenseAssistant: 権限", () => {
  it("許可されていないグループでは何もしない", async () => {
    const { assistant, completeJson } = setup({ responses: [proposal(), receipt()] });

    expect(await assistant.handleText(strangers, "スーパー3200円")).toEqual([]);
    expect(await assistant.handleImage(strangers, image)).toEqual([]);
    expect(await assistant.handleText(strangers, "サマリー")).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("別のチャットの下書きは承認できない", async () => {
    const { assistant, kakeibo } = setup({ responses: [proposal()] });
    const [draft] = await assistant.handleText(taro, "スーパー3200円");

    expect(await assistant.handlePostback(strangers, buttonData(draft, "登録"))).toEqual([]);
    expect((await assistant.handlePostback(direct, buttonData(draft, "登録")))[0]?.text).toContain("登録済みか");
    expect(kakeibo.createExpense).not.toHaveBeenCalled();
  });

  it("許可されていない1対1では従来どおり断る", async () => {
    const { assistant, completeJson } = setup();
    const other: ChatContext = { chatId: "user-x", chatType: "user", userId: "user-x" };

    expect((await assistant.handleText(other, "スーパー3200円"))[0]?.text).toContain("許可されていません");
    expect((await assistant.handleImage(other, image))[0]?.text).toContain("許可されていません");
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("グループIDとユーザーIDは初期設定のため許可前でも返す", async () => {
    const { assistant } = setup();

    expect((await assistant.handleText(strangers, "グループID"))[0]?.text).toContain("group-other");
    expect((await assistant.handleText(strangers, "ユーザーID"))[0]?.text).toContain("user-taro");
  });

  it("同じイベントは一度だけ処理する", async () => {
    const { assistant, completeJson } = setup({ responses: [proposal(), proposal()] });

    await assistant.handleText(taro, "スーパー3200円", "event-1");
    expect(await assistant.handleText(taro, "スーパー3200円", "event-1")).toEqual([]);
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
});

describe("ExpenseAssistant: 既存機能との共存", () => {
  it("コマンドはLLMを通さない", async () => {
    const { assistant, completeJson } = setup();

    expect((await assistant.handleText(taro, "サマリー"))[0]?.text).toContain("家計簿サマリー");
    expect((await assistant.handleText(taro, "履歴"))[0]?.text).toContain("直近の支出");
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("固定フローの入力中はLLMへ渡さない", async () => {
    const { assistant, kakeibo, completeJson } = setup();

    expect((await assistant.handleText(taro, "支出登録"))[0]?.text).toContain("支出金額");
    expect((await assistant.handleText(taro, "1200"))[0]?.text).toContain("カテゴリ");
    await assistant.handleText(taro, "食費");
    await assistant.handleText(taro, "太郎");
    await assistant.handleText(taro, "コンビニ");
    await assistant.handleText(taro, "登録");

    expect(kakeibo.createExpense).toHaveBeenCalledTimes(1);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("固定フローはグループ内の発言者ごとに分かれる", async () => {
    const { assistant, completeJson } = setup({ responses: [{ action: "none" }] });

    await assistant.handleText(taro, "支出登録");
    await assistant.handleText(unmapped, "今日めっちゃ暑いね");

    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it("AI未設定のグループでは雑談に返信せず、コマンドは使える", async () => {
    const { assistant } = setup({ withoutLlm: true });

    expect(await assistant.handleText(taro, "今日めっちゃ暑いね")).toEqual([]);
    expect(await assistant.handleImage(taro, image)).toEqual([]);
    expect((await assistant.handleText(taro, "支出登録"))[0]?.text).toContain("支出金額");
  });

  it("AI未設定の1対1では従来の案内を返す", async () => {
    const { assistant } = setup({ withoutLlm: true });

    expect((await assistant.handleText(direct, "こんにちは"))[0]?.text).toContain("支出登録");
  });

  it("下書きがなければ「登録」は固定フローを始める", async () => {
    const { assistant } = setup();

    expect((await assistant.handleText(taro, "登録"))[0]?.text).toContain("支出金額");
  });
});
