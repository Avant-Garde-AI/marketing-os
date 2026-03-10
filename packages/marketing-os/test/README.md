# Integration Tests

This directory contains end-to-end integration tests for the `create-marketing-os` CLI tool.

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run with verbose output
npm run test:integration -- --reporter=verbose

# Run specific test file
npm run test:integration -- integration.test.ts
```

## Test Structure

### `integration.test.ts`

Comprehensive E2E test that:

1. Creates a temporary directory
2. Copies the demo store structure from `examples/demo-store/`
3. Initializes a git repository (required by CLI)
4. Runs the CLI with `--yes` flag and mock API keys
5. Verifies all expected template files were created
6. Verifies Handlebars variables were properly interpolated (no `{{...}}` left)
7. Validates configuration files and package.json
8. Optionally runs `npm install` and `npm run build` (can be slow)
9. Cleans up temporary directory after test

## Test Requirements

Before running integration tests:

1. Build the CLI: `npm run build`
2. Ensure `examples/demo-store/` exists in the monorepo root
3. Have Node.js 20+ installed

## Test Timeouts

- Setup/teardown: 30-60 seconds
- File verification: 5-10 seconds
- npm install: 3 minutes (optional, can be skipped)
- npm build: 4 minutes (optional, requires npm install)

## CI/CD Considerations

The integration tests can be run in CI/CD pipelines. The `npm install` and `npm run build` tests are optional and will gracefully skip if they timeout or fail, making the test suite suitable for fast CI pipelines.

## Debugging Tests

If tests fail:

1. Check that the CLI is built: `ls dist/index.js`
2. Check that demo store exists: `ls ../../examples/demo-store`
3. Run with verbose logging: `npm run test:integration -- --reporter=verbose`
4. Check temp directory (not cleaned up on failure): `/tmp/marketing-os-test-*`

## Test Coverage

The integration tests verify:

- CLI can run successfully with `--yes` flag
- All template files are created in correct locations
- Handlebars template variables are properly interpolated
- Configuration files have correct structure and values
- Package.json has required dependencies and scripts
- Environment variable examples are complete
- GitHub workflow files are valid YAML
- Mastra configuration is valid TypeScript
- Documentation files are created
- Original Shopify theme files are preserved
- No duplicate files or conflicts between theme and agents
