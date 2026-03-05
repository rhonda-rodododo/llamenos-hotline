# Epic 258: Worker Critical & High Security Fixes

## Summary
Fix 7 critical/high Worker vulnerabilities from Audit Round 8: public exposure of server event key (C2), DEMO_MODE in production (C3), webhook signature bypass (C7), caller-controlled rate limits (H15), Vonage replay bypass (H16), admin pubkey exposure (H17), and bootstrap admin race (H18).

## Context
- **Audit Round**: 8 (March 2026)
- **Severity**: 3 Critical, 4 High
- The server event encryption key is returned in the unauthenticated `/api/config` endpoint, defeating relay event encryption
- `DEMO_MODE=true` in production wrangler.jsonc causes all 7 DOs to reset every 4 hours including the audit log
- Webhook validation can be bypassed via controllable Host header

## Implementation

### C2: Move serverEventKeyHex Behind Authentication

**`apps/worker/routes/config.ts`** — remove `serverEventKeyHex` from public config:
```typescript
// GET /api/config (public) — REMOVE serverEventKeyHex
return c.json({
  hubName: settings.hubName,
  setupCompleted: settings.setupCompleted,
  demoMode: settings.demoMode,
  nostrRelayUrl: settings.nostrRelayUrl,
})
```

**`apps/worker/routes/auth.ts`** — add to authenticated endpoint:
```typescript
// GET /api/auth/me (authenticated)
const serverEventKeyHex = c.env.SERVER_NOSTR_SECRET
  ? bytesToHex(deriveServerEventKey(c.env.SERVER_NOSTR_SECRET))
  : undefined

return c.json({
  pubkey: user.pubkey,
  roles: user.roles,
  permissions: user.permissions,
  serverEventKeyHex,
  adminDecryptionPubkey: c.env.ADMIN_DECRYPTION_PUBKEY || c.env.ADMIN_PUBKEY,
})
```

Update all clients (desktop, iOS, Android) to read `serverEventKeyHex` from the auth response instead of config.

### C3: Fix DEMO_MODE in Production Config

**`apps/worker/wrangler.jsonc`**:
```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "DEMO_MODE": "false"    // was "true" — demo only in named env
}
```

Gate the `/reset` endpoint on DEMO_MODE within ALL 7 DOs (IdentityDO, SettingsDO, RecordsDO, ShiftManagerDO, CallRouterDO, ConversationDO, BlastDO):
```typescript
// Add to each DO's reset handler:
private async resetAllData(): Promise<Response> {
  if (this.env.DEMO_MODE !== 'true') {
    return new Response('Reset not allowed outside demo mode', { status: 403 })
  }
  await this.ctx.storage.deleteAll()
  return new Response('OK')
}
```

Verify all 7 DOs have this guard. If any DO lacks a reset handler, that's fine — only gate existing ones.

### C7: Remove Hostname Bypass in Webhook Validation

**`apps/worker/routes/telephony.ts`**:
```typescript
// BEFORE (vulnerable):
const isLocal = isDev && (c.req.header('CF-Connecting-IP') === '127.0.0.1' || url.hostname === 'localhost')

// AFTER (fixed):
const isLocal = isDev && c.req.header('CF-Connecting-IP') === '127.0.0.1'
```

### H15: Validate Rate Limit Parameters

**`apps/worker/durable-objects/settings-do.ts`**:
```typescript
private async checkRateLimit(data: { key: string; maxPerMinute: number }): Promise<Response> {
  if (!data.key || !/^[a-zA-Z0-9:_-]{1,256}$/.test(data.key)) {
    return Response.json({ error: 'Invalid rate limit key' }, { status: 400 })
  }
  if (!Number.isInteger(data.maxPerMinute) || data.maxPerMinute < 1 || data.maxPerMinute > 1000) {
    return Response.json({ error: 'maxPerMinute must be 1-1000' }, { status: 400 })
  }
  // ... existing logic
}
```

### H16: Fix Vonage Replay Protection

