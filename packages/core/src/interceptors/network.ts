import http from 'node:http';
import https from 'node:https';
import type { LlmEvent, ApiEvent } from '../types.js';
import { Logger } from '../logger.js';

const logger = new Logger('interceptor:network');

// Known LLM API endpoints (by hostname or host:port)
const LLM_ENDPOINTS: Record<string, { provider: string; tokenExtractor: (body: unknown) => TokenInfo }> = {
  'api.anthropic.com': {
    provider: 'anthropic',
    tokenExtractor: extractAnthropicTokens,
  },
  'api.openai.com': {
    provider: 'openai',
    tokenExtractor: extractOpenAITokens,
  },
  'api.deepseek.com': {
    provider: 'deepseek',
    tokenExtractor: extractOpenAITokens,
  },
  'api.mistral.ai': {
    provider: 'mistral',
    tokenExtractor: extractOpenAITokens,
  },
  'generativelanguage.googleapis.com': {
    provider: 'google',
    tokenExtractor: extractGoogleTokens,
  },
  'localhost:11434': {
    provider: 'ollama',
    tokenExtractor: extractOllamaTokens,
  },
  '127.0.0.1:11434': {
    provider: 'ollama',
    tokenExtractor: extractOllamaTokens,
  },
};

// Path + header based detection for proxied/custom-port LLM calls
interface PathDetection {
  provider: string;
  tokenExtractor: (body: unknown) => TokenInfo;
}

const PATH_SIGNATURES: Record<string, { headerCheck?: (headers: Record<string, string | string[] | undefined>) => boolean } & PathDetection> = {
  '/v1/messages': {
    provider: 'anthropic',
    tokenExtractor: extractAnthropicTokens,
    headerCheck: (h) => h['anthropic-version'] != null || h['x-api-key'] != null,
  },
  '/v1/chat/completions': {
    provider: 'openai',
    tokenExtractor: extractOpenAITokens,
  },
  '/api/generate': {
    provider: 'ollama',
    tokenExtractor: extractOllamaTokens,
  },
  '/api/chat': {
    provider: 'ollama',
    tokenExtractor: extractOllamaTokens,
  },
};

// Cost per 1M tokens in USD — updated 2026-03
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Anthropic Claude
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'o3': { input: 2, output: 8 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'o1': { input: 15, output: 60 },
  // DeepSeek
  'deepseek-chat': { input: 0.28, output: 0.42 },
  'deepseek-reasoner': { input: 0.28, output: 0.42 },
  // Mistral
  'mistral-large-latest': { input: 0.5, output: 1.5 },
  'mistral-medium-latest': { input: 0.4, output: 2 },
  'mistral-small-latest': { input: 0.1, output: 0.3 },
  'codestral-latest': { input: 0.3, output: 0.9 },
  'devstral-latest': { input: 0.4, output: 2 },
  // Google Gemini
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Ollama (local, free)
  'llama4': { input: 0, output: 0 },
  'llama3.2': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
  'deepseek-coder': { input: 0, output: 0 },
};

