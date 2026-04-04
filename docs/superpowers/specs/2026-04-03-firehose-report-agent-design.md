# Firehose Report Agent — Design Spec

**Date:** 2026-04-03
**Status:** Draft

## Overview

A Bun service that ingests Signal group chat streams ("firehoses"), uses a self-hosted LLM (Qwen3.5-9B via vLLM) to detect incidents and extract structured reports, and submits them as an E2EE machine reporter for human triage. Each connected Signal group gets its own agent identity (keypair), extraction configuration (report type + custom fields), and inference endpoint.

The agent is just another reporter — it uses the existing report submission API, existing report types with custom fields as extraction schemas, existing PBAC roles for authorization, and existing triage workflows for human review. No special "draft" state or parallel system needed.

---

## 1. Architecture Overview

### Core Entity: FirehoseConnection

Each connection represents a Signal group being monitored by an agent:

```
FirehoseConnection
├─ id                        (uuid)
├─ hubId                     (which hub owns this)
├─ signalGroupId             (Signal group identifier, auto-detected)
├─ displayName               (admin label, hub-key encrypted)
├─ encryptedDisplayName      (Ciphertext)
├─ reportTypeId              (FK → report_types, defines extraction schema)
├─ agentPubkey               (this agent's public key)
├─ encryptedAgentNsec        (sealed with deploy secret)
├─ geoContext?               (geographic context for geocoding + LLM, e.g., "Minneapolis, MN, North")
├─ geoContextCountryCodes?   (ISO 3166-1 alpha-2 codes for geocoding filter)
├─ inferenceEndpoint?        (vLLM URL override, null = use default)
├─ extractionIntervalSec     (tunable, default 60)
├─ systemPromptSuffix?       (extra LLM context for this connection)
├─ bufferTtlDays             (default 7)
├─ notifyViaSignal           (default true)
├─ status                    (pending | active | paused | disabled)
├─ createdAt
└─ updatedAt
```

### Data Flow

```
Signal Group
    │
    ▼
signal-cli-rest-api (webhook)
    │
    ▼
MessagingRouter
    ├─ identifies firehose group (signalGroupId match)
    ├─ envelope-encrypts for: agent pubkey + hub admins
    └─ stores in firehose_messages table
           │
           ▼
    Nostr event (KIND_FIREHOSE_MESSAGE)
           │
           ▼
    Agent Service (subscribes per connection)
    ├─ decrypts with agent nsec
    ├─ buffers in memory + encrypted checkpoint in DB
    │
    │  [periodic extraction loop]
    ├─ incident boundary detection (heuristic + LLM)
    ├─ structured extraction (LLM + response_format)
    ├─ geocoding tool calls (OpenCage/Geoapify)
    │
    ├─ builds report:
    │   ├─ structured fields from report type's custom fields
    │   ├─ source messages + sender identities (metadata)
    │   └─ envelope-encrypted for reviewers + admins + agent
    │
    ├─ submits via Report API (machine role credentials)
    │
    └─ notifications:
        ├─ Nostr event (in-app, always)
        └─ Signal DM to admins (opt-out via reply code)
```

### Trust Boundaries

- **Agent process**: Same trust level as a volunteer session. Holds one nsec per group, in-memory only, zeroed on shutdown.
- **vLLM server**: Trusted infrastructure. Receives plaintext for extraction. Must be self-hosted, network-isolated (no egress). Configurable URL per connection allows a dedicated GPU server outside the cluster.
- **signal-cli bridge**: Already trusted (handles all Signal I/O). No new trust surface.
- **Report API**: Agent authenticates as a machine reporter role. Permissions scoped to `reports:create` + `reports:send-message-own`. Cannot read other reports, manage users, or escalate.

### Per-Group Isolation

