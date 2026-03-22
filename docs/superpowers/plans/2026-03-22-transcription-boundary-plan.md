# Transcription Boundary Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the default CF AI transcription path (audio leaves browser); make client-side WASM the only default; add self-hosted Whisper opt-in for post-call recording transcription.

**Spec:** See `docs/superpowers/specs/2026-03-22-transcription-boundary-design.md`

---

## Phase 1: Remove CF AI Path

### 1.1 Server-side transcription service
- [ ] Open `src/worker/services/transcription.ts` (or `src/server/services/transcription.ts` post-Drizzle)
- [ ] Find the `env.AI.run('@cf/openai/whisper', ...)` call in `maybeTranscribe()` (or similar function)
- [ ] Replace logic:
  - If `env.WHISPER_SERVER_URL` is set → call self-hosted Whisper endpoint (use existing `src/platform/node/transcription.ts` client pattern)
  - Otherwise → return `null` (no server-side transcription; client handles it)
- [ ] Remove all references to `env.AI` in the transcription service
- [ ] Remove `AI` from the `Env` type in `src/worker/types.ts` (or `src/server/types.ts`)
- [ ] Run `bun run typecheck` — resolve any remaining `env.AI` references

### 1.2 Remove CF AI binding from Wrangler config
- [ ] Open `wrangler.jsonc`
- [ ] Find and remove the `[ai]` section or `ai = { binding = "AI" }` entry
- [ ] Verify no other files reference `env.AI` (grep: `env\.AI`)

### 1.3 Update environment types
- [ ] Remove `AI: Ai` from `Env` interface / type definition
- [ ] If `AI` binding type was imported from `@cloudflare/workers-types`, remove unused import
- [ ] Run `bun run typecheck` — must pass cleanly

### 1.4 Verify self-hosted path still works
- [ ] Confirm `src/platform/node/transcription.ts` exists and implements the self-hosted Whisper HTTP client
- [ ] Confirm `WHISPER_SERVER_URL` env var is read in `src/platform/node/env.ts`
- [ ] Confirm the Node.js server passes a `transcriptionService` (or equivalent) to the app when `WHISPER_SERVER_URL` is set

---

## Phase 2: Post-Call Recording Transcription (Client-Side)

### 2.1 Extend TranscriptionManager for arbitrary audio
- [ ] Open `src/client/lib/transcription/transcription-manager.ts`
- [ ] Add method: `transcribeAudioBuffer(buffer: ArrayBuffer, mimeType: string): Promise<string>`
  - Converts buffer to float32 PCM at 16kHz (same preprocessing as live transcription)
  - Sends to the transcription Web Worker (existing worker already handles buffers)
  - Returns transcript string
  - Throws if WASM is not supported (`TranscriptionManager.isSupported()` returns false)
- [ ] Export the new method from the class

### 2.2 Add "Transcribe" button to recording player
- [ ] Open `src/client/components/recording-player.tsx`
- [ ] Add a "Transcribe recording" button that:
  1. Fetches the encrypted recording audio via `GET /api/calls/:callId/recording-audio`
  2. Decrypts the audio client-side using the call's encryption key
  3. Calls `transcriptionManager.transcribeAudioBuffer(audioBuffer, mimeType)`
  4. Shows a progress indicator during model loading + transcription
  5. On completion: calls `PATCH /api/notes/:noteId` to attach transcript, or creates a new note with the transcript
- [ ] Disable button if `!TranscriptionManager.isSupported()` (show tooltip: "Your browser does not support local transcription")
- [ ] Show a "⚠ Transcribing locally — audio stays on your device" indicator while running

### 2.3 Transcript upload endpoint (encrypted)
- [ ] Verify `PATCH /api/notes/:noteId` or `POST /api/calls/:callId/transcript` exists and accepts encrypted transcript body
- [ ] If not: add `POST /api/calls/:callId/transcript` route:
  - Body: `{ encryptedTranscript: string }` (Zod-validated)
  - Stores encrypted transcript in call record
  - Permission: `notes:create` (volunteer can add to own calls)

---

## Phase 3: Settings UI Update

### 3.1 Update transcription settings component
- [ ] Open the transcription settings component in `src/client/components/` (check admin settings route)
- [ ] Change the settings section to:
  - **"Live call transcription (client-side)"** toggle — controls `transcriptionEnabled` globally (admin) or per-volunteer opt-out
  - **"Post-call recording transcription"** — shows one of:
    - "Transcribe manually in the browser (default)" with explanation
    - "Automatic transcription via self-hosted Whisper server" (if `WHISPER_SERVER_URL` is configured — show as read-only info, set by operator env var)
  - Remove any UI that implies cloud/CF transcription
- [ ] Add i18n keys for new labels to all 13 locale files

---

## Phase 4: E2E Tests

- [ ] Create or update `tests/client-transcription.spec.ts`:
  - Verify "Transcribe recording" button appears in recording player
  - Mock `transcribeAudioBuffer()` to return a fixed transcript
  - Click button → verify loading state → verify transcript appears
  - Verify no network requests to CF AI endpoints during transcription (Playwright network interception)
- [ ] Add test: when `WHISPER_SERVER_URL` is set in test env, verify POST goes to mock self-hosted endpoint (not CF)

---

## Completion Checklist

- [ ] `grep -r 'env\.AI' src/` returns no results
- [ ] `grep -r '@cf/openai/whisper' src/` returns no results
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] "Transcribe recording" button appears in recording player in browser
- [ ] Transcription completes in browser without any network request to external AI service
- [ ] Self-hosted Whisper path verified with `WHISPER_SERVER_URL` set in `.dev.vars.local`
- [ ] E2E tests pass
