# Doc Site Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the doc site with 4-section IA (About/Guides/Deploy/Reference), tag-based guide articles, Pagefind search, and complete content rewrite for current system.

**Architecture:** Astro static site with 3 content collections (docs, pages, guides). Pagefind indexes at build time. Tag filtering via client-side JS. URL redirects via Astro pages. Mobile-first responsive design using existing Tailwind design system.

**Tech Stack:** Astro 5.7, Tailwind CSS 4, astro-pagefind, existing shadcn-inspired design tokens

**Spec:** `docs/superpowers/specs/2026-04-01-doc-site-redesign-design.md`

---

## Task 1: Site Architecture — Content Collection + Pagefind + Layouts

**Files:**
- Modify: `site/package.json` (add astro-pagefind)
- Modify: `site/astro.config.mjs` (add pagefind integration)
- Modify: `site/src/content.config.ts` (add guides collection)
- Create: `site/src/layouts/GuidesLayout.astro` (guide article layout with tags)
- Modify: `site/src/layouts/DocsLayout.astro` (new sidebar structure + search)
- Create: `site/src/pages/docs/guides/index.astro` (guides hub with tag filtering)
- Create: `site/src/pages/docs/guides/[...slug].astro` (individual guide pages)
- Create: `site/src/pages/docs/reference/index.astro` (reference hub)
- Create: `site/src/components/SearchBar.astro` (Pagefind search component)
- Create: `site/src/components/TagFilter.astro` (tag filter pills component)
- Modify: `site/src/i18n/translations/common.ts` (new section/tag labels)

Steps:
- [ ] Install astro-pagefind: `cd site && bun add astro-pagefind`
- [ ] Add pagefind to astro.config.mjs integrations
- [ ] Add `guides` collection to content.config.ts with audience/task/feature/order schema
- [ ] Export updated collections
- [ ] Create SearchBar.astro component — Pagefind search input with dropdown results, mobile-friendly
- [ ] Create TagFilter.astro component — horizontal pill bar with audience + task filters, URL query param sync, mobile horizontal scroll
- [ ] Update DocsLayout.astro sidebar — 4-section structure (About, Guides, Deploy/Providers, Reference), search bar at top, current section highlighting
- [ ] Create GuidesLayout.astro — extends DocsLayout, adds tag badges at top of article, "Related guides" section at bottom
- [ ] Create guides hub page (docs/guides/index.astro) — tag filter bar + card grid, client-side JS filtering, responsive grid
- [ ] Create guide article dynamic route (docs/guides/[...slug].astro) — loads guide content, renders in GuidesLayout
- [ ] Create reference hub page (docs/reference/index.astro) — links to protocol spec, architecture docs, API docs, security docs
- [ ] Add new i18n keys to common.ts for all 13 locales: section labels, audience labels, task labels, search placeholder
- [ ] Verify site builds: `cd site && bun run build`
- [ ] Commit

---

## Task 2: Security Page Rewrite

**Files:**
- Modify: `site/src/content/pages/en/security.md`

Steps:
- [ ] Read current security.md and the updated docs/security/ files for technical accuracy
- [ ] Rewrite preserving the plain-language "what can they see" voice and table-driven structure
- [ ] Update subpoena table: add volunteer names (E2EE), contact records (E2EE), message content (E2EE) to "CANNOT provide"; update decryption key description for multi-factor
- [ ] Update voice calls section: transcription is now client-side ("audio processed entirely in your browser using on-device AI")
- [ ] Update text messaging section: server storage → "Encrypted", remove "Future improvement" for E2EE messaging (shipped), add provider retention caveat
- [ ] Update notes section: add field-level encryption, multi-factor device seizure analysis
- [ ] Update volunteer identity section: names → E2EE, subpoena → "Ciphertext only"
- [ ] Replace "What's planned" with "Recently shipped" section: E2EE messaging, client-side transcription, reproducible builds, multi-factor keys, hardware security keys, contact directory. Keep "Planned": native apps
- [ ] Update summary table: all current encryption statuses, add contact records/team metadata/custom fields rows
- [ ] Update "For security auditors" links
- [ ] Commit

---

## Task 3: Features Page Rewrite

**Files:**
- Modify: `site/src/content/pages/en/features.md`

Steps:
- [ ] Read current features.md
- [ ] Update subtitle: remove "Cloudflare Workers" → "self-hosted for maximum control"
- [ ] Update transcription: "on-device AI (Whisper)" — audio never leaves browser
- [ ] Update spam mitigation: "database-backed storage" (not Durable Objects)
- [ ] Rewrite auth section: multi-factor KEK, IdP, invite-based onboarding, Web Worker isolation, remote revocation, device linking
- [ ] Add Contact Directory section: encrypted contacts, teams, tags, bulk ops, auto-linking, intake
- [ ] Add Configurable Permissions section: PBAC, custom roles, team scoping
- [ ] Update messaging: stored encrypted, "real-time updates" (not WebSocket)
- [ ] Update admin dashboard: setup wizard for IdP, invite links (not nsec generation)
- [ ] Commit

---

## Task 4: Guide Articles (15 articles)

