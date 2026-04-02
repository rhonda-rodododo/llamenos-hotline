---
title: दस्तावेज़ीकरण
description: Llamenos को तैनात, कॉन्फ़िगर और उपयोग करना सीखें।
guidesHeading: गाइड
guides:
  - title: शुरू करना
    description: पूर्वापेक्षाएँ, इंस्टॉलेशन, टेलीफ़ोनी सेटअप, और आपकी पहली तैनाती।
    href: /docs/getting-started
  - title: एडमिन गाइड
    description: वॉलंटियर, शिफ्ट, बैन सूची, कस्टम फ़ील्ड, और सेटिंग्स प्रबंधित करें।
    href: /docs/admin-guide
  - title: वॉलंटियर गाइड
    description: लॉग इन करें, कॉल प्राप्त करें, नोट्स लिखें, और ट्रांसक्रिप्शन का उपयोग करें।
    href: /docs/volunteer-guide
  - title: टेलीफ़ोनी प्रदाता
    description: समर्थित टेलीफ़ोनी प्रदाताओं की तुलना करें और अपनी हॉटलाइन के लिए सबसे उपयुक्त चुनें।
    href: /docs/telephony-providers
  - title: "सेटअप: Twilio"
    description: Twilio को अपने टेलीफ़ोनी प्रदाता के रूप में कॉन्फ़िगर करने की चरण-दर-चरण गाइड।
    href: /docs/setup-twilio
  - title: "सेटअप: SignalWire"
    description: SignalWire को अपने टेलीफ़ोनी प्रदाता के रूप में कॉन्फ़िगर करने की चरण-दर-चरण गाइड।
    href: /docs/setup-signalwire
  - title: "सेटअप: Vonage"
    description: Vonage को अपने टेलीफ़ोनी प्रदाता के रूप में कॉन्फ़िगर करने की चरण-दर-चरण गाइड।
    href: /docs/setup-vonage
  - title: "सेटअप: Plivo"
    description: Plivo को अपने टेलीफ़ोनी प्रदाता के रूप में कॉन्फ़िगर करने की चरण-दर-चरण गाइड।
    href: /docs/setup-plivo
  - title: "सेटअप: Asterisk (सेल्फ़-होस्टेड)"
    description: अधिकतम गोपनीयता और नियंत्रण के लिए ARI ब्रिज के साथ Asterisk तैनात करें।
    href: /docs/setup-asterisk
  - title: WebRTC ब्राउज़र कॉलिंग
    description: WebRTC का उपयोग करके वॉलंटियर्स के लिए ब्राउज़र में कॉल उत्तर देना सक्षम करें।
    href: /docs/webrtc-calling
  - title: सुरक्षा मॉडल
    description: समझें कि क्या एन्क्रिप्ट किया गया है, क्या नहीं, और थ्रेट मॉडल क्या है।
    href: /security
---

## आर्किटेक्चर अवलोकन

Llamenos एक सेल्फ़-होस्टेड सिंगल-पेज एप्लिकेशन (SPA) है जो **Docker Compose** या **Kubernetes** के माध्यम से तैनात किया जाता है। यह वॉइस कॉल, SMS, WhatsApp और Signal का समर्थन करता है — सभी एक एकीकृत इंटरफ़ेस के माध्यम से ड्यूटी पर मौजूद कर्मचारियों को रूट किया जाता है।

| घटक | तकनीक |
|---|---|
| फ्रंटएंड | Vite + React + TanStack Router |
| बैकएंड | Bun + Hono + PostgreSQL |
| स्टोरेज | RustFS (S3-संगत) |
| पहचान प्रदाता | Authentik (सेल्फ़-होस्टेड OIDC) |
| टेलीफ़ोनी | Twilio, SignalWire, Vonage, Plivo, या Asterisk |
| मैसेजिंग | SMS, WhatsApp Business, Signal |
| प्रमाणीकरण | JWT + मल्टी-फ़ैक्टर KEK + WebAuthn पासकी |
| एन्क्रिप्शन | ECIES (secp256k1 + XChaCha20-Poly1305), 3 स्तर |
| ट्रांसक्रिप्शन | क्लाइंट-साइड Whisper (WASM) — ऑडियो कभी ब्राउज़र नहीं छोड़ता |
| रियल-टाइम | Nostr रिले (strfry) |
| बहुभाषा समर्थन | i18next (13 भाषाएँ) |

## भूमिकाएँ

| भूमिका | क्या देख सकता है | क्या कर सकता है |
|---|---|---|
| **कॉलर** | कुछ नहीं (GSM फ़ोन) | हॉटलाइन नंबर पर कॉल करना |
| **वॉलंटियर** | केवल अपने नोट्स | कॉल का उत्तर देना, शिफ्ट के दौरान नोट्स लिखना |
| **एडमिन** | सभी नोट्स, ऑडिट लॉग, कॉल डेटा | वॉलंटियर, शिफ्ट, बैन, सेटिंग्स प्रबंधित करना |
