---
title: "Ban Lists and Spam Prevention"
description: "Managing banned numbers, voice CAPTCHA, and rate limiting to protect your hotline from abuse."
audience: [operator]
task: [configuration, troubleshooting]
feature: "bans"
order: 10
---

Spam and abusive callers can overwhelm a hotline. The system gives you several tools to deal with this, all manageable in real time.

## Managing the ban list

Go to the **Bans** page to block specific phone numbers.

**To ban a single number:** Type the phone number in international format (for example, +15551234567) and add it. The ban takes effect immediately — the caller will hear a rejection message and be disconnected.

**To ban multiple numbers at once:** Use the bulk import feature. Paste a list of phone numbers, one per line, and submit. This is useful if you have a list of known abusive numbers from a previous incident.

**To unban a number:** Find it in the ban list and remove it. The change is instant.

## Voice CAPTCHA

Voice CAPTCHA adds a simple verification step before a caller reaches your team. When enabled, the caller hears a randomly generated 4-digit code and must enter it on their keypad. This stops automated robocalls and simple spam bots.

Turn it on or off in **Settings** under Spam Mitigation. You can toggle it at any time — for example, turn it on during a spam attack and off when things calm down.

## Rate limiting

Rate limiting restricts how many times a single phone number can call within a set time window. This prevents a single caller from flooding your line.

Toggle rate limiting on or off in **Settings** under Spam Mitigation.

## Dealing with a spam attack

If your hotline is receiving a high volume of spam calls:

1. **Enable voice CAPTCHA** immediately — this blocks most automated calls
2. **Enable rate limiting** to slow down repeat callers
3. **Ban known numbers** using bulk import if you can identify a pattern
4. **Check the call log** on the Calls page to identify numbers that are calling repeatedly

All of these changes take effect in real time. You do not need to restart anything.

## Staff reporting

Staff members can flag a caller as spam during an active call using the **Report Spam** button. This adds the number to the ban list automatically.
