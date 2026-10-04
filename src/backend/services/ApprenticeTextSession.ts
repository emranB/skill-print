import { getElevenLabsAgentId, getElevenLabsApiKey } from "./ElevenLabsServer.js";

const API = "https://api.elevenlabs.io/v1/convai";

export class ApprenticeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprenticeUnavailableError";
  }
}

/** Short-lived signed WebSocket URL for the configured agent. The API key never leaves the server. */
export async function getSignedConversationUrl(): Promise<string> {
  const apiKey = getElevenLabsApiKey();
  const agentId = getElevenLabsAgentId();
  if (!apiKey || !agentId) throw new ApprenticeUnavailableError("ELEVENLABS_NOT_CONFIGURED");
  const response = await fetch(
    `${API}/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!response.ok) {
    throw new ApprenticeUnavailableError(`Signed URL request failed with status ${response.status}`);
  }
  const json = (await response.json()) as { signed_url?: string };
  if (!json.signed_url) throw new ApprenticeUnavailableError("Signed URL missing from response");
  return json.signed_url;
}

interface IncomingEvent {
  type?: string;
  ping_event?: { event_id?: number };
  agent_response_event?: { agent_response?: string };
}

/**
 * Run one text-only conversation with the existing apprentice agent and
 * return one agent reply per user message, in order.
 *
 * The agent greets first; that greeting is consumed before the first message.
 */
export async function runApprenticeTextTurns(
  messages: string[],
  options: { turnTimeoutMs?: number } = {},
): Promise<string[]> {
  if (typeof WebSocket === "undefined") {
    throw new ApprenticeUnavailableError("WebSocket is not available in this Node runtime");
  }
  const turnTimeoutMs = options.turnTimeoutMs ?? 20_000;
  const url = await getSignedConversationUrl();

  return new Promise<string[]>((resolve, reject) => {
    const replies: string[] = [];
    const ws = new WebSocket(url);
    let next = 0;
    let greeted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // socket already closed
      }
      if (error) reject(error);
      else resolve(replies);
    };

    const arm = (ms: number, label: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(new ApprenticeUnavailableError(`Apprentice ${label} timed out`)), ms);
    };

    const sendNext = () => {
      if (next >= messages.length) {
        finish();
        return;
      }
      ws.send(JSON.stringify({ type: "user_message", text: messages[next] }));
      next += 1;
      arm(turnTimeoutMs, "reply");
    };

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "conversation_initiation_client_data",
          conversation_config_override: { conversation: { text_only: true } },
        }),
      );
      arm(10_000, "session start");
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: IncomingEvent;
      try {
        msg = JSON.parse(String(event.data)) as IncomingEvent;
      } catch {
        return;
      }
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", event_id: msg.ping_event?.event_id }));
        return;
      }
      if (msg.type === "conversation_initiation_metadata") {
        // Give the greeting a moment; send anyway if the agent has none.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!greeted) {
            greeted = true;
            sendNext();
          }
        }, 1500);
        return;
      }
      if (msg.type === "agent_response") {
        const text = msg.agent_response_event?.agent_response ?? "";
        if (!greeted) {
          greeted = true;
          sendNext();
          return;
        }
        replies.push(text);
        sendNext();
      }
    });

    ws.addEventListener("error", () => finish(new ApprenticeUnavailableError("Apprentice socket error")));
    ws.addEventListener("close", () => {
      if (!settled) {
        if (replies.length === messages.length) finish();
        else finish(new ApprenticeUnavailableError("Apprentice session closed early"));
      }
    });
  });
}

/** Pull the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJsonObject(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in apprentice reply");
  return JSON.parse(reply.slice(start, end + 1));
}
