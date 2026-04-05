# SDR Agent — Stub Spec

**Status:** Stub — full spec deferred

**Author:** System
**Date:** 2026-04-04

---

## Concept

The SDR agent ingests public-band radio transmissions — police scanner, marine band, aviation ATIS/UNICOM, amateur radio — transcribes them via Whisper, and optionally uses an LLM to extract structured reports when a relevant event is detected. Reports are submitted as E2EE conversation records following the machine reporter pattern.

Typical use: a hub monitoring local public-safety comms tunes one or more SDR receivers to relevant frequencies. Transmissions are continuously captured, segmented into utterances, transcribed, and fed to an extraction step. When the LLM identifies an event worth reporting (incident, dispatch call, weather advisory), it submits a structured report to the hub's report queue visible to on-shift volunteers and admins.

---

## Pattern Reference

This agent MUST follow `docs/architecture/MACHINE_REPORTER_PATTERN.md`:

- Per-agent keypair generated at connection creation via `src/server/lib/agent-identity.ts`
- `LABEL_SDR_AGENT_SEAL` (to be added to `src/shared/crypto-labels.ts`) for nsec sealing
- `LABEL_SDR_REPORT_WRAP` (to be added) for envelope encryption of extracted reports
- Audit format: `system:sdr:{agentId}` in authorPubkey field
- Lifecycle: init on startup, nsec zeroed on `stopAgent`, circuit breaker on repeated failures

---

## Open Questions

The following must be answered before writing the full spec:

1. **SDR hardware/software stack**: rtl-sdr dongle + `rtl_fm`? HackRF? GQRX pipeline? GNU Radio flowgraph? What is the ingestion API surface the agent talks to?

2. **Audio ingestion pipeline**: Continuous streaming or VOX-gated (squelch-break triggered)? Continuous requires chunking; VOX reduces noise but may clip start of transmissions.

3. **Audio segmentation for transcription**: Fixed time windows (e.g. 30s)? Silence-detection splits? Maximum utterance length before forcing a split? How to handle overlap at segment boundaries?

4. **Frequency/agency configuration**: Are monitored frequencies configured per hub? Per SDR connection record? How does an admin specify "monitor 155.340 MHz for county fire dispatch"? Is there a feed catalog (Broadcastify integration)?

5. **Legal considerations**: Public-band monitoring is legal in most jurisdictions; encrypted bands (P25 Phase II trunked, NXDN, DMR with encryption) must not be decoded. How does the agent enforce this? Does it need a legal disclaimer or admin acknowledgement at setup?

6. **Transcription storage rate**: Continuous SDR can produce hundreds of short utterances per hour per frequency. What fraction gets stored vs. discarded? Only LLM-flagged events? All transcripts with TTL? This has direct database and storage cost implications.

7. **LLM extraction overhead**: Same inference endpoint pattern as firehose agent? What model size is appropriate for near-realtime extraction on a VPS? Can the extraction step be skipped (transcription-only mode)?

8. **Event correlation across transmissions**: A single incident may span multiple transmissions across several minutes (dispatch → unit acknowledge → arrival). How are these correlated into a single report vs. separate reports? Time-window heuristic like the firehose agent? Speaker/unit ID detection?

9. **Multi-receiver coordination**: Multiple SDR receivers per hub monitoring different frequencies — do they share a single agent instance or one instance per receiver? How does the agent record map to hardware?

10. **Dependency on external SDR software**: The agent needs a subprocess or IPC interface to SDR capture software. What process supervision model? What happens when the SDR device disconnects?