Each FirehoseConnection has its own:
- Keypair (agent can only decrypt messages for its assigned group)
- Extraction config (report type, system prompt)
- Inference endpoint (optional override — different groups can hit different models)
- Buffer state (compromise of one group's context doesn't leak another's)

---

## 2. Extraction Schema via Report Types

No separate schema system. The existing report type + custom fields system IS the extraction schema.

### How It Works

1. Admin creates a report type (e.g., "SALUTE") with custom fields via the existing custom field builder
2. When configuring a firehose connection, admin selects that report type
3. At runtime, the agent reads the report type's custom field definitions and generates a JSON Schema
4. The JSON Schema is sent to vLLM as `response_format` for guided structured generation
5. Each field's `description` doubles as LLM guidance

### Schema Generation from Custom Fields

```
Report Type: "SALUTE"
├─ Custom Fields:
│   ├─ size      (string, required, desc: "Number/strength of personnel or assets")
│   ├─ activity  (string, required, desc: "What is happening")
│   ├─ location  (location, required, desc: "Where it is happening")
│   ├─ unit      (string, optional, desc: "Who is involved")
│   ├─ time      (string, required, desc: "When observed, ISO 8601 or relative")
│   └─ equipment (string, optional, desc: "Vehicles, weapons, tools, gear observed")
│
└─ Generated JSON Schema (sent as response_format):
    {
      "type": "object",
      "properties": {
        "size":      { "type": "string", "description": "Number/strength..." },
        "activity":  { "type": "string", "description": "What is happening" },
        "location":  { "type": "string", "description": "Where it is happening" },
        "unit":      { "type": "string", "description": "Who is involved" },
        "time":      { "type": "string", "description": "When observed..." },
        "equipment": { "type": "string", "description": "Vehicles, weapons..." }
      },
      "required": ["size", "activity", "location", "time"]
    }
```

### Predefined Templates (Seed Report Types)

Shipped as seed data — admins can use as-is, clone and customize, or build from scratch:

- **SALUTE** — Size, Activity, Location, Unit, Time, Equipment
- **SPOTREP** — DateTime, Location, Unit, Activity, Disposition, Request
- **ACE** — Ammunition, Casualties, Equipment

These are just report types with pre-configured custom fields. No special template system.

### Location Fields & Geographic Context

Each firehose connection can have a `geoContext` (e.g., "Minneapolis, MN, North") and `geoContextCountryCodes` (e.g., `["US"]`). These serve two purposes:

1. **Geocoding disambiguation**: When the agent geocodes "corner of Broadway and Penn", the `geoContext` is appended to the query so the geocoding provider returns Minneapolis results, not NYC or London. Country codes filter results further.

2. **LLM context**: The `geoContext` is injected into the LLM system prompt so the model understands the geographic frame of reference. When someone says "the north side" or "by the lake", the model knows what that means locally.

When a custom field has `fieldType: 'location'`, the agent automatically geocodes the extracted text using the geocoding adapter with the connection's `geoContext` as a bias. The resolved coordinates and structured address are included in the report.

---

## 3. Agent Service Architecture

### Service Lifecycle

The agent runs as part of the main Bun server process — a service like any other, initialized at startup, managed via the existing service injection pattern.

```
Server startup
    │
    ▼
FirehoseAgentService.init()
    ├─ loads all enabled FirehoseConnections from DB
    ├─ for each connection:
    │   ├─ unseals agent nsec (deploy secret → memory)
    │   ├─ subscribes to Nostr filter (firehose messages for this group)
    │   └─ starts extraction loop (setInterval, per-connection cadence)
    └─ watches for config changes (Nostr event for connection CRUD)

Runtime (per-connection loop)
    │
    ▼
    ┌─────────────────────────────────────┐
    │  1. Check message buffer            │
    │     └─ any new messages since last? │
    │                                     │
    │  2. Incident boundary detection     │
    │     ├─ reply chains (Signal quotes) │
    │     ├─ temporal clustering          │
    │     ├─ sender co-occurrence         │
    │     ├─ semantic similarity (LLM)    │
    │     └─ output: message clusters     │
    │                                     │
    │  3. For each cluster:               │
    │     ├─ already extracted? → skip    │
    │     ├─ too few messages? → wait     │
    │     └─ extract → submit → notify    │
    │                                     │
    │  4. Checkpoint buffer state         │
    └─────────────────────────────────────┘

Shutdown / restart
    ├─ zero all nsecs from memory
    ├─ persist buffer checkpoints (encrypted)
    └─ on restart: reload from checkpoint, catch up via last processed message
```

### Incident Boundary Detection

Two-phase approach:

**Phase 1: Heuristic clustering (cheap, no LLM)**
- Reply chains — Signal provides quote metadata, group replies into threads
- Temporal window — messages within N seconds from same sender likely related
- Keyword anchoring — location names, numbers, descriptive terms that repeat
- Sender patterns — back-and-forth between 2-3 senders about the same event
- Context clues — users replying to each other, asking questions about a specific event

**Phase 2: LLM refinement (only when heuristics are ambiguous)**
- Send candidate clusters to LLM: "Are these messages about the same incident? Should any be split or merged?"
- Cheaper call than full extraction — small prompt, boolean/enum output
- Only invoked when heuristic confidence is low

### Message Buffer

```
firehose_message_buffer (DB table)
├─ id
├─ connectionId              (FK → firehose_connections)
├─ signalTimestamp            (original message time)
├─ encryptedContent           (agent-key encrypted)
├─ encryptedSenderInfo        (agent-key encrypted)
├─ clusterId?                 (null until assigned to incident)
├─ extractedReportId?         (null until report submitted)
├─ receivedAt
└─ expiresAt                  (TTL — purge after bufferTtlDays)
```

Buffer is encrypted at rest under the agent's key. Messages tagged with cluster assignment and extraction status. On restart, agent loads unextracted messages and resumes.

After extraction + report submission, source messages are retained for the TTL (so triage reviewers can reference them via the report's encrypted metadata), then purged.

### LLM Client

Thin wrapper around the OpenAI JS SDK, pointed at the vLLM endpoint:

```typescript
interface FirehoseInferenceClient {
  detectIncidentBoundaries(
    messages: DecryptedMessage[],
    candidates: MessageCluster[]
  ): Promise<MessageCluster[]>

  extractReport(
    messages: DecryptedMessage[],
    schema: JSONSchema,
    systemPrompt: string
  ): Promise<{ fields: Record<string, string>, confidence: number }>
}
```

- Uses `response_format` for extraction (structured output via guided decoding)
- Configurable model, temperature, max tokens per connection
- Timeout + retry with backoff
- vLLM started with `--structured-outputs-config.enable_in_reasoning=True` for Qwen3.5

### Machine Role & Auth

Each agent authenticates as a machine reporter:

```
machine-reporter:{connectionId}
├─ role: "Firehose Agent" (custom role, auto-created per connection)
├─ permissions:
│   ├─ reports:create
│   ├─ reports:send-message-own
│   └─ firehose:read (new permission for firehose messages)
├─ keypair: unique per connection
└─ auth: sealed credentials, service account JWT (no OIDC flow)
```

Author field on submitted reports: `system:firehose-agent:{connectionId}`

---

## 4. Report Payload

When the agent extracts a report, it builds this payload:

```typescript
{
  // Standard report fields
  reportTypeId: string
  hubId: string

  // Extracted structured data (encrypted in envelope)
  extractedFields: Record<string, string>   // custom field name → extracted value

  // Source attribution (encrypted metadata in envelope)
  sourceMessages: Array<{
    signalUsername: string     // or HMAC-hashed phone if no username
    timestamp: string         // ISO 8601
    content: string           // original message text
    messageId: string         // reference to firehose_message_buffer row
  }>

  // Geocoded locations (encrypted, for location-type fields)
  resolvedLocations: Array<{
    fieldName: string
    rawText: string
    resolved: LocationResult | null
  }>

  // Agent metadata
  agentId: string             // firehose connection ID
  confidence: number          // 0-1, LLM self-assessed
  incidentTimestamp: string   // earliest source message time
}
```

All of `extractedFields`, `sourceMessages`, and `resolvedLocations` are envelope-encrypted. The server never sees plaintext. Envelopes are wrapped for:
- Each user with `reports:read-all` or `reports:read-assigned` permission
- Each hub admin
- The agent itself (for dedup/reference)

---

## 5. Admin Configuration UI

### Connecting a Signal Group

```
1. Admin navigates to Hub Settings → Firehose Connections
2. Clicks "Add Connection"
3. Provides:
   ├─ Display name (label for this connection)
   ├─ Report type (dropdown of hub's report types)
   └─ Extraction interval, system prompt, buffer TTL (optional, sensible defaults)
4. System generates:
   ├─ Agent keypair (sealed with deploy secret)
   ├─ Machine reporter role + service JWT
   └─ Instructions: "Add this number/username to your Signal group"
5. Admin adds the bot to the Signal group
6. First message received → system auto-detects the signalGroupId
7. Connection goes active
```

### Connection Lifecycle

```
pending → active → paused → active → disabled
           │                           │
           └── admin can pause/resume ──┘
```

- **Pending** — created but no messages received yet (bot not added to group)
- **Active** — receiving and processing messages
- **Paused** — admin temporarily stopped extraction (messages still buffered)
- **Disabled** — fully stopped, agent nsec zeroed, buffer purged

### Settings UI

A table in Hub Settings:

| Group | Report Type | Status | Last Report | Actions |
|-------|-------------|--------|-------------|---------|
| Field Team Alpha | SALUTE | Active | 2 min ago | Pause / Edit / Delete |
| Medical Reports | MedSITREP | Paused | 3 hrs ago | Resume / Edit / Delete |

Edit dialog:
- Display name
- Report type (select from hub's report types)
- Geographic context (city/neighborhood text, e.g., "Minneapolis, MN, North")
- Country filter (ISO codes for geocoding)
- Extraction interval (30s–5min)
- Inference endpoint override (optional URL)
- System prompt customization (textarea)
- Buffer TTL (1–30 days)
- Signal DM notifications (on/off)

### Signal Group Auto-Detection

The bot listens for messages with `groupInfo.groupId` in the Signal webhook. When a new `groupId` arrives that matches no active connection, the system checks pending connections and auto-links by creation order. If no pending connection exists, the message is discarded.

Alternative: admin can paste the `groupId` directly if known.

---

## 6. Notifications

### In-App (Nostr)

Every report submission emits a Nostr event (`KIND_FIREHOSE_REPORT`) visible to admins and users with `reports:read-all` or `reports:read-assigned`. Standard in-app notification — always on.

### Signal DM (Opt-Out)

First report from a connection triggers a Signal DM to each admin:

```
[Llamenos] Firehose report submitted from "Field Team Alpha"
Report type: SALUTE | Confidence: 0.87
Reply STOP-{shortCode} to disable Signal notifications for this connection.
```

- Opt-out codes stored per admin per connection
- Admins can re-enable from the settings UI
- `notifyViaSignal` flag on the connection controls default behavior

---

## 7. Security & Encryption

### Encryption Flow

**Inbound (Signal → Buffer):**
```
Signal message arrives
    → MessagingRouter identifies firehose group
    → envelope encrypt:
        ├─ random symmetric key (XChaCha20)
        └─ ECIES-wrap for: agent pubkey + each hub admin
    → store in firehose_messages table
    → agent decrypts with its nsec → plaintext in memory only
```

**Buffer (checkpoint):**
```
In-memory plaintext messages in rolling window
    → periodic checkpoint to DB
    → XChaCha20 encrypt under agent's own key
    → stored in firehose_message_buffer
    → on restart: unseal nsec, decrypt checkpoint, resume
```

**Outbound (Agent → Report):**
```
Agent extracts structured report
    → envelope encrypt:
        ├─ random symmetric key per report
        └─ ECIES-wrap for: reviewers + admins + agent
    → encrypted fields: extractedFields, sourceMessages, resolvedLocations
    → submit via Report API
```

**LLM calls (Agent → vLLM):**
```
Plaintext sent to vLLM for extraction
    ├─ vLLM is self-hosted, same trust boundary
    ├─ TLS required if not localhost / private network
    └─ vLLM must have NO outbound internet access
```

### Key Management

```
Per-connection keypair:
├─ Generated at connection creation
├─ nsec sealed with deploy-time key:
│   ├─ HKDF(FIREHOSE_AGENT_SEAL_KEY, LABEL_FIREHOSE_AGENT_SEAL + connectionId)
│   └─ XChaCha20-Poly1305 encrypt nsec
│   └─ stored as encryptedAgentNsec in DB
├─ Deploy secret:
│   ├─ env var: FIREHOSE_AGENT_SEAL_KEY (64 hex chars)
│   └─ same lifecycle as JWT_SECRET, IDP_VALUE_ENCRYPTION_KEY
└─ On startup:
    ├─ derive per-connection seal key via HKDF
    ├─ unseal nsec → hold in memory closure
    └─ zero nsec from all other locations
```

Domain separation labels (added to `crypto-labels.ts`):
```typescript
export const LABEL_FIREHOSE_AGENT_SEAL = 'llamenos:firehose:agent-seal'
export const LABEL_FIREHOSE_BUFFER_ENCRYPT = 'llamenos:firehose:buffer-encrypt'
export const LABEL_FIREHOSE_REPORT_WRAP = 'llamenos:firehose:report-wrap'
```

### Agent Credential Lifecycle

- **Creation**: Admin creates connection → keypair generated → nsec sealed → pubkey distributed to admins for envelope recipients
- **Runtime**: Server starts → unseal nsec into memory closure → nsec NEVER written to logs, temp files, or API responses
- **Rotation**: Admin triggers rotation → new keypair → re-encrypt buffer → update envelope recipients → old key zeroed
- **Deletion**: Admin deletes connection → zero nsec → purge buffer → remove pubkey from future envelopes → existing reports remain readable by their envelope recipients

### Network Isolation

```
┌─────────────────────────────────────────┐
│  App Network (Docker/Ansible)           │
│  ├─ Bun server (app + agent service)    │
│  ├─ PostgreSQL                          │
│  ├─ signal-cli-rest-api                 │
│  ├─ strfry (Nostr relay)                │
│  └─ coturn                              │
└──────────────┬──────────────────────────┘
               │ private network / localhost
               ▼
┌─────────────────────────────────────────┐
│  Inference Network                      │
│  ├─ vLLM server (Qwen3.5-9B)           │
│  ├─ NO outbound internet               │
│  ├─ accepts connections from app only   │
│  └─ optional: separate GPU host         │
│     (TLS required if not localhost)     │
└─────────────────────────────────────────┘
```

### Audit Trail

Every agent action is audit-logged:
- Connection created/modified/deleted
- Agent started/stopped/restarted
- Report extracted and submitted (with confidence score)
- Extraction failure (LLM timeout, validation error)
- Buffer checkpoint/purge
- Key rotation

Author: `system:firehose-agent:{connectionId}`

---

## 8. Deployment & Infrastructure

### vLLM Container

Added to the Docker Compose / Ansible stack as an optional service:

```yaml
vllm:
  image: vllm/vllm-openai:latest
  environment:
    - MODEL_NAME=Qwen/Qwen3.5-9B
    - QUANTIZATION=awq
    - MAX_MODEL_LEN=8192
    - GUIDED_DECODING_BACKEND=outlines
  command: >
    --structured-outputs-config.enable_in_reasoning=True
  ports:
    - "8000"  # internal only, not exposed to host
  networks:
    - inference_net
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: [gpu]  # optional, falls back to CPU
```

### Model Selection

| Model | Active Params | VRAM (AWQ) | CPU RAM | Use Case |
|-------|--------------|------------|---------|----------|
| **Qwen3.5-9B** | 9B | ~6GB | ~18GB | **Default** — strong quality, reliable structured output |
| Qwen3.5-27B | 27B | ~16GB | ~36GB | Higher quality, needs structured output workaround |
| Qwen3.5-4B | 4B | ~3GB | ~8GB | Lightweight — runs anywhere |
| Qwen3.5-397B-A17B | 17B active | ~24GB | N/A | Flagship MoE — best quality, serious GPU |

Per-connection `inferenceEndpoint` override allows mixing models. The URL is fully configurable — can point to a self-hosted GPU server outside the cluster.

### Environment Variables

```bash
# Required when firehose connections exist
FIREHOSE_AGENT_SEAL_KEY=        # 64 hex chars, seals agent nsecs
FIREHOSE_INFERENCE_URL=         # default vLLM endpoint (e.g., http://vllm:8000/v1)

# Optional
FIREHOSE_DEFAULT_MODEL=         # model name override for API calls
```

No feature flags. The feature is active when firehose connections exist. If no vLLM endpoint is reachable, connection activation fails with a clear error in the admin UI.

### Ansible Integration

```
roles/
  firehose-agent/
    tasks/main.yml              # deploy vLLM container + config
    templates/vllm.docker.yml.j2
    defaults/main.yml           # model, quantization, resource limits
```

Fits into the existing `just deploy-demo` pipeline. vLLM container only started when connections exist.

### Health & Monitoring

```
GET /api/admin/firehose/status
└─ per connection:
   ├─ status (active/paused/error)
   ├─ lastMessageReceived
   ├─ lastReportSubmitted
   ├─ bufferSize (message count)
   ├─ extractionCount (total reports)
   └─ inferenceHealth (last vLLM response time)
```

If vLLM is unreachable for >5 minutes, connection auto-pauses with admin notification.

---

## 9. Testing Strategy

### Unit Tests (colocated `.test.ts`)

**Incident boundary detection:**
- Heuristic clustering: reply chains grouped correctly
- Temporal clustering: messages within window grouped, outside split
- Sender co-occurrence patterns
- Mixed signals: overlapping incidents separated

**Schema generation from custom fields:**
- Report type with string/number/enum/location fields → valid JSON Schema
- Required flags propagated
- Field descriptions included for LLM guidance
- Edge cases: no custom fields, all optional, enum with single option

**Encryption flows:**
- Agent keypair generation + sealing/unsealing round-trip
- Buffer checkpoint encrypt/decrypt round-trip
- Report envelope creation with correct recipient list
- Domain separation labels used correctly

**Notification opt-out:**
- Reply code parsing and validation
- Opt-out state persisted per admin per connection

### API E2E Tests (`tests/api/`)

**Connection CRUD:**
- Admin creates/updates/pauses/deletes connections
- Non-admin rejected (PBAC enforced)
- Machine role permissions scoped correctly

**Report submission:**
- Agent submits report with machine role JWT
- Envelope encryption correct (decryptable by admins)
- Source messages included as encrypted metadata
- Report linked to correct report type

**Firehose ingest:**
- Signal webhook with group message → stored with agent envelope
- Unknown group ID → discarded
- Paused connection → buffered, no extraction

### Integration Tests (mock vLLM)

Lightweight mock vLLM returning canned structured responses:

- Inject messages → agent clusters → mock vLLM → report created
- Geocoding triggered for location fields
- Multiple incidents → multiple reports
- Dedup: same incident not extracted twice
- Buffer recovery: restart → checkpoint loaded → resumes

### UI E2E Tests (`tests/ui/`)

- Create firehose connection (select report type)
- View connection status table
- Pause/resume/delete connection
- Edit settings
- Notification preferences

---

## 10. New Permissions

Added to the permission catalog in `src/shared/permissions.ts`:

```
firehose:manage     — create/update/delete firehose connections (admin)
firehose:read       — view connection status and health (admin)
firehose:read-own   — agent reads its own firehose messages
```

Default role assignments:
- **Hub Admin**: `firehose:manage`, `firehose:read`
- **Firehose Agent** (machine role): `reports:create`, `reports:send-message-own`, `firehose:read-own`

---

## 11. Database Schema (New Tables)

### firehose_connections

```sql
CREATE TABLE firehose_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID NOT NULL REFERENCES hubs(id),
  signal_group_id TEXT,                          -- null until auto-detected
  display_name TEXT NOT NULL DEFAULT '',
  encrypted_display_name TEXT,                   -- hub-key encrypted
  report_type_id UUID NOT NULL REFERENCES report_types(id),
  agent_pubkey TEXT NOT NULL,                    -- hex, 64 chars
  encrypted_agent_nsec TEXT NOT NULL,            -- sealed with deploy secret
  geo_context TEXT,                               -- e.g., "Minneapolis, MN, North"
  geo_context_country_codes TEXT[],               -- ISO 3166-1 alpha-2
  inference_endpoint TEXT,                       -- null = use default
  extraction_interval_sec INTEGER NOT NULL DEFAULT 60,
  system_prompt_suffix TEXT,
  buffer_ttl_days INTEGER NOT NULL DEFAULT 7,
  notify_via_signal BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending|active|paused|disabled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### firehose_message_buffer

```sql
CREATE TABLE firehose_message_buffer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES firehose_connections(id) ON DELETE CASCADE,
  signal_timestamp TIMESTAMPTZ NOT NULL,
  encrypted_content TEXT NOT NULL,               -- agent-key encrypted
  encrypted_sender_info TEXT NOT NULL,            -- agent-key encrypted
  cluster_id UUID,                               -- null until clustered
  extracted_report_id UUID,                       -- null until report submitted
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_firehose_buffer_connection ON firehose_message_buffer(connection_id);
CREATE INDEX idx_firehose_buffer_expires ON firehose_message_buffer(expires_at);
CREATE INDEX idx_firehose_buffer_unextracted
  ON firehose_message_buffer(connection_id)
  WHERE extracted_report_id IS NULL;
```

### firehose_notification_optouts

```sql
CREATE TABLE firehose_notification_optouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES firehose_connections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, user_id)
);
```

---

## Dependencies

- Existing: MessagingAdapter (Signal), report types, custom fields, PBAC, geocoding adapter, Nostr relay, envelope encryption
- New containers: vLLM (optional, only when connections exist)
- New env vars: `FIREHOSE_AGENT_SEAL_KEY`, `FIREHOSE_INFERENCE_URL`
- New npm: `openai` (JS SDK for vLLM OpenAI-compatible API)
- New crypto labels: 3 domain separation constants in `crypto-labels.ts`
