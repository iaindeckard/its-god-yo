import "server-only";

export interface OpenAIResponse {
  id?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  usage?: {
    input_tokens?: number; output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

export async function createOpenAIResponse(body: Record<string, unknown>): Promise<OpenAIResponse> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("openai_unavailable: OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`openai_api_${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json() as Promise<OpenAIResponse>;
}

export function responseText(response: OpenAIResponse): string {
  if (response.output_text) return response.output_text;
  return (response.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n");
}
