// Measures how many bytes the demo pulls over HTTP range requests.
//
// Importing this module installs a `fetch` wrapper as a side effect, and it must
// happen before copc.js is evaluated — cross-fetch captures a reference to
// `fetch` at module load. That is why examples/main.ts imports this first and
// then loads the app with a dynamic import.
//
// Deliberately not part of the library: this is a demo instrument, and shipping
// it would turn it into a supported public API on the published package.

/** A reading of one context's counters. */
export interface TransferStats {
  bytes: number;
  requests: number;
  /** Changes when the context restarts (i.e. the browser killed the worker). */
  instanceId: string;
}

const pageStats = { bytes: 0, requests: 0 };
const pageInstanceId = crypto.randomUUID();

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const response = await nativeFetch(...args);
  // Count 206 Partial Content only — that is precisely the range reads. The
  // basemap tiles and the HEAD probe come back 200 and are not part of this.
  if (response.status === 206) {
    pageStats.requests += 1;
    pageStats.bytes += Number(response.headers.get("content-length") ?? 0);
  }
  return response;
};

/**
 * What this page has pulled directly: the header, VLRs and the hierarchy pages
 * `CopcProvider` needs. Tile traffic happens in the Service Worker and is counted
 * there — ask it separately and add the two.
 */
export function getPageTransferStats(): TransferStats {
  return { ...pageStats, instanceId: pageInstanceId };
}

export function resetPageTransferStats(): void {
  pageStats.bytes = 0;
  pageStats.requests = 0;
}

/** Running total that survives the Service Worker being terminated and restarted. */
export interface TransferAccumulator {
  apply(stats: TransferStats): void;
  total(): { bytes: number; requests: number };
  reset(): void;
}

/**
 * Accumulates readings across worker restarts.
 *
 * The browser terminates an idle Service Worker and its counters reset to zero
 * under a fresh `instanceId`. Displaying the raw figure would show a total that
 * collapses at random moments, so each instance's last-seen figures are carried
 * forward as a baseline.
 */
export function createTransferAccumulator(): TransferAccumulator {
  let baseline = { bytes: 0, requests: 0 };
  let current = { instanceId: "", bytes: 0, requests: 0 };
  return {
    apply(stats) {
      if (stats.instanceId !== current.instanceId) {
        baseline = {
          bytes: baseline.bytes + current.bytes,
          requests: baseline.requests + current.requests,
        };
        current = { instanceId: stats.instanceId, bytes: 0, requests: 0 };
      }
      // A push and a poll can race, and each reading is cumulative since the
      // instance started, so never let the figure go backwards.
      current.bytes = Math.max(current.bytes, stats.bytes);
      current.requests = Math.max(current.requests, stats.requests);
    },
    total() {
      return {
        bytes: baseline.bytes + current.bytes,
        requests: baseline.requests + current.requests,
      };
    },
    reset() {
      baseline = { bytes: 0, requests: 0 };
      current = { instanceId: "", bytes: 0, requests: 0 };
    },
  };
}
