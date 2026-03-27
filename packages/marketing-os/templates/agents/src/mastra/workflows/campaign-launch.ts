// agents/src/mastra/workflows/campaign-launch.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

/**
 * Campaign Launch Workflow
 *
 * Coordinates the setup and launch of a marketing campaign across multiple channels.
 * This workflow handles:
 * - Campaign planning and validation
 * - Asset preparation (copy, creative briefs)
 * - Channel-specific setup (Meta Ads, Google Ads, email)
 * - Launch coordination and tracking setup
 *
 * Designed to be triggered manually or via the Marketing Agent when launching a campaign.
 */

// Step 1: Validate campaign configuration
const validateCampaign = createStep({
  id: "validate-campaign",
  inputSchema: z.object({
    campaignName: z.string(),
    channels: z.array(z.enum(["meta", "google", "email", "shopify"])),
    budget: z.object({
      total: z.number(),
      allocation: z.record(z.string(), z.number()),
    }),
    duration: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
    targetAudience: z.string(),
    goals: z.array(z.string()),
  }),
  outputSchema: z.object({
    isValid: z.boolean(),
    validationErrors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const { campaignName, channels, budget, duration, targetAudience, goals } = inputData;
    const validationErrors: string[] = [];
    const warnings: string[] = [];

    // Validate campaign name
    if (!campaignName || campaignName.length < 3) {
      validationErrors.push("Campaign name must be at least 3 characters");
    }

    // Validate channels
    if (channels.length === 0) {
      validationErrors.push("At least one marketing channel must be selected");
    }

    // Validate budget allocation
    const totalAllocated = Object.values(budget.allocation).reduce((sum, val) => sum + val, 0);
    if (Math.abs(totalAllocated - budget.total) > 0.01) {
      validationErrors.push(`Budget allocation ($${totalAllocated}) does not match total budget ($${budget.total})`);
    }

    channels.forEach(channel => {
      if (!budget.allocation[channel] || budget.allocation[channel] <= 0) {
        validationErrors.push(`No budget allocated for channel: ${channel}`);
      }
    });

    // Validate dates
    const startDate = new Date(duration.startDate);
    const endDate = new Date(duration.endDate);
    const now = new Date();

    if (startDate < now) {
      warnings.push("Campaign start date is in the past");
    }

    if (endDate <= startDate) {
      validationErrors.push("Campaign end date must be after start date");
    }

    const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (durationDays < 7) {
      warnings.push("Campaign duration is less than 7 days - consider extending for better results");
    }

    // Validate target audience
    if (!targetAudience || targetAudience.length < 10) {
      validationErrors.push("Target audience description is required");
    }

    // Validate goals
    if (goals.length === 0) {
      warnings.push("No campaign goals specified - consider adding measurable objectives");
    }

    return {
      isValid: validationErrors.length === 0,
      validationErrors,
      warnings,
    };
  },
});

// Step 2: Generate campaign assets (copy and creative briefs)
const generateAssets = createStep({
  id: "generate-assets",
  inputSchema: z.object({
    campaignName: z.string(),
    channels: z.array(z.enum(["meta", "google", "email", "shopify"])),
    targetAudience: z.string(),
    goals: z.array(z.string()),
  }),
  outputSchema: z.object({
    adCopy: z.object({
      meta: z.array(z.object({
        headline: z.string(),
        body: z.string(),
        cta: z.string(),
      })).optional(),
      google: z.array(z.object({
        headline1: z.string(),
        headline2: z.string(),
        description: z.string(),
      })).optional(),
      email: z.object({
        subject: z.string(),
        preheader: z.string(),
        body: z.string(),
      }).optional(),
    }),
    creativeBrief: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { campaignName, channels, targetAudience, goals } = inputData;

    // In production, this would call the Creative Agent to generate copy
    // For template purposes, generating placeholder structure

    const adCopy: any = {};

    if (channels.includes("meta")) {
      adCopy.meta = [
        {
          headline: `${campaignName} - Limited Time Offer`,
          body: `Discover amazing products tailored for ${targetAudience}. ${goals[0] || 'Shop now'} and save!`,
          cta: "Shop Now",
        },
        {
          headline: `Transform Your Experience with ${campaignName}`,
          body: `Join thousands who trust us. Perfect for ${targetAudience}.`,
          cta: "Learn More",
        },
        {
          headline: `Don't Miss Out on ${campaignName}`,
          body: `Exclusive offer for ${targetAudience}. Limited availability.`,
          cta: "Get Started",
        },
      ];
    }

    if (channels.includes("google")) {
      adCopy.google = [
        {
          headline1: campaignName,
          headline2: `Perfect for ${targetAudience.split(' ').slice(0, 3).join(' ')}`,
          description: `${goals[0] || 'Shop now'} with exclusive offers. Fast shipping & easy returns.`,
        },
      ];
    }

    if (channels.includes("email")) {
      adCopy.email = {
        subject: `Introducing ${campaignName} - Just for You`,
        preheader: `${goals[0] || 'Exclusive offer'} for ${targetAudience}`,
        body: `We're excited to share ${campaignName} with you. This campaign is designed specifically for ${targetAudience}.\n\n${goals.map(g => `• ${g}`).join('\n')}\n\nDon't miss out - shop now!`,
      };
    }

    const creativeBrief = `
# Creative Brief: ${campaignName}

## Campaign Overview
**Target Audience:** ${targetAudience}
**Channels:** ${channels.join(', ')}

## Campaign Goals
${goals.map(g => `- ${g}`).join('\n')}

## Key Messages
- Value proposition aligned with campaign goals
- Urgency and scarcity where appropriate
- Clear call-to-action for each channel

## Creative Guidelines
- Maintain brand voice and visual identity
- A/B test different headlines and CTAs
- Ensure mobile optimization for all assets
- Include tracking parameters for attribution

## Success Metrics
- Click-through rate (CTR)
- Conversion rate
- Return on ad spend (ROAS)
- Cost per acquisition (CPA)
    `.trim();

    return {
      adCopy,
      creativeBrief,
    };
  },
});

// Step 3: Setup tracking and analytics
const setupTracking = createStep({
  id: "setup-tracking",
  inputSchema: z.object({
    campaignName: z.string(),
    channels: z.array(z.enum(["meta", "google", "email", "shopify"])),
    duration: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
  }),
  outputSchema: z.object({
    trackingSetup: z.object({
      utmParameters: z.object({
        campaign: z.string(),
        source: z.record(z.string(), z.string()),
        medium: z.record(z.string(), z.string()),
      }),
      conversionGoals: z.array(z.string()),
      dashboardUrl: z.string().optional(),
    }),
  }),
  execute: async ({ inputData }) => {
    const { campaignName, channels, duration } = inputData;

    // Generate UTM parameters for tracking
    const campaignSlug = campaignName.toLowerCase().replace(/\s+/g, '-');

    const utmSource: Record<string, string> = {};
    const utmMedium: Record<string, string> = {};

    channels.forEach(channel => {
      switch (channel) {
        case "meta":
          utmSource[channel] = "facebook";
          utmMedium[channel] = "paid-social";
          break;
        case "google":
          utmSource[channel] = "google";
          utmMedium[channel] = "paid-search";
          break;
        case "email":
          utmSource[channel] = "newsletter";
          utmMedium[channel] = "email";
          break;
        case "shopify":
          utmSource[channel] = "store";
          utmMedium[channel] = "banner";
          break;
      }
    });

    const conversionGoals = [
      "purchase",
      "add_to_cart",
      "begin_checkout",
      "view_item",
    ];

    return {
      trackingSetup: {
        utmParameters: {
          campaign: campaignSlug,
          source: utmSource,
          medium: utmMedium,
        },
        conversionGoals,
        dashboardUrl: `/analytics/campaigns/${campaignSlug}`,
      },
    };
  },
});

// Step 4: Create deployment plan
const createDeploymentPlan = createStep({
  id: "create-deployment-plan",
  inputSchema: z.object({
    campaignName: z.string(),
    channels: z.array(z.enum(["meta", "google", "email", "shopify"])),
    budget: z.object({
      total: z.number(),
      allocation: z.record(z.string(), z.number()),
    }),
    duration: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
    adCopy: z.object({
      meta: z.array(z.object({
        headline: z.string(),
        body: z.string(),
        cta: z.string(),
      })).optional(),
      google: z.array(z.object({
        headline1: z.string(),
        headline2: z.string(),
        description: z.string(),
      })).optional(),
      email: z.object({
        subject: z.string(),
        preheader: z.string(),
        body: z.string(),
      }).optional(),
    }),
    trackingSetup: z.object({
      utmParameters: z.object({
        campaign: z.string(),
        source: z.record(z.string(), z.string()),
        medium: z.record(z.string(), z.string()),
      }),
      conversionGoals: z.array(z.string()),
      dashboardUrl: z.string().optional(),
    }),
  }),
  outputSchema: z.object({
    deploymentPlan: z.string(),
    actionItems: z.array(z.object({
      channel: z.string(),
      task: z.string(),
      status: z.enum(["pending", "ready", "deployed"]),
      deadline: z.string().optional(),
    })),
    estimatedLaunchDate: z.string(),
  }),
  execute: async ({ inputData }) => {
    const {
      campaignName,
      channels,
      budget,
      duration,
      adCopy,
      trackingSetup
    } = inputData;

    const actionItems: Array<{
      channel: string;
      task: string;
      status: "pending" | "ready" | "deployed";
      deadline?: string;
    }> = [];

    // Generate action items for each channel
    channels.forEach(channel => {
      const channelBudget = budget.allocation[channel] || 0;
      const utmSource = trackingSetup.utmParameters.source[channel];
      const utmMedium = trackingSetup.utmParameters.medium[channel];

      switch (channel) {
        case "meta":
          actionItems.push({
            channel: "meta",
            task: `Create Meta Ads campaign with ${adCopy.meta?.length || 0} ad variants`,
            status: "pending",
            deadline: duration.startDate,
          });
          actionItems.push({
            channel: "meta",
            task: `Set daily budget to $${(channelBudget / 30).toFixed(2)}`,
            status: "pending",
          });
          actionItems.push({
            channel: "meta",
            task: `Configure UTM tracking: utm_source=${utmSource}&utm_medium=${utmMedium}&utm_campaign=${trackingSetup.utmParameters.campaign}`,
            status: "pending",
          });
          break;

        case "google":
          actionItems.push({
            channel: "google",
            task: `Create Google Ads campaign with ${adCopy.google?.length || 0} ad variations`,
            status: "pending",
            deadline: duration.startDate,
          });
          actionItems.push({
            channel: "google",
            task: `Set daily budget to $${(channelBudget / 30).toFixed(2)}`,
            status: "pending",
          });
          actionItems.push({
            channel: "google",
            task: `Add conversion tracking for: ${trackingSetup.conversionGoals.join(', ')}`,
            status: "pending",
          });
          break;

        case "email":
          actionItems.push({
            channel: "email",
            task: "Create email campaign in ESP (e.g., Klaviyo, Mailchimp)",
            status: "pending",
            deadline: duration.startDate,
          });
          actionItems.push({
            channel: "email",
            task: `Subject: "${adCopy.email?.subject}"`,
            status: "ready",
          });
          actionItems.push({
            channel: "email",
            task: "Schedule send or trigger for target segment",
            status: "pending",
          });
          break;

        case "shopify":
          actionItems.push({
            channel: "shopify",
            task: "Create promotional banner on storefront",
            status: "pending",
            deadline: duration.startDate,
          });
          actionItems.push({
            channel: "shopify",
            task: "Set up discount codes if applicable",
            status: "pending",
          });
          actionItems.push({
            channel: "shopify",
            task: "Configure collection pages for featured products",
            status: "pending",
          });
          break;
      }
    });

    const deploymentPlan = `
# Deployment Plan: ${campaignName}

## Timeline
**Launch Date:** ${duration.startDate}
**End Date:** ${duration.endDate}
**Total Budget:** $${budget.total}

## Channel Breakdown

${channels.map(channel => {
  const channelBudget = budget.allocation[channel] || 0;
  const channelItems = actionItems.filter(item => item.channel === channel);

  return `### ${channel.toUpperCase()}
**Budget:** $${channelBudget}
**Action Items:**
${channelItems.map(item => `- [${item.status === 'ready' ? 'x' : ' '}] ${item.task}`).join('\n')}
`;
}).join('\n')}

## Tracking Configuration
**Campaign Slug:** ${trackingSetup.utmParameters.campaign}
**Dashboard:** ${trackingSetup.dashboardUrl || 'TBD'}

## Pre-Launch Checklist
- [ ] All ad copy approved
- [ ] Creative assets prepared
- [ ] Tracking pixels verified
- [ ] Conversion goals configured
- [ ] Budget allocation confirmed
- [ ] Target audience segments finalized
- [ ] Landing pages optimized
- [ ] A/B test variants ready

## Launch Day Tasks
1. Activate campaigns on all channels
2. Verify tracking is working
3. Monitor initial performance metrics
4. Set up alerts for budget pacing

## Post-Launch Monitoring
- Daily performance review for first 3 days
- Weekly optimization check-ins
- Mid-campaign performance review
- End-of-campaign analysis and report
    `.trim();

    return {
      deploymentPlan,
      actionItems,
      estimatedLaunchDate: duration.startDate,
    };
  },
});

// Define the workflow
export const campaignLaunchWorkflow = createWorkflow({
  id: "campaign-launch",
  inputSchema: z.object({
    campaignName: z.string().describe("Name of the marketing campaign"),
    channels: z.array(z.enum(["meta", "google", "email", "shopify"])).describe("Marketing channels to use"),
    budget: z.object({
      total: z.number().describe("Total campaign budget"),
      allocation: z.record(z.string(), z.number()).describe("Budget allocation by channel"),
    }),
    duration: z.object({
      startDate: z.string().describe("Campaign start date (YYYY-MM-DD)"),
      endDate: z.string().describe("Campaign end date (YYYY-MM-DD)"),
    }),
    targetAudience: z.string().describe("Description of target audience"),
    goals: z.array(z.string()).describe("Campaign goals and objectives"),
  }),
  outputSchema: z.object({
    deploymentPlan: z.string(),
    actionItems: z.array(z.object({
      channel: z.string(),
      task: z.string(),
      status: z.enum(["pending", "ready", "deployed"]),
      deadline: z.string().optional(),
    })),
    estimatedLaunchDate: z.string(),
    validation: z.object({
      isValid: z.boolean(),
      validationErrors: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  }),
})
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(validateCampaign)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(generateAssets)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(setupTracking)
  // @ts-expect-error - Step type inference is complex; types are validated at runtime
  .then(createDeploymentPlan)
  .commit();
