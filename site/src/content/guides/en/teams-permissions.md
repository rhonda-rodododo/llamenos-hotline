---
title: "Teams and Permissions"
description: "Creating teams, assigning roles, and controlling what people can see and do."
audience: [operator]
task: [configuration, security]
feature: "permissions"
order: 6
---

Teams and roles let you control who can see and do what in your hotline. This is especially important if your organization has different groups with different responsibilities.

## Default roles

The system comes with three built-in roles:

- **Operator** — full access to everything: settings, users, shifts, bans, audit log, and all data
- **Staff** — can answer calls, write notes, view conversations, and submit reports
- **Reporter** — can only submit and view their own reports, plus the help page

## Creating teams

Go to the **Users** page to manage your team structure. Teams let you group staff members together — for example, by language spoken, by expertise area, or by location.

Teams affect:

- **Shift assignment** — assign entire teams to shifts instead of individuals
- **Contact access** — control which teams can view or edit the contact directory
- **Message routing** — incoming messages can be auto-assigned to specific teams

## Custom roles

If the default roles do not fit your needs, you can create custom roles with specific permissions. This lets you give someone more access than a basic staff member without making them a full operator.

## How permissions work

Permissions control visibility and actions:

- **What people can see** — a staff member only sees their own notes, while an operator sees all notes and the audit log
- **What people can do** — only operators can change settings, manage bans, or invite new members
- **Data boundaries** — reporters cannot see call records, staff information, or operator settings

## Inviting new members

From the **Users** page, click **Create Invite Link**. Choose the role for the new member. Share the link — it can only be used once. The person who opens it will create their own credentials.

## Removing access

To remove someone, go to their profile on the Users page and deactivate their access. This takes effect immediately.
