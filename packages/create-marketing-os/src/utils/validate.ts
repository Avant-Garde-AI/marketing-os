/**
 * Validation utilities for API keys and credentials
 * Validates format and basic structure of various service tokens
 */

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate Anthropic API key format
 * Format: sk-ant-api03-[base64 chars]
 */
export function validateAnthropicKey(key: string): ValidationResult {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "API key is required" };
  }

  const trimmedKey = key.trim();

  // Check for basic format
  if (!trimmedKey.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: "Invalid format. Anthropic API keys start with 'sk-ant-'",
    };
  }

  // Check minimum length (typical Anthropic keys are ~100+ characters)
  if (trimmedKey.length < 50) {
    return {
      valid: false,
      error: "API key appears too short. Please check and try again.",
    };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^sk-ant-[a-zA-Z0-9_-]+$/.test(trimmedKey)) {
    return {
      valid: false,
      error: "API key contains invalid characters",
    };
  }

  return { valid: true };
}

/**
 * Validate Supabase URL format
 * Format: https://[project-ref].supabase.co
 */
export function validateSupabaseUrl(url: string): ValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "Supabase URL is required" };
  }

  const trimmedUrl = url.trim();

  try {
    const parsed = new URL(trimmedUrl);

    // Check protocol
    if (parsed.protocol !== "https:") {
      return {
        valid: false,
        error: "Supabase URL must use HTTPS protocol",
      };
    }

    // Check domain
    if (!parsed.hostname.endsWith(".supabase.co")) {
      return {
        valid: false,
        error: "Invalid Supabase URL. Should be in format: https://[project-ref].supabase.co",
      };
    }

    // Check project ref format (should be alphanumeric)
    const projectRef = parsed.hostname.split(".")[0];
    if (!projectRef || !/^[a-z0-9]+$/.test(projectRef)) {
      return {
        valid: false,
        error: "Invalid project reference in URL",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: "Invalid URL format",
    };
  }
}

/**
 * Validate Supabase anon/public key format
 * Format: JWT token (eyJ...)
 */
export function validateSupabaseAnonKey(key: string): ValidationResult {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "Supabase anon key is required" };
  }

  const trimmedKey = key.trim();

  // Check if it starts with eyJ (JWT header)
  if (!trimmedKey.startsWith("eyJ")) {
    return {
      valid: false,
      error: "Invalid format. Supabase keys are JWT tokens starting with 'eyJ'",
    };
  }

  // Check minimum length (JWT tokens are typically long)
  if (trimmedKey.length < 100) {
    return {
      valid: false,
      error: "Key appears too short. Please check and try again.",
    };
  }

  // JWT tokens should have 3 parts separated by dots
  const parts = trimmedKey.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: "Invalid JWT format. Should have 3 parts separated by dots.",
    };
  }

  // Check for valid base64 characters
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(trimmedKey)) {
    return {
      valid: false,
      error: "Key contains invalid characters",
    };
  }

  return { valid: true };
}

/**
 * Validate Shopify store URL format
 * Format: [store-name].myshopify.com
 */
export function validateShopifyStoreUrl(url: string): ValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "Shopify store URL is required" };
  }

  let trimmedUrl = url.trim();

  // Remove protocol if present
  trimmedUrl = trimmedUrl.replace(/^https?:\/\//, "");

  // Remove trailing slash
  trimmedUrl = trimmedUrl.replace(/\/$/, "");

  // Check for .myshopify.com domain
  if (!trimmedUrl.endsWith(".myshopify.com")) {
    return {
      valid: false,
      error: "Invalid format. Should be: [store-name].myshopify.com",
    };
  }

  // Extract store name
  const storeName = trimmedUrl.replace(".myshopify.com", "");

  // Validate store name (alphanumeric and hyphens only)
  if (!storeName || !/^[a-z0-9-]+$/.test(storeName)) {
    return {
      valid: false,
      error: "Store name should contain only lowercase letters, numbers, and hyphens",
    };
  }

  // Check for valid length
  if (storeName.length < 3 || storeName.length > 60) {
    return {
      valid: false,
      error: "Store name should be between 3 and 60 characters",
    };
  }

  return { valid: true };
}

