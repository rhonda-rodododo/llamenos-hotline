---
title: "Getting Started"
description: "First-time setup for operators and staff — creating your account, setting your PIN, and learning the interface."
audience: [operator, staff]
task: [setup]
feature: "onboarding"
order: 1
---

Welcome to your hotline. This guide walks you through your first login and the basics of the interface.

## Creating your account

You will receive either an **invite link** or a **secret key** (a string starting with `nsec1`) from your operator. Both let you create your account.

**If you received an invite link:** Open it in your browser. The app will generate your credentials automatically. You will be asked to set a display name and choose your preferred language.

**If you received a secret key:** Open the app, paste the key into the login field, and sign in. Your key never leaves your browser — it is verified using cryptography, not by sending it to the server.

## Setting your PIN

After your first login, set a PIN to protect your local key storage. Your PIN locks and unlocks your credentials on this device. Choose something you will remember — if you lose it, you will need to go through account recovery.

## Understanding the interface

The sidebar on the left is your main navigation. What you see depends on your role:

- **Staff** see: Dashboard, Calls, Notes, Conversations, Reports, and Help.
- **Operators** see everything staff see, plus: Users, Shifts, Bans, Contacts, Settings, and Audit Log.

The **Dashboard** is your home screen. It shows active calls, your shift status, and who else is online.

Use the keyboard shortcut **Ctrl+K** (or **Cmd+K** on Mac) to open the command palette for quick navigation to any page.

## For operators: the setup wizard

If you are the first operator, the app will launch a **setup wizard** on your first login. This walks you through:

1. Naming your hotline
2. Choosing which channels to enable (voice, SMS, WhatsApp, Signal, reports)
3. Entering credentials for your telephony provider
4. Reviewing and confirming your settings

Once finished, invite your first team member from the **Users** page by creating an invite link.

## Installing as an app

For the best experience, install the hotline as a Progressive Web App. Your browser will offer an install prompt, or look for the install icon in the address bar. This gives you a dedicated window and better notification support.