interface TokenInfo {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function extractAnthropicTokens(body: unknown): TokenInfo {
  const b = body as Record<string, unknown>;
  const usage = b.usage as Record<string, number> | undefined;
  return {
    model: (b.model as string) || 'unknown',
    promptTokens: usage?.input_tokens ?? 0,
    completionTokens: usage?.output_tokens ?? 0,
    totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
  };
}

function extractOpenAITokens(body: unknown): TokenInfo {
  const b = body as Record<string, unknown>;
  const usage = b.usage as Record<string, number> | undefined;
  return {
    model: (b.model as string) || 'unknown',
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function extractGoogleTokens(body: unknown): TokenInfo {
  const b = body as Record<string, unknown>;
  const usage = b.usageMetadata as Record<string, number> | undefined;
  return {
    model: (b.modelVersion as string) || 'gemini',
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
  };
}

function extractOllamaTokens(body: unknown): TokenInfo {
  const b = body as Record<string, unknown>;
  return {
    model: (b.model as string) || 'unknown',
    promptTokens: (b.prompt_eval_count as number) ?? 0,
    completionTokens: (b.eval_count as number) ?? 0,
    totalTokens: ((b.prompt_eval_count as number) ?? 0) + ((b.eval_count as number) ?? 0),
  };
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Try exact match, then prefix match
  const costs = COST_TABLE[model] ?? Object.entries(COST_TABLE).find(([k]) => model.startsWith(k))?.[1];
  if (!costs) return 0;
  return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

function truncate(text: string, max: number = 2048): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `... [truncated]`;
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    // Strip auth headers
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'api-key') {
      result[key] = '[REDACTED]';
    } else if (value != null) {
      result[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return result;
}

export type LlmCallback = (event: LlmEvent) => void;
export type ApiCallback = (event: ApiEvent) => void;

export interface NetworkInterceptor {
  install(): void;
  uninstall(): void;
}

export function createNetworkInterceptor(
  onLlmEvent: LlmCallback,
  onApiEvent: ApiCallback,
  options?: { capturePrompts?: boolean },
): NetworkInterceptor {
  const capturePrompts = options?.capturePrompts ?? false;

  // Save originals
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  function patchRequest(
    originalFn: typeof http.request,
    protocol: string,
  ): typeof http.request {
    return function patchedRequest(
      this: unknown,
      ...args: Parameters<typeof http.request>
    ): http.ClientRequest {
      const req = originalFn.apply(this, args) as http.ClientRequest;

      // Extract URL info from the request
      const urlInfo = extractUrlInfo(args, protocol);
      if (!urlInfo) return req;

      const { hostname, path, method } = urlInfo;
      const hostPort = urlInfo.port ? `${hostname}:${urlInfo.port}` : hostname;
      const startTime = Date.now();

      // Capture request body
      let requestBody = '';
      const originalWrite = req.write.bind(req);
      const originalEnd = req.end.bind(req);

      req.write = function (chunk: unknown, ...rest: unknown[]): boolean {
        if (chunk) {
          requestBody += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString();
        }
        return (originalWrite as Function)(chunk, ...rest);
      } as typeof req.write;

      req.end = function (chunk: unknown, ...rest: unknown[]): http.ClientRequest {
        if (chunk && typeof chunk !== 'function') {
          requestBody += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString();
        }
        return (originalEnd as Function)(chunk, ...rest);
      } as typeof req.end;

      // Capture request headers for path-based detection
      const reqHeaders = req.getHeaders() as Record<string, string | string[] | undefined>;

      // Capture response
      req.on('response', (res: http.IncomingMessage) => {
        let responseBody = '';

        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });

        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          const fullUrl = `${protocol}//${hostPort}${path}`;

          // Check if this is a known LLM endpoint (hostname match first, then path+header fallback)
          let llmConfig = LLM_ENDPOINTS[hostPort] || LLM_ENDPOINTS[hostname];

          if (!llmConfig) {
            // Path-based detection: match by API path and optional header check
            const pathSig = PATH_SIGNATURES[path] || PATH_SIGNATURES[path.split('?')[0]];
            if (pathSig && (!pathSig.headerCheck || pathSig.headerCheck(reqHeaders))) {
              llmConfig = { provider: pathSig.provider, tokenExtractor: pathSig.tokenExtractor };
            }
          }

          if (llmConfig && res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const responseJson = JSON.parse(responseBody);
              const tokens = llmConfig.tokenExtractor(responseJson);
              const costUsd = estimateCost(tokens.model, tokens.promptTokens, tokens.completionTokens);

              const llmEvent: LlmEvent = {
                provider: llmConfig.provider,
                model: tokens.model,
                promptTokens: tokens.promptTokens,
                completionTokens: tokens.completionTokens,
                totalTokens: tokens.totalTokens,
                costUsd,
                latencyMs,
              };

              // Optionally capture prompt/response content
              if (capturePrompts) {
                try {
                  const reqJson = JSON.parse(requestBody);
                  llmEvent.prompt = truncate(extractPromptText(llmConfig.provider, reqJson));
                  llmEvent.response = truncate(extractResponseText(llmConfig.provider, responseJson));
                  llmEvent.toolCalls = extractToolCalls(llmConfig.provider, responseJson);
                } catch {
                  // Ignore parse errors for content
                }
              }

              logger.info(
                `LLM call: ${llmConfig.provider}/${tokens.model} ` +
                `${tokens.totalTokens} tokens $${costUsd.toFixed(4)} ${latencyMs}ms`,
              );
              onLlmEvent(llmEvent);
            } catch {
              // Not valid JSON LLM response, treat as generic API call
              emitApiEvent();
            }
          } else {
            emitApiEvent();
          }

          function emitApiEvent() {
            // Only emit for external calls, skip localhost non-LLM
            if (hostname === 'localhost' || hostname === '127.0.0.1') return;

            const apiEvent: ApiEvent = {
              url: fullUrl,
              method: method || 'GET',
              statusCode: res.statusCode,
              requestHeaders: sanitizeHeaders(req.getHeaders() as Record<string, string | string[] | undefined>),
              responseSizeBytes: responseBody.length,
              latencyMs,
            };

            logger.debug(`API call: ${apiEvent.method} ${apiEvent.url} ${apiEvent.statusCode}`);
            onApiEvent(apiEvent);
          }
        });
      });

      return req;
    } as typeof http.request;
  }

  return {
    install() {
      (http as unknown as Record<string, unknown>).request = patchRequest(originalHttpRequest, 'http:');
      (https as unknown as Record<string, unknown>).request = patchRequest(originalHttpsRequest, 'https:');
      logger.info('Network interceptor installed');
    },

    uninstall() {
      (http as unknown as Record<string, unknown>).request = originalHttpRequest;
      (https as unknown as Record<string, unknown>).request = originalHttpsRequest;
      logger.debug('Network interceptor uninstalled');
    },
  };
}

