/**
 * Shared HTTP utility with automatic rate-limit backoff (HTTP 429 / 503), jitter, and concurrency throttling.
 */

const DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
};

/**
 * Performs a fetch request with automatic retries on HTTP 429 (Too Many Requests)
 * and HTTP 503 (Service Unavailable) using exponential backoff with jitter and Retry-After header support.
 *
 * @param {string} url The URL to fetch.
 * @param {object} [options={}] Fetch options.
 * @param {number} [maxRetries=2] Maximum number of retries for 429/503/transient errors.
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
    const timeoutMs = options.timeoutMs || 8000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const fetchOptions = {
            ...options,
            headers: {
                ...DEFAULT_HEADERS,
                ...(options.headers || {})
            },
            signal: options.signal || controller.signal
        };

        try {
            const res = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);

            if (res.status === 429 || res.status === 503) {
                if (attempt === maxRetries) {
                    console.warn(`[WARN] 429/503 persists after ${maxRetries} retries for URL: ${url}`);
                    return res;
                }

                // Check for Retry-After header
                const retryAfterHeader = res.headers.get("retry-after");
                let delayMs = 0;
                if (retryAfterHeader) {
                    const parsedSeconds = parseInt(retryAfterHeader, 10);
                    if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
                        delayMs = Math.min(4000, parsedSeconds * 1000);
                    }
                }

                // Rate limit cooldown backoff: minimum 3.5s so Archidekt sliding window clears
                if (!delayMs || delayMs <= 0) {
                    const baseBackoff = 3500 * (attempt + 1);
                    const jitter = Math.floor(Math.random() * 500);
                    delayMs = Math.min(9000, baseBackoff + jitter);
                }

                console.warn(`[RATE LIMIT 429] Received 429 for ${url}. Backing off ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            return res;
        } catch (err) {
            clearTimeout(timeoutId);
            const isTimeout = err.name === "AbortError" || err.name === "TimeoutError";
            if (attempt === maxRetries) {
                throw err;
            }

            const backoff = 600 * (attempt + 1) + Math.floor(Math.random() * 200);
            console.warn(`[HTTP ERROR] ${isTimeout ? "Timeout" : err.message} for ${url}. Retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
        }
    }
}

/**
 * Runs an array of async task functions with bounded concurrency and optional spacing delay.
 *
 * @template T
 * @param {Array<() => Promise<T>>} taskFns Array of factory functions returning promises.
 * @param {number} [concurrency=1] Maximum number of tasks running in parallel.
 * @param {number} [delayBetweenTasksMs=350] Delay in milliseconds before launching the next task batch.
 * @returns {Promise<Array<T>>}
 */
async function runWithConcurrency(taskFns, concurrency = 1, delayBetweenTasksMs = 350) {
    const results = [];
    for (let i = 0; i < taskFns.length; i += concurrency) {
        const chunk = taskFns.slice(i, i + concurrency);
        const chunkResults = await Promise.all(chunk.map(fn => fn()));
        results.push(...chunkResults);
        if (i + concurrency < taskFns.length && delayBetweenTasksMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenTasksMs));
        }
    }
    return results;
}

module.exports = {
    DEFAULT_HEADERS,
    fetchWithRetry,
    runWithConcurrency
};
