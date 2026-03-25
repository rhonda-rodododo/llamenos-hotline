# Telephony Webhook Setup

## How calls reach the app

Cloud telephony providers (Twilio, Plivo, SignalWire, Vonage) route incoming calls to your application via **webhook URLs** configured on the phone number. When a call arrives, the provider sends an HTTP POST to the configured voice URL. The app handles everything from there: IVR language menu, volunteer ringing, hold music, voicemail recording, and call completion.

There is no provider-side voicemail -- all voicemail logic runs in the application. If the webhook is misconfigured, calls will not reach the app at all.

## Webhook verification

Admins can verify webhook configuration from the settings page. The system calls `GET /api/settings/telephony-provider/verify-webhook` which:

1. Queries the telephony provider's API for the phone number's current voice webhook URL
2. Compares it against the expected URL (`APP_URL/api/telephony/incoming`)
3. Returns whether the configuration is correct, with the expected and actual URLs

### Provider-specific behavior

| Provider | Verification method |
|----------|-------------------|
| Twilio | Queries `IncomingPhoneNumbers` API for `voice_url` |
| SignalWire | Same as Twilio (API-compatible) |
| Plivo | Queries `Number` API for `voice_url` |
| Vonage | Not yet automated -- verify manually in the Vonage Dashboard |
| Asterisk | Always passes -- dialplan is self-hosted and controlled directly |

## Fixing a misconfigured webhook

If verification fails, update the phone number's voice webhook URL in the provider's console:

- **URL:** `https://<your-domain>/api/telephony/incoming`
- **Method:** POST
- **Status callback URL (optional):** `https://<your-domain>/api/telephony/call-status`

The `APP_URL` environment variable must be set to the public-facing base URL of the application for verification to work.
