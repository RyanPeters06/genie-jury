# Genie Jury

**Pitch your idea. Face the jury.**

Genie Jury is a live, evidence-backed pitch stress test for hackathon builders. Four cloud-seated jurors challenge an idea, research risky claims, and return a constructive smallest-next-build plan.

## Current state

The project is **local, connected, and deploy-ready**. It does not deploy or provision cloud resources by default. The visual demo remains usable whenever a provider is unavailable.

```bash
npm install
copy .env.example .env.local
copy .dev.vars.example .dev.vars
npm run dev:full
```

Keep all provider keys in ignored `.dev.vars`; browser code receives no long-lived provider credentials.

## Read next

- [Agent handoff guide](AGENTS.md)
- [Product brief](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Demo runbook](docs/DEMO.md)
