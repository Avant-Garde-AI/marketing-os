/**
 * GitHub API helpers for fetching PR status and repository information
 */

export interface GitHubPullRequest {
  number: number
  title: string
  state: "open" | "closed"
  merged: boolean
  draft: boolean
  user: {
    login: string
    avatar_url: string
  }
  html_url: string
  created_at: string
  updated_at: string
  merged_at: string | null
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
    sha: string
  }
  labels: Array<{
    name: string
    color: string
  }>
  assignees: Array<{
    login: string
    avatar_url: string
  }>
  requested_reviewers: Array<{
    login: string
    avatar_url: string
  }>
}

export interface GitHubCheck {
  name: string
  status: "queued" | "in_progress" | "completed"
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null
  html_url: string
  started_at: string | null
  completed_at: string | null
}

export interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: {
      name: string
      email: string
      date: string
    }
  }
  html_url: string
  author: {
    login: string
    avatar_url: string
  } | null
}

export class GitHubClient {
  private baseUrl = "https://api.github.com"
  private token?: string

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const headers: HeadersInit = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, { headers })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
    return this.fetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  }

  async listPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: "open" | "closed" | "all"
      sort?: "created" | "updated" | "popularity" | "long-running"
      direction?: "asc" | "desc"
      per_page?: number
      page?: number
    }
  ): Promise<GitHubPullRequest[]> {
    const params = new URLSearchParams()
    if (options?.state) params.set("state", options.state)
    if (options?.sort) params.set("sort", options.sort)
    if (options?.direction) params.set("direction", options.direction)
    if (options?.per_page) params.set("per_page", options.per_page.toString())
    if (options?.page) params.set("page", options.page.toString())

    const query = params.toString() ? `?${params.toString()}` : ""
    return this.fetch<GitHubPullRequest[]>(`/repos/${owner}/${repo}/pulls${query}`)
  }

  async getChecks(owner: string, repo: string, ref: string): Promise<GitHubCheck[]> {
    const response = await this.fetch<{ check_runs: GitHubCheck[] }>(
      `/repos/${owner}/${repo}/commits/${ref}/check-runs`
    )
    return response.check_runs
  }

  async getCommits(
    owner: string,
    repo: string,
    options?: {
      sha?: string
      path?: string
      per_page?: number
      page?: number
    }
  ): Promise<GitHubCommit[]> {
    const params = new URLSearchParams()
    if (options?.sha) params.set("sha", options.sha)
    if (options?.path) params.set("path", options.path)
    if (options?.per_page) params.set("per_page", options.per_page.toString())
    if (options?.page) params.set("page", options.page.toString())

    const query = params.toString() ? `?${params.toString()}` : ""
    return this.fetch<GitHubCommit[]>(`/repos/${owner}/${repo}/commits${query}`)
  }

  async getPRCommits(owner: string, repo: string, prNumber: number): Promise<GitHubCommit[]> {
    return this.fetch<GitHubCommit[]>(`/repos/${owner}/${repo}/pulls/${prNumber}/commits`)
  }

  async getPRFiles(owner: string, repo: string, prNumber: number) {
    return this.fetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files`)
  }

  /**
   * Parse GitHub URL to extract owner and repo
   */
  static parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const patterns = [
      /github\.com\/([^\/]+)\/([^\/]+)/,
      /github\.com:([^\/]+)\/(.+)\.git/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, ""),
        }
      }
    }

    return null
  }

  /**
   * Get PR status summary
   */
  static getPRStatus(pr: GitHubPullRequest): "merged" | "closed" | "draft" | "open" {
    if (pr.merged) return "merged"
    if (pr.state === "closed") return "closed"
    if (pr.draft) return "draft"
    return "open"
  }

  /**
   * Get overall check status
   */
  static getCheckStatus(checks: GitHubCheck[]): "pending" | "success" | "failure" {
    if (checks.length === 0) return "pending"

    const hasFailure = checks.some(
      check => check.conclusion === "failure" || check.conclusion === "timed_out"
    )
    if (hasFailure) return "failure"

    const allCompleted = checks.every(check => check.status === "completed")
    const allSuccess = checks.every(
      check => check.conclusion === "success" || check.conclusion === "skipped" || check.conclusion === "neutral"
    )

    if (allCompleted && allSuccess) return "success"
    return "pending"
  }
}

export const github = new GitHubClient()
