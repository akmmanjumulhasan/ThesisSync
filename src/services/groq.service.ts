import "server-only";

/**
 * Module 3 (Member 2): the Groq client behind the AI Mock Defense Simulator.
 *
 * Groq serves an OpenAI-compatible API, so this is a plain fetch against
 * /chat/completions rather than a vendor SDK. That keeps the dependency list
 * where it is, and — more usefully — leaves the streaming path under this
 * project's own control, which matters because the model in use emits its
 * private reasoning on the same stream as its answer.
 *
 * The key lives in GROQ_API_KEY. Nothing here reads from anywhere else, so the
 * prototype folder this was derived from can be deleted without effect.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * A 131k-context reasoning model, which matters: a full thesis plus the
 * examiner's instructions is a large prompt, and the questions have to be
 * reasoned from the text rather than pattern-matched off the title.
 *
 * Note that llama-3.3-70b-versatile — the model this project's prototype used —
 * has been retired from Groq and 404s.
 */
export const DEFENSE_MODEL = "openai/gpt-oss-120b";

export class GroqError extends Error {}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  /** Forces a JSON object back, used for the analysis and question passes. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Reasoning budget. "low" keeps an interactive reply prompt-fast. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

function apiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new GroqError("GROQ_API_KEY is not set. Add it to your .env file.");
  }
  return key;
}

function body(options: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: DEFENSE_MODEL,
    messages: options.messages,
    stream,
    temperature: options.temperature ?? 0.4,
    max_completion_tokens: options.maxTokens ?? 4096,
    reasoning_effort: options.effort ?? "medium",
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
  });
}

async function failure(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);
  try {
    detail = JSON.parse(text)?.error?.message ?? detail;
  } catch {
    // Not JSON; the raw body is the best description available.
  }

  // A 429 here is a per-minute token allowance, not a broken request, and the
  // wording of the upstream message ("Limit 8000, Used 6565...") means nothing
  // to a student. Say what actually happened and when to try again.
  if (res.status === 429) {
    const wait = Math.ceil(retryDelaySeconds(res, detail));
    throw new GroqError(
      `The examiner is over its per-minute quota. Wait about ${wait} second${wait === 1 ? "" : "s"} and try again.`
    );
  }

  throw new GroqError(`Groq request failed (${res.status}): ${detail}`);
}

/** How long the API says to wait, from the header or from its own message. */
function retryDelaySeconds(res: Response, message: string): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;

  const stated = /try again in ([\d.]+)s/i.exec(message);
  if (stated) return Number(stated[1]);

  return 30;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Issues the request, waiting once if the minute's allowance is exhausted.
 *
 * The free tier's window is short, so a single well-timed wait usually turns a
 * failure into a success. Retrying more than once would leave a student staring
 * at a spinner for minutes, which is worse than an honest error.
 */
async function send(payload: string, signal: AbortSignal | undefined, retryOn429: boolean) {
  const request = () =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: payload,
      signal,
    });

  let res = await request();

  if (res.status === 429 && retryOn429) {
    const detail = await res.clone().text().catch(() => "");
    const wait = Math.min(retryDelaySeconds(res, detail), 60);
    await sleep(wait * 1000 + 500);
    res = await request();
  }

  return res;
}

export class GroqService {
  /** One completion, returned whole. Used where the reply must be parsed before it is useful. */
  static async complete(options: ChatOptions): Promise<string> {
    // Preparing a defence is a one-off the student is already waiting on, so a
    // single retry is worth far more than an immediate failure.
    const res = await send(body(options, false), options.signal, true);

    if (!res.ok) await failure(res);

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new GroqError("Groq returned an empty response.");
    }
    return content;
  }

  /** Same, but the reply is expected to be a JSON object. */
  static async completeJson<T>(options: ChatOptions): Promise<T> {
    const raw = await GroqService.complete({ ...options, json: true });
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new GroqError("Groq returned malformed JSON.");
    }
  }

  /**
   * A completion, yielded as it arrives.
   *
   * Only `delta.content` is emitted. The model also streams `delta.reasoning`
   * — its private working-out — on the same events, and forwarding that would
   * show a student the examiner's thinking before its question, which is both
   * confusing and a spoiler.
   */
  static async *stream(options: ChatOptions): AsyncGenerator<string> {
    // No retry here: the student is mid-conversation, and a silent 30-second
    // pause before the examiner speaks reads as the feature having hung.
    const res = await send(body(options, true), options.signal, false);

    if (!res.ok) await failure(res);
    if (!res.body) throw new GroqError("Groq returned no stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Server-sent events are separated by a blank line, but a chunk can split
      // one mid-event, so only whole lines are consumed and the tail is kept.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content) {
            yield delta.content;
          }
        } catch {
          // A malformed event is not worth aborting a live answer over.
        }
      }
    }
  }
}
