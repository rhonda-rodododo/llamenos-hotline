---
title: "Your Data Protection"
description: "How your data is kept safe, what your PIN does, and what happens if you lose access."
audience: [operator, staff]
task: [security, setup]
feature: "encryption"
order: 7
---

Your hotline encrypts sensitive data so that even the server cannot read it. This guide explains what that means for you in plain terms — no technical background needed.

## Your PIN protects your keys

When you set up your account, the system creates a pair of cryptographic keys that belong only to you. Think of them as a lock and key — one encrypts data, the other decrypts it.

Your **PIN** protects these keys on your device. When you lock the app or close your browser, your keys are sealed. When you enter your PIN, they are unlocked so you can read your data.

**Choose a strong PIN and remember it.** Without it, your keys stay locked.

## What is encrypted

- **Call notes** — encrypted before they leave your browser. Only you and your operators can read them.
- **Contact information** — names, phone numbers, and other personal details are encrypted.
- **Messages** — conversations over SMS, WhatsApp, and Signal are encrypted when stored.
- **Reports** — report content and attachments are encrypted before upload.
- **Organization data** — shift names, role names, and other internal labels are encrypted with a shared key.

The server stores only scrambled data. Even if someone broke into the database, they would not be able to read it.

## Device linking

If you use the hotline on more than one device (for example, your computer and your phone), you can link them. Go to **Settings** and use the **Link Device** option. This securely transfers your keys to the new device without exposing them to the server.

## What happens if you lose access

If you forget your PIN or lose your device, see the [Account Recovery](/guides/en/account-recovery) guide. The short version: your recovery key (created during setup) or your operator can help you regain access.

## For operators

You hold a special responsibility — your keys can decrypt data that belongs to your team members. Keep your credentials secure, use a hardware security key if available, and follow your organization's security procedures.