**`apps/worker/telephony/vonage.ts`** — move timestamp check outside the `if (!sig)` branch:
```typescript
async validateWebhook(request: Request): Promise<boolean> {
  const url = new URL(request.url)
  // Timestamp check applies unconditionally
  const timestamp = url.searchParams.get('timestamp')
  if (!timestamp) return false
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const sig = url.searchParams.get('sig')
  if (!sig) return false
  // HMAC verification...
}
```

### H17: Reduce Admin Pubkey Exposure

**`apps/worker/routes/auth.ts`** — remove `adminPubkey` signing key:
```typescript
return c.json({
  pubkey: user.pubkey,
  roles: user.roles,
  permissions: user.permissions,
  serverEventKeyHex,
  adminDecryptionPubkey: c.env.ADMIN_DECRYPTION_PUBKEY || c.env.ADMIN_PUBKEY,
  // REMOVED: adminPubkey (signing key identity) — only decryption pubkey needed
})
```

### H18: Fix Bootstrap Admin Race Condition

**`apps/worker/durable-objects/identity-do.ts`**:
```typescript
private async bootstrapAdmin(data: { pubkey: string; signature: string }): Promise<Response> {
  const result = await this.ctx.storage.transaction(async (txn) => {
    const volunteers = await txn.get<Record<string, Volunteer>>('volunteers') || {}
    const adminExists = Object.values(volunteers).some(v =>
      v.active && v.roles.includes('role-super-admin'))
    if (adminExists) {
      return { error: 'Admin already exists', status: 403 }
    }
    const volunteer: Volunteer = {
      pubkey: data.pubkey,
      roles: ['role-super-admin'],
      active: true,
      createdAt: Date.now(),
    }
    volunteers[data.pubkey] = volunteer
    await txn.put('volunteers', volunteers)
    return { volunteer, status: 200 }
  })

  if ('error' in result) {
    return Response.json({ error: result.error }, { status: result.status })
  }
  return Response.json(result.volunteer)
}
```

## Tests

### Worker Integration Tests
- Test `/api/config` does NOT return `serverEventKeyHex`
- Test `/api/auth/me` DOES return `serverEventKeyHex` for authenticated users
- Test DO reset returns 403 when DEMO_MODE is false
- Test webhook validation rejects requests with `Host: localhost` in production
- Test rate limit rejects `maxPerMinute: 0` and `maxPerMinute: 99999`
- Test Vonage webhook rejects request with valid sig but stale timestamp
- Test bootstrap admin rejects second registration attempt

### Desktop E2E Updates
- Update any test that reads `serverEventKeyHex` from config to read from auth response
- Verify demo mode data seeding does not occur in non-demo tests

### iOS/Android Updates
- Update config parsing to not expect `serverEventKeyHex` in public config
- Read from authenticated `/api/auth/me` response instead

## Files to Modify
| File | Action |
|------|--------|
| `apps/worker/routes/config.ts` | Remove serverEventKeyHex |
| `apps/worker/routes/auth.ts` | Add serverEventKeyHex, remove adminPubkey |
| `apps/worker/wrangler.jsonc` | Set DEMO_MODE=false in production vars |
| `apps/worker/routes/telephony.ts` | Remove hostname bypass |
| `apps/worker/durable-objects/settings-do.ts` | Validate rate limit params |
| `apps/worker/telephony/vonage.ts` | Fix timestamp validation order |
| `apps/worker/durable-objects/identity-do.ts` | Add storage transaction to bootstrap |
| `apps/worker/durable-objects/records-do.ts` | Gate reset on DEMO_MODE |
| `src/client/lib/api.ts` | Read serverEventKeyHex from auth response |
| `apps/ios/Sources/Services/APIService.swift` | Update config parsing |
| `apps/android/.../ApiService.kt` | Update config parsing |

## Dependencies
- Client-side changes needed on all platforms to read serverEventKeyHex from auth instead of config
- DEMO_MODE change must be coordinated with demo deployment (use named `demo` env)
