# Demo Shopify Store

This is a minimal but realistic Shopify theme structure used for **integration testing** of the Avant Garde Marketing OS CLI.

## Purpose

This demo store is designed to:

- Provide a valid Shopify theme structure for E2E testing
- Test CLI scaffolding detection and initialization
- Verify that the CLI correctly identifies Shopify projects via `config/settings_schema.json`
- Serve as a reference implementation for theme structure

## Structure

This theme follows the standard Shopify theme architecture:

```
demo-store/
├── config/
│   └── settings_schema.json    # Theme settings configuration
├── layout/
│   └── theme.liquid             # Main theme layout
├── templates/
│   ├── index.json               # Homepage template
│   └── product.json             # Product page template
├── sections/
│   ├── header.liquid            # Header section
│   ├── footer.liquid            # Footer section
│   └── featured-collection.liquid  # Featured collection section
├── assets/
│   ├── theme.css                # Main stylesheet
│   └── theme.js                 # Main JavaScript
├── locales/
│   └── en.default.json          # English translations
└── README.md                    # This file
```

## Usage

### For Testing

This store is used by the integration tests in `tests/integration/cli.test.ts`:

```bash
npm run test:integration
```

The tests will:
1. Detect this as a valid Shopify theme
2. Run CLI scaffolding commands
3. Verify proper file generation and structure

### As a Reference

Use this as a minimal example of:
- Shopify Liquid templating
- JSON template structure
- Section schema definitions
- Theme localization
- Basic Shopify theme architecture

## Theme Features

- **Minimal but realistic**: Contains essential files without bloat
- **Valid Shopify structure**: Follows official Shopify theme standards
- **JSON templates**: Uses modern JSON-based template architecture
- **Section schemas**: Demonstrates schema definitions for customization
- **Localization**: Includes translation strings
- **Responsive**: Basic mobile-friendly styles

## Not Included

This is a minimal demo, so it intentionally excludes:
- Complex product variants handling
- Advanced search functionality
- Cart drawer/modal
- Customer account pages
- Blog templates
- Collection filtering
- Advanced JavaScript interactions

## Notes

- This is **not** meant to be deployed to a production Shopify store
- The theme is intentionally simplified for testing purposes
- Some Liquid tags may reference features that require actual Shopify data
- CSS and JS are minimal and for demonstration only

## License

Part of the Avant Garde Marketing OS platform.