**Files:**
- Create: `site/src/content/guides/en/getting-started.md`
- Create: `site/src/content/guides/en/call-handling.md`
- Create: `site/src/content/guides/en/voicemail.md`
- Create: `site/src/content/guides/en/contact-directory.md`
- Create: `site/src/content/guides/en/shifts-scheduling.md`
- Create: `site/src/content/guides/en/teams-permissions.md`
- Create: `site/src/content/guides/en/encryption-keys.md`
- Create: `site/src/content/guides/en/messaging-channels.md`
- Create: `site/src/content/guides/en/reports-submissions.md`
- Create: `site/src/content/guides/en/ban-lists-spam.md`
- Create: `site/src/content/guides/en/transcription.md`
- Create: `site/src/content/guides/en/browser-calling.md`
- Create: `site/src/content/guides/en/notifications-presence.md`
- Create: `site/src/content/guides/en/data-export.md`
- Create: `site/src/content/guides/en/account-recovery.md`

Steps:
- [ ] Read existing admin-guide.md, volunteer-guide.md, reporter-guide.md for content to redistribute
- [ ] Read the app's actual UI and features (check routes, components) to write accurate guides
- [ ] Write all 15 guide articles with correct frontmatter (title, description, audience, task, feature, order)
- [ ] Each article: plain language, step-by-step where appropriate, no jargon, audience-aware
- [ ] Verify all guides load: `cd site && bun run build`
- [ ] Commit

---

## Task 5: Deploy Guide Updates + URL Migration

**Files:**
- Create: `site/src/content/docs/en/deploy/index.md` (new deploy overview, replaces getting-started)
- Move + Update: existing deploy docs to `site/src/content/docs/en/deploy/` directory
- Move + Update: provider setup docs to `site/src/content/docs/en/deploy/providers/`
- Create: `site/src/pages/docs/deploy/index.astro`
- Create: `site/src/pages/docs/deploy/[...slug].astro`
- Create: `site/src/pages/docs/deploy/providers/[...slug].astro`
- Update: All 5 telephony setup guides — fix `/api/` prefix on webhook URLs
- Update: deploy-kubernetes — MinIO → RustFS, add IdP
- Update: deploy-coopcloud — MinIO → RustFS, add Authentik
- Update: All deploy guides — add Authentik services/secrets

Steps:
- [ ] Create new directory structure for deploy content
- [ ] Move and update existing deployment guide content files
- [ ] Move and update provider setup content files
- [ ] Create Astro page routes for deploy section
- [ ] Fix webhook URLs in all 5 telephony setup guides (add `/api/` prefix)
- [ ] Update deploy-kubernetes: RustFS, IdP Helm values
- [ ] Update deploy-coopcloud: RustFS, Authentik service
- [ ] Update all deploy guides: add Authentik to services tables, add IdP secret generation
- [ ] Update getting-started → deploy overview: IdP auth flow, invite-based onboarding
- [ ] Verify build
- [ ] Commit

---

## Task 6: URL Redirects

**Files:**
- Modify existing pages in `site/src/pages/docs/` to become redirects
- Create redirect pages for old URLs

Steps:
- [ ] Convert old doc page files (admin-guide.astro, volunteer-guide.astro, reporter-guide.astro, getting-started.astro, self-hosting.astro, deploy-docker.astro, deploy-kubernetes.astro, deploy-coopcloud.astro, setup-*.astro, telephony-providers.astro, webrtc-calling.astro) into 301 redirect pages using `Astro.redirect()`
- [ ] Map all old URLs to new URLs per the spec's migration table
- [ ] Verify all redirects work in dev: `cd site && bun run dev`
- [ ] Commit

---

## Task 7: Translation Stubs + i18n

**Files:**
- Create: `site/src/content/guides/{locale}/` stub files for all 12 non-English locales
- Update: existing locale doc files to match new structure
- Modify: `site/src/i18n/translations/common.ts`

Steps:
- [ ] Create guide stub files for all 12 locales (title + description translated, English body + "Translation coming soon" notice)
- [ ] Update existing locale doc content files to match new directory structure
- [ ] Add translation keys for new sections to common.ts
- [ ] Verify build with all locales
- [ ] Commit

---

## Task 8: Visual Verification + Mobile Audit

**Files:**
- No new files — verification only

Steps:
- [ ] Start dev server: `cd site && bun run dev`
- [ ] Use Playwright to screenshot key pages at desktop (1280px) and mobile (375px) widths
- [ ] Verify: Home page renders correctly
- [ ] Verify: Security page — tables readable on mobile, no horizontal overflow
- [ ] Verify: Features page — sections stack properly on mobile
- [ ] Verify: Guides hub — tag filter bar scrolls horizontally on mobile, cards stack
- [ ] Verify: Individual guide article — tags visible, related guides section works
- [ ] Verify: Deploy section — sidebar collapses on mobile
- [ ] Verify: Search — Pagefind search input works, results dropdown is usable on mobile
- [ ] Verify: Redirects — old URLs redirect to new locations
- [ ] Fix any visual issues found
- [ ] Final build: `cd site && bun run build`
- [ ] Commit any fixes
