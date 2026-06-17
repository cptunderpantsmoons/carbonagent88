/**
 * Retry utility for LLM provider API calls.
 *
 * Retries on rate-limit (429) and 5xx errors with exponential backoff.
 * Does not retry on 4xx errors (except 429).
 * Includes a 60s timeout via AbortController.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s
const TIMEOUT_MS = 60_000;

export interface RetryableError {
  status?: number;
  message: string;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    // Check for rate limit or 5xx status codes
    const status = (err as RetryableError & { status?: number }).status;
    if (status === 429) return true;
    if (status !== undefined && status >= 500 && status < 600) return true;
    // Also check for common network errors that should be retried
    const msg = err.message.toLowerCase();
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("socket hang up")) return true;
    if (msg.includes("fetch failed") || msg.includes("network error")) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic and timeout.
 * @param fn The async function to execute (receives an AbortSignal).
 * @returns The result of fn.
 * @throws The last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = err;

      // If this was the last attempt, or the error is not retryable, throw
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryable(err)) {
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[LLM] Retrying after ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`);
      await sleep(delay);
    }
  }

  throw lastError;
}