/**
 * Validate Shopify access token format
 * Format: shpat_[alphanumeric] or shpca_[alphanumeric] (custom app)
 */
export function validateShopifyAccessToken(token: string): ValidationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Shopify access token is required" };
  }

  const trimmedToken = token.trim();

  // Check for valid prefix
  if (!trimmedToken.startsWith("shpat_") && !trimmedToken.startsWith("shpca_")) {
    return {
      valid: false,
      error: "Invalid format. Shopify tokens start with 'shpat_' or 'shpca_'",
    };
  }

  // Check minimum length
  if (trimmedToken.length < 20) {
    return {
      valid: false,
      error: "Token appears too short. Please check and try again.",
    };
  }

  // Check for valid characters
  if (!/^shp(at|ca)_[a-zA-Z0-9]+$/.test(trimmedToken)) {
    return {
      valid: false,
      error: "Token contains invalid characters",
    };
  }

  return { valid: true };
}

/**
 * Validate GitHub personal access token format
 * Format: ghp_[alphanumeric] (classic) or github_pat_[alphanumeric] (fine-grained)
 */
export function validateGitHubToken(token: string): ValidationResult {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "GitHub token is required" };
  }

  const trimmedToken = token.trim();

  // Check for valid prefix
  if (!trimmedToken.startsWith("ghp_") && !trimmedToken.startsWith("github_pat_")) {
    return {
      valid: false,
      error: "Invalid format. GitHub tokens start with 'ghp_' or 'github_pat_'",
    };
  }

  // Check minimum length
  if (trimmedToken.length < 20) {
    return {
      valid: false,
      error: "Token appears too short. Please check and try again.",
    };
  }

  // Check for valid characters
  if (!/^(ghp_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+)$/.test(trimmedToken)) {
    return {
      valid: false,
      error: "Token contains invalid characters",
    };
  }

  return { valid: true };
}

/**
 * Validate GitHub repository format
 * Format: owner/repo or https://github.com/owner/repo
 */
export function validateGitHubRepo(repo: string): ValidationResult {
  if (!repo || typeof repo !== "string") {
    return { valid: false, error: "Repository name is required" };
  }

  let trimmedRepo = repo.trim();

  // Extract owner/repo from full URL if provided
  if (trimmedRepo.startsWith("http")) {
    try {
      const url = new URL(trimmedRepo);
      if (url.hostname !== "github.com") {
        return {
          valid: false,
          error: "Only GitHub repositories are supported",
        };
      }
      trimmedRepo = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
    } catch (error) {
      return {
        valid: false,
        error: "Invalid URL format",
      };
    }
  }

  // Check format: owner/repo
  const parts = trimmedRepo.split("/");
  if (parts.length !== 2) {
    return {
      valid: false,
      error: "Invalid format. Should be: owner/repo",
    };
  }

  const [owner, repoName] = parts;

  // Validate owner and repo names (alphanumeric, hyphens, underscores, dots)
  if (!owner || !/^[a-zA-Z0-9._-]+$/.test(owner)) {
    return {
      valid: false,
      error: "Invalid owner name",
    };
  }

  if (!repoName || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    return {
      valid: false,
      error: "Invalid repository name",
    };
  }

  return { valid: true };
}

/**
 * Validate email address format
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== "string") {
    return { valid: false, error: "Email address is required" };
  }

  const trimmedEmail = email.trim();

  // Basic email regex (not perfect but catches most invalid formats)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmedEmail)) {
    return {
      valid: false,
      error: "Invalid email format",
    };
  }

  return { valid: true };
}

/**
 * Validate that a string is not empty
 */
export function validateRequired(value: string, fieldName = "Value"): ValidationResult {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    return {
      valid: false,
      error: `${fieldName} is required`,
    };
  }

  return { valid: true };
}

/**
 * Generic URL validator
 */
export function validateUrl(url: string, fieldName = "URL"): ValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: `${fieldName} is required` };
  }

  try {
    const parsed = new URL(url.trim());
    if (!parsed.protocol.startsWith("http")) {
      return {
        valid: false,
        error: `${fieldName} must use HTTP or HTTPS protocol`,
      };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid ${fieldName} format`,
    };
  }
}
