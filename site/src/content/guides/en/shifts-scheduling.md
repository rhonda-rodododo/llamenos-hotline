---
title: "Shifts and Scheduling"
description: "Creating shifts, assigning team members, and configuring fallback behavior."
audience: [operator]
task: [configuration, daily-use]
feature: "shifts"
order: 5
---

Shifts determine who receives calls and when. The system uses your shift schedule to decide which staff members to ring when a call comes in.

## Creating a shift

Go to the **Shifts** page and click **Add Shift**. For each shift, you will set:

- **Name** — a label like "Morning Shift" or "Weekend Coverage"
- **Days of the week** — which days this shift repeats on
- **Start and end times** — when the shift begins and ends each day
- **Assigned staff** — which team members are on this shift

Use the searchable dropdown to add multiple staff members to a single shift.

## How shift routing works

When a call comes in, the system checks which shift is currently active. All staff members assigned to that shift are rung simultaneously — this is called parallel ringing. The first person to answer gets the call.

If a staff member has turned on **break mode**, they will not be rung even if they are assigned to the active shift.

## Recurring schedules

Shifts repeat automatically on the days you select. You do not need to recreate them each week. If you need to make a one-time change, edit the shift temporarily and change it back later.

## Fallback group

At the bottom of the Shifts page, you can configure a **Fallback Group**. These are staff members who will be rung when:

- No shift is currently active
- The active shift has no available staff (everyone is on break or offline)

Think of the fallback group as your safety net — it ensures someone is always reachable.

## Tips for scheduling

- Overlapping shifts are fine — staff on both shifts will all ring
- Assign at least two people per shift so calls are covered if someone steps away
- Review your fallback group regularly to make sure it includes active staff members
