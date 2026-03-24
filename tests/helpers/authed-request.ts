/**
 * Headless authenticated request helper for API integration tests.
 *
 * Replaces the page.evaluate(apiCall) pattern by generating Schnorr auth
 * tokens directly in Node/Bun, without needing a browser context.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { getPublicKey, nip19 } from 'nostr-tools'
import { createAuthToken } from '../../src/client/lib/crypto'

interface RequestOpts {
  headers?: Record<string, string>
}

export interface AuthedRequest {
  get(path: string, opts?: RequestOpts): Promise<APIResponse>
  post(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  put(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  patch(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  delete(path: string, opts?: RequestOpts): Promise<APIResponse>
  /** The hex public key derived from the secret key */
  pubkey: string
}

/**
 * Create an authenticated request wrapper around Playwright's APIRequestContext.
 *
 * @param request - Playwright's request fixture
 * @param secretKey - Nostr secret key as Uint8Array (32 bytes)
 * @returns AuthedRequest with methods that auto-sign each request
 */
export function createAuthedRequest(
  request: APIRequestContext,
  secretKey: Uint8Array,
): AuthedRequest {
  const pubkey = getPublicKey(secretKey)

  function authHeaders(method: string, path: string, extra?: Record<string, string>): Record<string, string> {
    const token = createAuthToken(secretKey, Date.now(), method, path)
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  return {
    pubkey,
    get(path, opts?) {
      return request.get(path, { headers: authHeaders('GET', path, opts?.headers) })
    },
    post(path, data?, opts?) {
      return request.post(path, {
        headers: authHeaders('POST', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    put(path, data?, opts?) {
      return request.put(path, {
        headers: authHeaders('PUT', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    patch(path, data?, opts?) {
      return request.patch(path, {
        headers: authHeaders('PATCH', path, opts?.headers),
        ...(data !== undefined ? { data } : {}),
      })
    },
    delete(path, opts?) {
      return request.delete(path, { headers: authHeaders('DELETE', path, opts?.headers) })
    },
  }
}

/**
 * Create an AuthedRequest from an nsec string.
 * Convenience wrapper for tests that have an nsec rather than raw bytes.
 */
export function createAuthedRequestFromNsec(
  request: APIRequestContext,
  nsec: string,
): AuthedRequest {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error(`Expected nsec, got ${decoded.type}`)
  return createAuthedRequest(request, decoded.data)
}
