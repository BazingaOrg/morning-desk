import { readResponseTextLimited } from "../facts/http";

export class DeepSeekConfigError extends Error {
  constructor(message = "DEEPSEEK_API_KEY unset") {
    super(message);
    this.name = "DeepSeekConfigError";
  }
}

export class DeepSeekHttpError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "DeepSeekHttpError";
    this.status = status;
  }
}

export type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export type DeepSeekChatResult = {
  text: string;
  model: string;
  usage?: DeepSeekUsage;
};

function resolveConfig(): { base: string; model: string; key: string } {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new DeepSeekConfigError();
  }
  return {
    base: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    key,
  };
}

export async function deepseekChat(input: {
  system: string;
  user: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<DeepSeekChatResult> {
  const { base, model, key } = resolveConfig();
  const timeoutMs = input.timeoutMs ?? 45000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await (input.fetcher ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      signal: ac.signal,
      cache: "no-store",
    });

    const textBody = await readResponseTextLimited(res);
    if (res.status === 429 || res.status >= 500 || !res.ok) {
      throw new DeepSeekHttpError(
        `DeepSeek HTTP ${res.status}`,
        res.status,
      );
    }

    let payload: {
      choices?: Array<{ message?: { content?: string | null } }>;
      model?: string;
      usage?: DeepSeekUsage;
    };
    try {
      payload = JSON.parse(textBody) as typeof payload;
    } catch {
      throw new DeepSeekHttpError("DeepSeek empty or invalid response body", res.status);
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new DeepSeekHttpError("DeepSeek empty content", res.status);
    }

    return {
      text,
      model: payload.model || model,
      usage: payload.usage
        ? {
            prompt_tokens: payload.usage.prompt_tokens,
            completion_tokens: payload.usage.completion_tokens,
          }
        : undefined,
    };
  } catch (err) {
    if (err instanceof DeepSeekConfigError || err instanceof DeepSeekHttpError) {
      throw err;
    }
    throw new DeepSeekHttpError(
      err instanceof Error ? err.message : "DeepSeek request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}
