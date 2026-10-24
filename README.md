# SupplyPilot AI

**AI-Powered Supplier Follow-up & Procurement Discrepancy Assistant for Malaysian SMEs**

Built for **SDC Hackathon 2026 — Domain 2**.

## Live Demo

**[Launch SupplyPilot AI](https://supply-pilot-ai.replit.app/)**

## Overview

SupplyPilot AI helps small and medium-sized businesses identify supplier confirmation problems before delivery day.

The application compares supplier messages against purchase orders, extracts supporting evidence using AI, identifies quantity shortages and delivery delays, and prepares follow-up messages for human review.

The project demonstrates an Orbyte-compatible procurement workflow module using synthetic business data.

## Key Features

- **AI-powered message extraction:** Uses OpenAI via Replit AI Integrations to extract quantities, availability, delivery dates and supporting evidence.
- **Deterministic discrepancy detection:** Compares extracted information against purchase-order requirements using TypeScript business rules.
- **Evidence-based results:** Shows relevant excerpts from supplier messages for review.
- **Human approval:** Demonstrates Staff and Owner roles with Approve and Reject actions.
- **Editable follow-up drafts:** Allows users to review and modify messages before approval.
- **Activity Log:** Records review actions and decisions in browser storage.
- **Rule-based fallback:** Keeps the core analysis available if the AI service fails.
- **AI usage protection:** Includes basic rate limiting, a configurable daily request limit and duplicate-request handling.

## Demonstration Workflow

1. Select a supplier message associated with purchase order PO-1024.
2. Run AI extraction and compare the message against the ordered products.
3. Review identified shortages, unavailable products and delivery delays.
4. Edit the suggested supplier follow-up message.
5. Switch to the simulated Owner role and approve or reject the review.
6. Inspect the Activity Log and review history.

**Note:** Approval does not automatically send a message to the supplier.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express |
| AI | OpenAI via Replit AI Integrations |
| Data validation | Zod |
| Business logic | Deterministic TypeScript |
| Demo persistence | Browser localStorage |
| Hosting | Replit Autoscale |
| Version control | Git and GitHub |

## Repository Structure

- `artifacts/supplypilot-ai/` — Frontend application
- `artifacts/api-server/` — Express backend and AI extraction
- `lib/` — Shared packages, schemas and utilities
- `scripts/` — Workspace scripts
- `.replit` — Replit application configuration
- `pnpm-workspace.yaml` — Monorepo workspace configuration

## Running the Project

The project uses a pnpm workspace and is configured for development and deployment on Replit.

For the supported Replit workflow, open the project in Replit and use its configured application run process.

The production build is available through:

```bash
pnpm run build:supplypilot
```

AI credentials must be configured securely on the backend through Replit AI Integrations. Do not commit credentials or expose them in browser code.

## Testing

The current MVP includes automated tests covering supplier analysis, API behavior, approval workflows and usage protection.

The deployed application has also been manually tested using synthetic supplier messages.

## Security and MVP Limitations

This is a hackathon prototype, not a production procurement system.

- Purchase-order data is synthetic.
- Staff/Owner switching demonstrates the approval flow; it is not production authentication.
- Activity history is stored locally in the browser, not in a centralized audit database.
- AI request limits are process-local rather than account-level billing guarantees.
- The application does not automatically send supplier messages or process payments.
- Real supplier or commercially sensitive data should not be submitted to the public demo.

## License

Apache License 2.0. See `LICENSE` for details.

## Replit Utilisation Evidence

This project was developed, AI-integrated, tested, and deployed using Replit.

[View Replit Development, AI Integration, and Deployment Evidence](https://github.com/DouHuaHua-Cathy/SupplyPilot-AI/tree/main/docs/evidence)