// Helpers to extract URL info from various request signatures
function extractUrlInfo(
  args: unknown[],
  protocol: string,
): { hostname: string; port?: string; path: string; method?: string } | null {
  const first = args[0];

  if (typeof first === 'string') {
    try {
      const url = new URL(first);
      return { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET' };
    } catch {
      return null;
    }
  }

  if (first instanceof URL) {
    return { hostname: first.hostname, port: first.port, path: first.pathname + first.search, method: 'GET' };
  }

  if (first && typeof first === 'object') {
    const opts = first as Record<string, unknown>;
    const hostname = (opts.hostname || opts.host || 'unknown') as string;
    const port = opts.port ? String(opts.port) : undefined;
    const path = (opts.path || '/') as string;
    const method = (opts.method || 'GET') as string;
    return { hostname: hostname.split(':')[0], port: port || hostname.split(':')[1], path, method };
  }

  return null;
}

function extractPromptText(provider: string, reqBody: Record<string, unknown>): string {
  if (provider === 'anthropic') {
    const messages = reqBody.messages as Array<{ role: string; content: unknown }> | undefined;
    if (!messages) return '';
    const last = messages[messages.length - 1];
    return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  }

  if (provider === 'openai') {
    const messages = reqBody.messages as Array<{ role: string; content: string }> | undefined;
    if (!messages) return '';
    const last = messages[messages.length - 1];
    return last.content;
  }

  if (provider === 'ollama') {
    return (reqBody.prompt as string) || '';
  }

  return '';
}

function extractResponseText(provider: string, resBody: Record<string, unknown>): string {
  if (provider === 'anthropic') {
    const content = resBody.content as Array<{ type: string; text?: string }> | undefined;
    if (!content) return '';
    return content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  if (provider === 'openai') {
    const choices = resBody.choices as Array<{ message: { content: string } }> | undefined;
    if (!choices?.[0]) return '';
    return choices[0].message.content;
  }

  if (provider === 'ollama') {
    return (resBody.response as string) || '';
  }

  return '';
}

function extractToolCalls(provider: string, resBody: Record<string, unknown>): string[] | undefined {
  if (provider === 'anthropic') {
    const content = resBody.content as Array<{ type: string; name?: string }> | undefined;
    if (!content) return undefined;
    const tools = content.filter((c) => c.type === 'tool_use').map((c) => c.name!);
    return tools.length > 0 ? tools : undefined;
  }

  if (provider === 'openai') {
    const choices = resBody.choices as Array<{ message: { tool_calls?: Array<{ function: { name: string } }> } }> | undefined;
    const tools = choices?.[0]?.message?.tool_calls?.map((t) => t.function.name);
    return tools && tools.length > 0 ? tools : undefined;
  }

  return undefined;
}
