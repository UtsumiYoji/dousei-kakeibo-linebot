export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user";
  content: string | ChatContentPart[];
};

export interface LlmClient {
  completeJson(messages: ChatMessage[]): Promise<unknown>;
}

export class LlmError extends Error {}

class NonRetryableLlmError extends LlmError {}

type SakuraLlmOptions = {
  token: string;
  baseUrl: string;
  model: string;
  // 返信用トークンの有効期間(約1分)に収まるよう、再試行を含めて1分未満にする。
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
};

export class SakuraLlmClient implements LlmClient {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SakuraLlmOptions) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async completeJson(messages: ChatMessage[]): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      try {
        return await this.requestOnce(messages);
      } catch (error) {
        lastError = error;
        if (error instanceof NonRetryableLlmError) break;
      }
    }
    throw lastError instanceof LlmError ? lastError : new LlmError(`LLMの呼び出しに失敗しました: ${String(lastError)}`);
  }

  private async requestOnce(messages: ChatMessage[]): Promise<unknown> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json"
      },
      // response_format はAPI仕様になく指定しても効かないため、プロンプトでJSONを指示する。
      body: JSON.stringify({ model: this.options.model, temperature: 0, max_tokens: 800, messages }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (response.status === 429 || response.status >= 500) {
      throw new LlmError(`LLM APIが一時的に利用できません。(${response.status})`);
    }
    if (!response.ok) {
      throw new NonRetryableLlmError(`LLM APIの呼び出しに失敗しました。(${response.status})`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    return parseJsonObject(data.choices?.[0]?.message?.content);
  }
}

export function parseJsonObject(content: string | null | undefined): unknown {
  const match = content?.match(/\{[\s\S]*\}/);
  if (!match) throw new LlmError("LLMの応答にJSONが含まれていません。");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new LlmError("LLMの応答をJSONとして解釈できません。");
  }
}
