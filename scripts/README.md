# Marketing OS Scripts

Repository CLI and automation scripts for managing the Marketing OS monorepo.

## Usage

All scripts are executed through the main `os.sh` CLI:

```bash
./os.sh <namespace>:<command> [args]
```

## Available Commands

### NPM Lifecycle Management

#### `npm:publish`
Publish the CLI package to npm with safety checks.

```bash
./os.sh npm:publish
```

**What it does:**
1. Checks git status (warns if uncommitted changes)
2. Runs lint, typecheck, test, and build
3. Verifies package contents
4. Confirms npm authentication
5. Publishes to npm
6. Creates git tag for the version

#### `npm:version`
Bump the package version (major, minor, or patch).

```bash
./os.sh npm:version patch   # 0.1.0 → 0.1.1
./os.sh npm:version minor   # 0.1.0 → 0.2.0
./os.sh npm:version major   # 0.1.0 → 1.0.0
```

**What it does:**
1. Shows current version
2. Calculates new version based on bump type
3. Updates `package.json` (without git tag)
4. Provides next steps for committing

#### `npm:verify`
Run pre-publish verification checks.

```bash
./os.sh npm:verify
```

**Checks:**
- Git working directory status
- npm authentication
- package.json validity
- Required package.json fields
- Build output exists
- TypeScript compilation
- Linting
- Test suite

#### `npm:preview`
Preview what will be published to npm (dry-run).

```bash
./os.sh npm:preview
```

**Shows:**
- Package name and version
- File count and sizes
- List of files that will be included
- Package summary

## Workflow

### Publishing a New Version

```bash
# 1. Bump version
./os.sh npm:version patch

# 2. Commit version bump
git add .
git commit -m "chore: bump version to 0.1.1"

# 3. Verify package is ready
./os.sh npm:verify

# 4. Preview what will be published
./os.sh npm:preview

# 5. Publish to npm
./os.sh npm:publish
```

### Quick Publish (Current Version)

```bash
# Verify, preview, and publish
./os.sh npm:verify
./os.sh npm:preview
./os.sh npm:publish
```

## Directory Structure

```
scripts/
├── README.md              # This file
└── npm/
    ├── publish.sh         # Publish to npm
    ├── version.sh         # Bump version
    ├── verify.sh          # Pre-publish checks
    └── preview.sh         # Dry-run preview
```

## Adding New Commands

1. **Create a new script:**
   ```bash
   mkdir -p scripts/<namespace>
   touch scripts/<namespace>/<command>.sh
   chmod +x scripts/<namespace>/<command>.sh
   ```

2. **Add the script logic:**
   ```bash
   #!/usr/bin/env bash
   set -e

   # Your script here
   ```

3. **Use it:**
   ```bash
   ./os.sh <namespace>:<command>
   ```

## Adding New Namespaces

Create a new directory under `scripts/` for each namespace:

```bash
scripts/
├── npm/          # NPM lifecycle
├── docker/       # Docker operations
├── deploy/       # Deployment scripts
└── dev/          # Development utilities
```

Examples:
- `./os.sh docker:build` → `scripts/docker/build.sh`
- `./os.sh deploy:vercel` → `scripts/deploy/vercel.sh`
- `./os.sh dev:reset` → `scripts/dev/reset.sh`

## Best Practices

1. **Always use `set -e`** to exit on errors
2. **Add colored output** for better UX (see npm scripts for examples)
3. **Validate inputs** before performing operations
4. **Ask for confirmation** on destructive operations
5. **Provide helpful error messages** with remediation steps
6. **Document your scripts** with comments and help text

## Colors

Use these color codes for consistent output:

```bash
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

echo -e "${GREEN}✓${NC} Success message"
echo -e "${RED}✗${NC} Error message"
echo -e "${YELLOW}⚠${NC} Warning message"
echo -e "${BLUE}ℹ${NC} Info message"
```

## Testing Scripts

Test your scripts locally before committing:

```bash
# Dry-run mode (if supported)
./os.sh npm:preview

# Run with verbose output
./os.sh npm:verify --verbose
```
