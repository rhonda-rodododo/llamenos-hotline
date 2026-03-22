# Volunteer PII Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and enforce that volunteer phone numbers and real names are only visible to admins, never to other volunteers. Add tests to prevent regression.

**Risk:** Current code stores `phone` and `name` on the Volunteer type, but it is unconfirmed whether the list/detail API endpoints filter these fields based on the requesting user's role.

---

## Phase 1: Audit Current API Behaviour

- [ ] Read `src/worker/routes/volunteers.ts`
- [ ] For each endpoint, document what fields are returned:
  - `GET /api/volunteers` — list all volunteers
  - `GET /api/volunteers/:pubkey` — get one volunteer
  - `GET /api/volunteers/me` — get self
- [ ] Check if `phone` and `name` are filtered based on `c.get('roles')` or similar
- [ ] Check what `GET /api/auth/me` returns — does it include `name` and `phone` for the current user?
- [ ] Note the exact field names in the response objects

---

## Phase 2: Define Access Rules

| Field | Volunteer (self) | Volunteer (other) | Admin |
|-------|-----------------|-------------------|-------|
| `pubkey` | ✅ | ✅ | ✅ |
| `name` | ✅ own | ❌ hidden | ✅ |
| `phone` | ✅ own | ❌ hidden | ✅ (masked by default, unmasked via PIN challenge) |
| `roles` | ✅ own | ✅ (role names, not permissions) | ✅ |
| `spokenLanguages` | ✅ | ✅ (needed for shift display) | ✅ |
| `uiLanguage` | ✅ own | ❌ | ✅ |
| `callPreference` | ✅ own | ❌ | ✅ |
| `onBreak` | ✅ | ✅ | ✅ |
| `transcriptionEnabled` | ✅ own | ❌ | ✅ |
| `createdAt` | ❌ | ❌ | ✅ |
| `lastSeenAt` | ✅ | ✅ | ✅ |

---

## Phase 3: Implement Filtering

### 3.1 Create role-based response projector
- [ ] Create `src/worker/lib/volunteer-projector.ts` — define the three view interfaces (with discriminant tags `readonly view: 'public' | 'self' | 'admin'`) and implement:
  ```typescript
  function projectVolunteer(
    volunteer: Volunteer,
    requestorPubkey: string,
    requestorIsAdmin: boolean,
    options?: { unmask?: boolean }
  ): VolunteerPublicView | VolunteerSelfView | VolunteerAdminView
  ```
  - `VolunteerAdminView` (`view: 'admin'`): all fields, phone masked unless `options.unmask && isAdmin`
  - `VolunteerSelfView` (`view: 'self'`): own data, phone always masked
  - `VolunteerPublicView` (`view: 'public'`): only `pubkey`, `roles` (names), `spokenLanguages`, `onBreak`
- [ ] These types live in `src/worker/lib/volunteer-projector.ts` only — do NOT add them to `src/shared/types.ts` (that file is for client/server shared types)

### 3.2 Apply projection in route handlers
- [ ] `GET /api/volunteers` — for each volunteer in list:
  - If admin → `VolunteerAdminView`
  - If volunteer requesting own entry → `VolunteerSelfView`
  - Otherwise → `VolunteerPublicView`
- [ ] `GET /api/volunteers/:pubkey` — same projection logic
- [ ] `GET /api/auth/me` — always returns `VolunteerSelfView` (own data + admin status)
- [ ] `PATCH /api/volunteers/me` — returns `VolunteerSelfView`
- [ ] `PATCH /api/volunteers/:targetPubkey` — admin updating another volunteer, returns `VolunteerAdminView`

### 3.3 Phone masking (already in UI, verify in API)
- [ ] Verify `GET /api/volunteers/:pubkey` for admin returns masked phone by default: `{ phone: "+1 *** *** 1234" }`
- [ ] Implement `?unmask=true` query param on `GET /api/volunteers/:pubkey`:
  - Server-side check: only admin can request unmask; return 403 for non-admins
  - Returns full phone number when admin sends `?unmask=true`
  - Audit log entry created on every unmask request
  - Note: any PIN challenge step-up is client-side only (the server does not enforce a PIN — it enforces admin session + `?unmask=true`)

---

## Phase 4: TypeScript Enforcement

- [ ] Ensure route handlers return typed responses (not `c.json(volunteer as any)`)
- [ ] Update route return types to use the projection types:
  ```typescript
  volunteers.get('/', async (c): Promise<Response> => {
    // return type: VolunteerPublicView[] | VolunteerAdminView[]
  })
  ```
- [ ] Run `bun run typecheck` — any untyped response objects will surface here

---

## Phase 5: E2E Tests

- [ ] Add to `tests/roles.spec.ts` or create `tests/volunteer-pii.spec.ts`:

### Test 5.1: Volunteer list hides other volunteers' names
```
Given: Admin creates Volunteer A ("Alice Smith") and Volunteer B
When: Volunteer B fetches GET /api/volunteers
Then: Volunteer A's entry does NOT contain "Alice Smith" (name hidden)
Then: Volunteer A's entry contains pubkey, roles, spokenLanguages, onBreak
```

### Test 5.2: Volunteer list hides other volunteers' phone numbers
```
Given: Admin creates Volunteer A with phone "+15555551234"
When: Volunteer B fetches GET /api/volunteers
Then: Volunteer A's entry does NOT contain "+15555551234"
Then: phone field is absent or masked
```

### Test 5.3: Volunteer can see own name and masked phone
```
Given: Logged in as Volunteer A (name="Alice Smith", phone="+15555551234")
When: GET /api/auth/me
Then: Response contains name: "Alice Smith"
Then: phone is masked: "+1 *** *** 1234" (not the full number — self-view always masks)
```

### Test 5.4: Admin can see all volunteer names (masked phone)
```
Given: Logged in as Admin
When: GET /api/volunteers
Then: Each volunteer entry contains `name` field
Then: Phone fields are masked (e.g. "+1*****1234")
```

### Test 5.5: Admin can unmask phone with PIN challenge
```
Given: Admin has completed PIN challenge (preloaded in test)
When: GET /api/volunteers/:pubkey?unmask=true
Then: Phone field shows full number
```

---

## Completion Checklist

- [ ] `GET /api/volunteers` for non-admin: no `name` or `phone` fields on others
- [ ] `GET /api/volunteers/:pubkey` for non-admin (other volunteer): no `name` or `phone`
- [ ] `GET /api/auth/me`: own `name` and `phone` visible
- [ ] Admin view: all names visible, phones masked by default
- [ ] `bun run typecheck` passes (typed projections enforced)
- [ ] E2E tests pass: volunteer cannot see other volunteers' names or phones
- [ ] Phone masking test: masked format confirmed
- [ ] PIN challenge for admin unmask confirmed
