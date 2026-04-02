---
title: "Account Recovery"
description: "What to do if you forget your PIN, lose your device, or need help regaining access."
audience: [operator, staff]
task: [troubleshooting, security]
feature: "recovery"
order: 15
---

Losing access to your account can be stressful, especially if you need it for your shift. This guide covers the most common situations and how to get back in.

## If you forgot your PIN

Your PIN protects the encryption keys stored on your device. If you forget it:

1. **Try your recovery key.** During initial setup, you were given a recovery key (or had the option to save one). If you saved it in a password manager or wrote it down, use it to unlock your account.
2. **Contact your operator.** If you do not have your recovery key, your operator can help you through the re-enrollment process (see below).

Your PIN cannot be reset by the server — this is a security feature, not a limitation. It means nobody (not even someone with access to the server) can unlock your data without your PIN or recovery key.

## If you lost your device

If your phone or computer was lost or stolen:

1. **Contact your operator immediately.** They can deactivate your session to prevent unauthorized access.
2. **Log in on a new device.** Use your secret key (nsec) or recovery key to log in on another device.
3. **Set a new PIN** on the new device.

If you had a passkey (hardware security key or biometric) registered, you may be able to log in on a new device using that.

## Re-enrollment

If you have lost both your PIN and your recovery key, your operator can initiate a re-enrollment:

1. The operator deactivates your current account
2. They create a new invite link for you
3. You open the link and create a fresh set of credentials
4. You set a new PIN on your device

**Important:** Re-enrollment creates new encryption keys. This means you will not be able to read notes or data that were encrypted with your old keys. Your operator still has access to that data through their own keys.

## For operators: helping team members

When a team member is locked out:

1. Go to **Users** and find their profile
2. Deactivate their current access if their device may be compromised
3. Create a new invite link with their original role
4. Share the link through a secure channel

Make sure to verify the person's identity before re-enrolling them — someone pretending to be a locked-out team member is a common social engineering tactic.

## Prevention

- Save your recovery key in a password manager during setup
- Register a passkey (hardware key or biometric) as a backup login method
- If you use multiple devices, link them so you have a fallback
