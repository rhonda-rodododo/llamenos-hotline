# Design: Generic SIP Trunk Adapter

**Date:** 2026-04-03
**Status:** Draft

## Overview

A generic SIP trunk adapter that enables any standards-compliant SIP trunk provider to be used as the telephony backend. Instead of provider-specific API integrations, the adapter routes calls through a local Asterisk or FreeSWITCH PBX that terminates SIP trunks — the PBX handles protocol translation while the adapter manages call control via ARI/ESL.

## Why Generic SIP?

Most telephony happens over SIP. Hundreds of providers offer SIP trunking:

- **Budget carriers:** VoIP.ms, Callcentric, Localphone
- **Business carriers:** Flowroute (Intrado), Bandwidth SIP, Lumen
- **Regional carriers:** Local telcos offering SIP service
- **Existing infrastructure:** Organizations with existing SIP trunks from their PBX vendor

A generic adapter means operators configure their SIP trunk credentials once and get full hotline functionality — no provider-specific code needed.

## Architecture

```
Caller → PSTN → SIP Trunk Provider → Asterisk/FreeSWITCH → ARI/ESL → Llamenos
                                    ↕
                        Volunteer ← WebRTC (browser) or Phone (outbound SIP)
```

The generic SIP trunk adapter is NOT a new TelephonyAdapter implementation. Instead, it extends the existing **AsteriskAdapter** (or a future FreeSWITCH adapter) by:

1. **Auto-configuring SIP trunk registration** in the PBX via ARI/ESL dynamic config
2. **Providing a setup UI** for operators to enter trunk credentials
3. **Supporting both registration-based and IP-based trunk auth**

### How It Works

1. Operator enters SIP trunk details in the admin UI (provider domain, credentials, codec prefs)
2. The setup flow provisions a PJSIP trunk in Asterisk via ARI `configureDynamic`:
   - Registration endpoint pointing at the trunk provider
   - Inbound context routing to Llamenos
   - Outbound routing via the trunk for parallel ring
3. Call handling uses the existing AsteriskAdapter — no new call control code
4. The adapter tests connectivity by attempting SIP OPTIONS or REGISTER

### Trunk Configuration Schema

```typescript
interface SipTrunkConfig {
  // Provider connection
  trunkDomain: string; // e.g., 'sip.voip.ms', 'sip.flowroute.com'
  trunkPort?: number; // default 5060 (UDP) or 5061 (TLS)
  transport?: "udp" | "tcp" | "tls"; // default 'udp'

  // Authentication (one of two modes)
  authType: "registration" | "ip-based";

  // Registration-based auth
  username?: string;
  password?: string;
  authUsername?: string; // sometimes different from SIP username

  // IP-based auth (trunk provider allowlists your IP)
  // No credentials needed, just configure the trunk domain

  // Media
  codecs?: string[]; // ['ulaw', 'alaw', 'g722', 'opus'] — order = preference
  dtmfMode?: "rfc2833" | "inband" | "info"; // default rfc2833

  // TLS (for secure trunks)
  tlsVerify?: boolean; // verify provider's TLS cert

  // DID routing
  didNumber: string; // the phone number assigned by the trunk provider (E.164)
}
```

### PJSIP Dynamic Configuration

When a SIP trunk is configured, the adapter provisions these PJSIP objects via ARI:

```
[trunk-{id}]                    ; auth
type = auth
auth_type = userpass
username = {config.username}
password = {config.password}

[trunk-{id}]                    ; aor (address of record)
type = aor
contact = sip:{config.trunkDomain}:{config.trunkPort}
qualify_frequency = 60

[trunk-{id}]                    ; registration
type = registration
server_uri = sip:{config.trunkDomain}
client_uri = sip:{config.username}@{config.trunkDomain}
outbound_auth = trunk-{id}

[trunk-{id}]                    ; endpoint
type = endpoint
transport = transport-{config.transport}
context = from-trunk
outbound_auth = trunk-{id}
aors = trunk-{id}
from_user = {config.didNumber}
from_domain = {config.trunkDomain}
allow = !all,{config.codecs.join(',')}
dtmf_mode = {config.dtmfMode}
```

### Inbound Call Routing

Calls arriving on the trunk are routed to the `from-trunk` context in Asterisk's dialplan, which routes to the Llamenos Stasis app — same as direct Asterisk calls.

### Outbound Call Routing

When parallel ringing volunteers, outbound calls route through the trunk endpoint instead of direct PSTN.

## Admin UI

The setup wizard gets a new "SIP Trunk" provider option with:

1. **Provider selection** — common presets (VoIP.ms, Flowroute, sipgate) with pre-filled domains/ports, or "Custom" for manual entry
2. **Credentials** — username/password for registration, or "IP-based" toggle
3. **Phone number** — the DID assigned by the trunk provider
4. **Advanced** — codecs, DTMF mode, transport, TLS
5. **Test connection** — attempts SIP REGISTER/OPTIONS and reports success/failure

## Provider Presets

| Provider    | Domain                         | Port | Transport | Auth         | Notes                 |
| ----------- | ------------------------------ | ---- | --------- | ------------ | --------------------- |
| VoIP.ms     | `{city}.voip.ms`               | 5060 | UDP       | Registration | City-specific servers |
| Flowroute   | `us-west-or.sip.flowroute.com` | 5060 | UDP       | IP-based     | Regional endpoints    |
| sipgate     | `sipgate.de`                   | 5060 | TLS       | Registration | European              |
| Callcentric | `callcentric.com`              | 5060 | UDP       | Registration |                       |
| Twilio SIP  | `{sid}.pstn.twilio.com`        | 5060 | TLS       | IP + token   | Elastic SIP Trunking  |
| Telnyx SIP  | `sip.telnyx.com`               | 5060 | TLS       | Registration |                       |

## Files

| File                                             | Action | Description                          |
| ------------------------------------------------ | ------ | ------------------------------------ |
| `src/shared/schemas/providers.ts`                | Modify | Add SipTrunkConfigSchema             |
| `src/server/telephony/sip-trunk-provisioner.ts`  | Create | PJSIP dynamic trunk config via ARI   |
| `src/server/provider-setup/sip-trunk.ts`         | Create | Setup capabilities (test, provision) |
| `src/server/telephony/sip-trunk-capabilities.ts` | Create | ProviderCapabilities for SIP trunks  |
| `src/client/components/setup/SipTrunkForm.tsx`   | Create | Admin UI form with presets           |

## Dependencies

- Requires Asterisk or FreeSWITCH running (existing Docker setup)
- Uses AsteriskProvisioner pattern from `asterisk-provisioner.ts`
- Extends existing bridge-client for ARI communication

## Testing

- Unit tests: PJSIP config generation, preset selection
- Integration: SIP REGISTER against a mock SIP server (or real VoIP.ms test account)
- E2E: Full call flow through SIP trunk (requires real trunk credentials)
