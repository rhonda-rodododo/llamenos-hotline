# Transcription Boundary Fix — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Problem

The architecture requirement states: _"Client-side transcription: WASM Whisper via @huggingface/transformers ONNX runtime. Audio never leaves the browser."_

However, the current server-side transcription service (`src/worker/services/transcription.ts`) calls `env.AI.run('@cf/openai/whisper', ...)` — the Cloudflare Workers AI binding — which sends audio bytes to CF's inference servers. This is the **default path** for call recording transcription.

The client-side WASM Whisper pipeline (`src/client/lib/transcription/`) is implemented and correct, but it only covers **live call transcription** (real-time via AudioWorklet during an active call). Post-call recording transcription falls back to the CF AI path.

This creates two security violations:
1. Audio leaves the browser (sent to CF servers for AI inference)
2. The "zero-knowledge" guarantee is broken for call recordings

---

## Two Transcription Paths

| Path | Where | Trigger | Audio destination | Current status |
|---|---|---|---|---|
| **Client-side (WASM)** | Browser | Active call, live | Never leaves device | ✅ Correct |
| **Server-side (CF AI)** | Worker | Post-call, recording | CF inference servers | ❌ Violates requirement |

---

## Architectural Decision

### Option A: Remove server-side transcription entirely
All transcription is client-side only. Post-call recording transcription is done by re-loading the recording audio in the browser and running local Whisper.

**Pros:** Clean zero-knowledge guarantee. No CF AI dependency.
**Cons:** Volunteer must have the browser open after the call ends to transcribe recordings. Transcription happens when the volunteer reviews notes, not automatically at call end.

### Option B: Make server-side transcription opt-in with explicit warning
Server-side transcription is disabled by default. An admin can enable it with a setting labelled "Cloud transcription (audio sent to Cloudflare AI)". When enabled, post-call recordings are transcribed server-side.

**Pros:** Organisations that accept the trade-off can still have automatic post-call transcription.
**Cons:** Complicates the mental model; requires a UI warning screen.

### Option C: Self-hosted Whisper server
For post-call recording transcription, use the `TranscriptionService` in `src/platform/node/transcription.ts` which calls a self-hosted Whisper HTTP endpoint. This keeps audio within the operator's infrastructure.

**Pros:** Zero-knowledge maintained (audio never leaves operator infra). Automatic.
**Cons:** Requires operators to run a Whisper server; adds deployment complexity.

### **Decision: Option A (primary) + Option C (operator opt-in)**

1. **Default:** All transcription is client-side WASM. Post-call recording transcription is done lazily when the volunteer opens the call notes (the browser fetches the recording audio and runs local Whisper).
2. **Operator opt-in:** If `WHISPER_SERVER_URL` is set in env, `src/platform/node/transcription.ts` is used for automatic post-call transcription. Audio stays within operator infra.
3. **CF AI path:** Removed entirely. `env.AI` binding removed from `wrangler.jsonc`. The `@cf/openai/whisper` call is deleted.

---

## Required Changes

### Backend changes

**`src/worker/services/transcription.ts`** (or `src/server/services/transcription.ts` post-Drizzle):
- Remove `env.AI.run('@cf/openai/whisper', ...)` call
- Change `maybeTranscribe()` to: if `WHISPER_SERVER_URL` is set, call self-hosted endpoint; otherwise, return `null` (client will handle it)
- The function still receives encrypted audio bytes, decrypts them (to pass to Whisper if server-side), and re-encrypts the transcript result

**`wrangler.jsonc`**:
- Remove `ai = { binding = "AI" }` entry

**`src/platform/node/env.ts`**:
- Ensure `WHISPER_SERVER_URL` is an optional env var (already present in transcription.ts)

### Frontend changes

**New: post-call recording transcription**
- After a call ends and the recording is available, the notes view lazy-loads the recording audio
- A "Transcribe" button appears next to the recording player
- Clicking it fetches the encrypted recording, decrypts it client-side, runs local Whisper WASM, and uploads the encrypted transcript
- Progress shown in the UI (Whisper model loading → transcribing → done)

**`src/client/lib/transcription/transcription-manager.ts`**:
- Expose a `transcribeAudioBuffer(buffer: ArrayBuffer): Promise<string>` method that works on arbitrary audio (not just live AudioWorklet stream)
- This is used by the post-call transcription button

### Settings UI

**`src/client/routes/admin/settings.tsx`** (transcription section):
- Change current toggle to:
  - "Client-side transcription (live calls)" — always on when browser supports WASM
  - If `WHISPER_SERVER_URL` is configured: show "Automatic post-call transcription via self-hosted Whisper"
  - Never show CF AI option

---

## Migration Notes

- Any existing transcripts generated via CF AI are already encrypted and stored correctly — no data migration needed
- The `AI` binding removal requires a `wrangler deploy` to take effect on CF Workers
- For Bun/VPS: the Node transcription service path is unchanged; just remove the CF AI code path

---

## Testing

1. Start a call (mock telephony webhook), end it
2. Verify `WHISPER_SERVER_URL` unset → no server transcription → transcript is `null`
3. Navigate to call notes → "Transcribe" button visible
4. Click transcribe → progress indicator → transcript appears
5. Verify transcript is encrypted before storage (API receives ciphertext, not plaintext)
6. With `WHISPER_SERVER_URL` set → verify auto-transcription runs via self-hosted endpoint

---

## Dependencies

- Existing: `src/client/lib/transcription/transcription-manager.ts` (add `transcribeAudioBuffer` method)
- Existing: `src/platform/node/transcription.ts` (already uses self-hosted Whisper)
- New: "Transcribe" button in recording player component
- Remove: `env.AI` Cloudflare binding
