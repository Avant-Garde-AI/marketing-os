# Contributing to Marketing OS

Thank you for your interest in contributing to Marketing OS! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions. We're building an open, welcoming community.

## Ways to Contribute

### 1. Report Bugs

Found a bug? [Open an issue](https://github.com/openconjecture/marketing-os/issues/new) with:
- Clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS, etc.)
- Relevant logs or screenshots

### 2. Suggest Features

Have an idea? [Start a discussion](https://github.com/openconjecture/marketing-os/discussions) first to gather feedback before opening an issue.

### 3. Contribute Code

#### Setting Up Your Development Environment

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/marketing-os.git
cd marketing-os

# Install dependencies
pnpm install

# Build all packages
pnpm turbo build

# Run tests
pnpm turbo test
```

#### Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** following our coding standards:
   - TypeScript strict mode, ESM only
   - Follow existing code style (Prettier + ESLint)
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**:
   ```bash
   pnpm turbo test
   pnpm turbo typecheck
   pnpm turbo lint
   ```

4. **Commit your changes** with a descriptive message:
   ```bash
   git commit -m "feat: add new feature"
   ```

   Use conventional commit format:
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation only
   - `style:` - Code style changes (formatting, no logic change)
   - `refactor:` - Code refactoring
   - `test:` - Adding or updating tests
   - `chore:` - Maintenance tasks

5. **Push and open a pull request**:
   ```bash
   git push origin feat/your-feature-name
   ```

### 4. Contribute Skills

Skills are the heart of Marketing OS. We welcome community-contributed skills!

#### Skill Format

Every skill must export:

```typescript
// Required exports
export const metadata: SkillMetadata;
export const inputSchema: ZodSchema;
export const outputSchema: ZodSchema;
export const tool: MastraTool;

// Optional
export const workflow?: MastraWorkflow;
export const agents?: MastraAgent[];
```

#### Example Skill

```typescript
// packages/skills/community/my-skill/index.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const metadata = {
  id: "my-skill",
  name: "My Custom Skill",
  description: "Does something useful for marketing",
  category: "analytics",
  icon: "chart-bar",
  executionMode: "sync" as const,
  version: "1.0.0",
  author: "Your Name",
};

export const inputSchema = z.object({
  timeRange: z.enum(["7d", "30d", "90d"]).describe("Time range for analysis"),
});

export const outputSchema = z.object({
  result: z.string(),
  metrics: z.record(z.number()),
});

export const tool = createTool({
  id: metadata.id,
  description: metadata.description,
  inputSchema,
  outputSchema,
  execute: async ({ context }) => {
    // Your skill logic here
    return {
      result: "Analysis complete",
      metrics: { orders: 42, revenue: 1250.00 },
    };
  },
});
```

#### Skill Contribution Workflow

1. **Create your skill** in `packages/skills/community/your-skill/`
2. **Add a README** explaining what it does and how to use it
3. **Test your skill** locally by installing it in a demo store
4. **Submit a PR** with:
   - The skill code
   - README with usage examples
   - Any required env vars documented

#### Skill Quality Requirements

- [ ] Exports all required members
- [ ] Zod schemas have `.describe()` on all fields (for form generation)
- [ ] No hardcoded API keys or secrets
- [ ] Includes error handling
- [ ] Valid category and icon
- [ ] Execution mode correctly reflects behavior
- [ ] Has a README with description and usage
- [ ] No malicious code

### 5. Improve Documentation

Documentation improvements are always welcome:
- Fix typos or unclear explanations
- Add examples
- Improve API documentation
- Translate to other languages (future)

## Pull Request Process

1. **Ensure CI passes** - All tests, linting, and type-checking must pass
2. **Keep PRs focused** - One feature/fix per PR
3. **Update relevant documentation** - README, CHANGELOG, comments
4. **Request review** - Tag relevant maintainers if needed
5. **Address feedback** - Be responsive to review comments
6. **Squash commits** - Clean up commit history before merge

## Coding Standards

### TypeScript

- Strict mode enabled
- ESM only (no CommonJS)
- Explicit types preferred (avoid `any`)
- Use `unknown` instead of `any` when needed

### Naming Conventions

- **Files**: `kebab-case.ts`
- **Functions**: `camelCase()`
- **Classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces/Types**: `PascalCase`

### File Structure

```typescript
// 1. Imports (external, then internal)
import { z } from "zod";
import { createTool } from "@mastra/core/tools";

// 2. Types/Interfaces
interface MyType {
  // ...
}

// 3. Constants
const MY_CONSTANT = "value";

// 4. Main exports
export const myTool = createTool({
  // ...
});
```

### Testing

- Write tests for new functionality
- Maintain or improve code coverage
- Use descriptive test names: `it("should return valid output when given valid input")`
- Use vitest for unit tests

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Examples:
```
feat(cli): add doctor command for installation validation
fix(agents): resolve Supabase auth middleware issue
docs(readme): update quick start guide
```

## Release Process

Releases are managed by maintainers using Changesets:

1. Maintainer runs `pnpm changeset` to create a changeset
2. Changeset PR is automatically created
3. When merged, packages are automatically published to npm

## Community

- **GitHub Discussions** - Ask questions, share ideas
- **Discord** - Real-time chat (coming soon)
- **Blog** - Release notes and tutorials (coming soon)

## Questions?

Open a [discussion](https://github.com/openconjecture/marketing-os/discussions) or reach out to the maintainers.

Thank you for contributing! 🎉
