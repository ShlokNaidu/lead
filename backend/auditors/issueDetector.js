import config from "../config.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function detectIssues({ websiteData, lighthouseData }) {
  const issues = [];
  let score = 0;

  if (!websiteData) {
    issues.push("Website could not be scraped reliably");
    score += 30;
  }

  if (websiteData) {
    if (!websiteData.title) {
      issues.push("Missing page title, weak search visibility");
      score += 10;
    }

    if (!websiteData.description || websiteData.description.length < 80) {
      issues.push("Weak or missing meta description, lower click-through potential");
      score += 8;
    }

    if (!websiteData.hasMenuPage) {
      issues.push("No visible menu page, high chance of drop-off before visit");
      score += 12;
    }

    if (!websiteData.hasReservationFlow) {
      issues.push("No clear reservation flow, booking friction present");
      score += 10;
    }

    if (!websiteData.hasOnlineOrdering) {
      issues.push("No online ordering signal, missing delivery/takeout revenue");
      score += 12;
    }

    if (!websiteData.email && !websiteData.phone) {
      issues.push("Contact details are hard to find");
      score += 8;
    }

    if (Array.isArray(websiteData.socialLinks) && websiteData.socialLinks.length === 0) {
      issues.push("No active social links on site, weak trust and retention loop");
      score += 6;
    }

    if (websiteData.brokenLinks > 1) {
      issues.push("Broken links detected, harming user trust and SEO");
      score += 8;
    }
  }

  if (!lighthouseData) {
    issues.push("Lighthouse audit unavailable");
    score += 8;
  }

  if (lighthouseData) {
    const perf = lighthouseData.performanceScore;
    if (typeof perf === "number") {
      if (perf < config.speedCriticalThreshold) {
        issues.push("Critical performance issues likely causing lost mobile conversions");
        score += 20;
      } else if (perf < config.speedSlowThreshold) {
        issues.push("Slow performance on key pages likely reducing orders");
        score += 12;
      }
    }

    if (typeof lighthouseData.seoScore === "number" && lighthouseData.seoScore < 70) {
      issues.push("Low SEO quality limits discovery from high-intent local searches");
      score += 10;
    }

    if (
      typeof lighthouseData.accessibilityScore === "number" &&
      lighthouseData.accessibilityScore < 70
    ) {
      issues.push("Accessibility issues reduce reach and user completion rates");
      score += 6;
    }

    if (typeof lighthouseData.lcp === "number" && lighthouseData.lcp > 3500) {
      issues.push("Large contentful paint is too slow for impatient diners");
      score += 8;
    }
  }

  const opportunityScore = clamp(score, 0, 100);

  return {
    opportunityScore,
    issues,
    summary:
      issues.length > 0
        ? `Found ${issues.length} issues with meaningful revenue impact.`
        : "No major issues detected.",
  };
}
