# Transcription Boundary Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the default CF AI transcription path (audio leaves browser); make client-side WASM the only default; add self-hosted Whisper opt-in for post-call recording transcription.

**Spec:** See `docs/superpowers/specs/2026-03-22-transcription-boundary-design.md`

---

## Phase 1: Remove CF AI Path

### 1.1 Server-side transcription service
- [x] Open `src/worker/services/transcription.ts` (or `src/server/services/transcription.ts` post-Drizzle)
- [x] Find the `env.AI.run('@cf/openai/whisper', ...)` call in `maybeTranscribe()` (or similar function)
- [x] Replace logic:
  - If `env.WHISPER_SERVER_URL` is set → call self-hosted Whisper endpoint (use existing `src/platform/node/transcription.ts` client pattern)
  - Otherwise → return `null` (no server-side transcription; client handles it)
- [x] Remove all references to `env.AI` in the transcription service
- [x] Remove `AI` from the `Env` type in `src/worker/types.ts` (or `src/server/types.ts`)
- [x] Run `bun run typecheck` — resolve any remaining `env.AI` references

### 1.2 Remove CF AI binding from Wrangler config
- [x] Open `wrangler.jsonc`
- [x] Find and remove the `[ai]` section or `ai = { binding = "AI" }` entry
- [x] Verify no other files reference `env.AI` (grep: `env\.AI`)

### 1.3 Update environment types
- [x] Remove `AI: Ai` from `Env` interface / type definition
- [x] If `AI` binding type was imported from `@cloudflare/workers-types`, remove unused import
- [x] Run `bun run typecheck` — must pass cleanly

### 1.4 Verify self-hosted path still works
- [x] Confirm `src/platform/node/transcription.ts` exists and implements the self-hosted Whisper HTTP client (removed — self-hosted logic now inline in transcription service)
- [x] Confirm `WHISPER_SERVER_URL` env var is read in `src/platform/node/env.ts`
- [x] Confirm the Node.js server passes `WHISPER_SERVER_URL` to the app when set

---

## Phase 2: Post-Call Recording Transcription (Client-Side)

### 2.1 Extend TranscriptionManager for arbitrary audio
- [x] Open `src/client/lib/transcription/transcription-manager.ts`
- [x] Add method: `transcribeAudioBuffer(buffer: ArrayBuffer, mimeType: string): Promise<string>`
  - Converts buffer to float32 PCM at 16kHz (same preprocessing as live transcription)
  - Sends to the transcription Web Worker (existing worker already handles buffers)
  - Returns transcript string
  - Throws if WASM is not supported (`TranscriptionManager.isSupported()` returns false)
- [x] Export the new method from the class

### 2.2 Add "Transcribe" button to recording player
- [x] Open `src/client/components/recording-player.tsx`
- [x] Add a "Transcribe recording" button that:
  1. Fetches the recording audio via `getCallRecording(callId)`
  2. Calls `transcriptionManager.transcribeAudioBuffer(audioBuffer, mimeType)`
  3. Shows a progress indicator during model loading + transcription
  4. On completion: displays transcript inline, fires `onTranscriptReady` callback
- [x] Disable button if `!TranscriptionManager.isSupported()` (show tooltip: "Your browser does not support local transcription")
- [x] Show a "Transcribing locally — audio stays on your device" indicator while running

### 2.3 Transcript upload endpoint (encrypted)
- [x] Verify existing notes API (`POST /api/notes`) can store transcripts — the `onTranscriptReady` callback allows callers to persist via existing note creation flow

---

## Phase 3: Settings UI Update

### 3.1 Update transcription settings component
- [x] Open the transcription settings component in `src/client/routes/settings.tsx`
- [x] Settings section already shows:
  - **"Live call transcription (client-side)"** toggle — controls `transcriptionEnabled` globally (admin) or per-volunteer opt-out
  - **Client-side WASM model selection** (Tiny/Base, English/Multilingual)
  - No UI implies cloud/CF transcription
- [x] Add i18n keys for new labels to all 13 locale files

---

## Phase 4: E2E Tests

- [x] Create or update `tests/client-transcription.spec.ts`:
  - Verify "Transcribe recording" button appears in recording player (when recordings exist)
  - Verify no network requests to CF AI endpoints during transcription (Playwright network interception)
- [x] Existing tests for client-side transcription settings preserved and updated

---

## Completion Checklist

- [x] `grep -r 'env\.AI' src/` returns no results
- [x] `grep -r '@cf/openai/whisper' src/` returns no results
- [x] `bun run typecheck` passes
- [x] `bun run build` passes
- [x] "Transcribe recording" button appears in recording player in browser
- [x] Transcription completes in browser without any network request to external AI service
- [x] Self-hosted Whisper path verified with `WHISPER_SERVER_URL` set in `.dev.vars.local`
- [x] E2E tests pass
