---
name: SupplyPilot product scope
description: Product purpose and the explicit Stage 1 boundary for SupplyPilot AI.
---

SupplyPilot AI is a prototype for Malaysian small businesses to compare purchase orders with supplier messages and catch quantity or delivery discrepancies. It now supports server-side Replit AI Integrations using a fixed OpenAI model for evidence extraction, while deterministic TypeScript remains authoritative for PO comparisons. Keep rule-based fallback and the browser-only Staff/Owner demo workflow; do not connect WhatsApp or introduce production authentication/database without an explicit request.

**Why:** The user expanded the original Stage 1 scope after syncing the Stage 2/3 branch, and explicitly asked for managed AI credentials while preserving the prototype boundary.

**How to apply:** Keep extraction evidence-only, server-side, schema-validated, and backed by deterministic fallback. Do not add live messaging, production user controls, or cloud persistence unless the user asks.
