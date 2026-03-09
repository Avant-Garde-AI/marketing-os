# Marketing OS

> AI marketing operations for Shopify, powered by your git repo

Marketing OS is an open-source CLI + framework that transforms any Shopify store's GitHub-synced theme repository into an AI-powered marketing operations platform.

## Features

- **CLI Scaffolding** - `create-marketing-os` scaffolds an opinionated Next.js admin console into your existing Shopify theme repo
- **AI Marketing Agent** - Chat with your store's AI marketing agent powered by Mastra and Claude
- **Skills System** - Browse and execute reusable marketing automation skills
- **Async PR Pipeline** - Claude Code safely modifies your storefront via GitHub Actions and pull requests
- **Community Ecosystem** - Contribute and share marketing automation skills

## Quick Start

```bash
npx create-marketing-os
```

The CLI will guide you through:
1. Connecting your Shopify store
2. Setting up Supabase (auth + database)
3. Configuring integrations (GA4, Meta Ads, etc.)
4. Deploying to Vercel

**Goal**: Store synced to GitHub → logged into console → first automated improvement executed in under 10 minutes.

## Architecture

```
Shopify Theme Repo (GitHub)
├── /agents           # Next.js admin console (deployed to Vercel)
│   ├── app/          # Dashboard, chat, skills, activity pages
│   └── src/mastra/   # AI agents, tools, skills
├── /docs             # Brand voice, product knowledge (read by agents)
├── /.github/workflows # Claude Code async pipeline
└── CLAUDE.md         # Instructions for Claude Code
```

### Two Execution Paths

1. **Sync Path** (Real-time)
   - Next.js console on Vercel
   - Chat with agent, execute read-only skills
   - View analytics, generate reports

2. **Async Path** (Git-based)
   - GitHub Actions + Claude Code
   - All storefront changes go through PRs
   - Reviewable, reversible, traceable

## Tech Stack

| Component | Technology |
|-----------|-----------|
| CLI | Node.js + Commander.js |
| Admin Console | Next.js 15 + React 19 + Tailwind CSS + shadcn/ui |
| AI Framework | Mastra (TypeScript-native, Vercel-deployable) |
| Chat UI | assistant-ui + @ai-sdk/react |
| Auth | Supabase Auth (magic link) |
| Database | Supabase Postgres (Mastra @mastra/pg adapter) |
| Async Pipeline | GitHub Actions + Claude Code |
| Deployment | Vercel |

## Starter Skills

Every install includes 3 starter skills:

1. **Store Health Check** - Analyze recent performance (orders, traffic, metrics)
2. **Ad Copy Generator** - Generate ad copy variants matching your brand voice
3. **Weekly Performance Digest** - Automated weekly performance summary (cron-based)

## Community Skills

Browse and install community-contributed skills:

```bash
npx create-marketing-os add-skill klaviyo-sync
```

Contribute your own:

```bash
npx create-marketing-os add-skill my-custom-skill
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for skill contribution guidelines.

## Repository Structure

This is the Marketing OS **monorepo** (the repo that builds and publishes the CLI):

```
marketing-os/
├── packages/
│   ├── create-marketing-os/  # CLI package (published to npm)
│   └── skills/               # Community skills directory
├── examples/
│   └── demo-store/          # Example scaffolded store for testing
└── spec/                    # Complete specifications
```

## Development

```bash
# Clone the repo
git clone https://github.com/openconjecture/marketing-os.git
cd marketing-os

# Install dependencies
pnpm install

# Build all packages
pnpm turbo build

# Run tests
pnpm turbo test

# Run integration tests
pnpm turbo test:integration
```

## Documentation

Full specifications available in [`/spec`](./spec):

1. [Product Requirements](./spec/01-PRD.md)
2. [Technical Architecture](./spec/02-ARCHITECTURE.md)
3. [CLI Specification](./spec/03-CLI-SPEC.md)
4. [Scaffold Template Spec](./spec/04-SCAFFOLD-SPEC.md)
5. [Agents & Skills](./spec/05-AGENTS-AND-SKILLS.md)
6. [UI/UX Specification](./spec/06-UI-SPEC.md)
7. [Deployment & Infrastructure](./spec/07-DEPLOYMENT.md)
8. [Community & Ecosystem](./spec/08-COMMUNITY-ECOSYSTEM.md)
9. [Repository Structure](./spec/09-REPOSITORY-STRUCTURE.md)
10. [Implementation Plan](./spec/10-IMPLEMENTATION-PLAN.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Contribution Areas

- **Starter Skills** - Add new built-in skills
- **Community Skills** - Contribute installable skills
- **Integrations** - Add support for new marketing platforms
- **Documentation** - Improve docs and examples
- **Bug Fixes** - Fix issues and improve stability

## License

MIT © [Open Conjecture](https://github.com/openconjecture)

## Support

- **Issues**: [GitHub Issues](https://github.com/openconjecture/marketing-os/issues)
- **Discussions**: [GitHub Discussions](https://github.com/openconjecture/marketing-os/discussions)
- **Discord**: [Join our community](https://discord.gg/marketing-os) (coming soon)

---

Built with ❤️ by Open Conjecture
