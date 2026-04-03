import { request } from './client'

// --- Push Notifications ---

export async function subscribePush(data: {
  endpoint: string
  keys: { p256dh: string; auth: string }
  deviceLabel?: string
}) {
  return request<{ ok: true }>('/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function unsubscribePush(endpoint: string) {
  return request<{ ok: true }>('/notifications/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
}
