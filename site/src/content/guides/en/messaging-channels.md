---
title: "Messaging Channels"
description: "Setting up SMS, WhatsApp, and Signal so your team can receive and respond to text messages."
audience: [operator]
task: [setup, configuration]
feature: "messaging"
order: 8
---

Your hotline can receive messages over SMS, WhatsApp, and Signal in addition to voice calls. Messages arrive in a unified **Conversations** view where your team can read and respond.

## Setting up SMS

SMS uses the same telephony provider as your voice calls (Twilio, SignalWire, Vonage, or Plivo). To enable it:

1. Go to **Settings** and find the messaging section
2. Toggle **SMS** on
3. Configure a welcome message — this is the automatic reply sent when someone texts your number for the first time
4. Point your provider's SMS webhook to your hotline's SMS endpoint (shown in settings)

## Setting up WhatsApp

WhatsApp requires a Meta Cloud API account. To enable it:

1. Toggle **WhatsApp** on in settings
2. Enter your Meta Cloud API credentials: access token, verify token, and phone number ID
3. Configure your WhatsApp webhook in the Meta dashboard to point to your hotline's WhatsApp endpoint

WhatsApp has a 24-hour messaging window — you can only reply to someone within 24 hours of their last message. After that, you need to use a pre-approved template message to restart the conversation.

## Setting up Signal

Signal uses a bridge service called signal-cli. To enable it:

1. Toggle **Signal** on in settings
2. Enter the bridge URL and phone number
3. The system monitors the bridge health and will warn you if the connection drops

## How messages flow in

When someone sends a message to your hotline number, it appears in the **Conversations** page. Each conversation is threaded by sender, so you can see the full history with that person.

Messages are encrypted when stored — the server discards the original text immediately after encrypting it.

## Auto-assignment

Incoming messages can be automatically assigned to the team member on shift, or you can configure them to go to a specific team. Staff members respond directly from the conversation view, and their reply goes back through the same channel the person used.
