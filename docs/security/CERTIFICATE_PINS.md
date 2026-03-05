# Certificate Pins

Shared reference for iOS (URLSessionDelegate) and Android (OkHttp CertificatePinner).

## Extracting Pins

```bash
# Primary pin — Cloudflare intermediate CA
openssl s_client -connect app.llamenos.org:443 -servername app.llamenos.org < /dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | base64

# Backup pin — Cloudflare root CA (leaf cert)
openssl s_client -connect app.llamenos.org:443 -servername app.llamenos.org -showcerts < /dev/null 2>/dev/null \
  | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/{print}' \
  | tail -n +$(awk '/BEGIN CERTIFICATE/{n++}n==2{print NR;exit}' <(openssl s_client -connect app.llamenos.org:443 -servername app.llamenos.org -showcerts < /dev/null 2>/dev/null)) \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | base64
```

## Current Pins

> **TODO**: Populate after first production deployment to `app.llamenos.org`.
> Run the extraction commands above and update these values.
> Both iOS and Android reference these pins.

| Purpose | SHA-256 Base64 |
|---------|---------------|
| Primary (intermediate CA) | `REPLACE_AFTER_DEPLOYMENT` |
| Backup (root CA) | `REPLACE_AFTER_DEPLOYMENT` |

## Domains

- `*.llamenos.org` (API, relay, app)

## Rotation Procedure

1. Extract new pins using the commands above
2. Update this file
3. Update iOS: `apps/ios/Sources/Services/APIService.swift` (CertificatePinningDelegate)
4. Update Android: `apps/android/app/src/main/kotlin/org/llamenos/hotline/api/ApiService.kt` (CertificatePinner)
5. Deploy mobile updates before certificate rotation takes effect
6. Keep the old pin as backup for at least one release cycle
