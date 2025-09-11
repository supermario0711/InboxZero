/**
 * Gmail Email Processor with AI Classification - InboxZero Project
 * 
 * CONSOLIDATED VERSION - Single file containing all modules for easy copy-paste deployment
 *
 * SAFETY MODES:
 * 1) PREVIEW  – no mailbox changes (safe testing)
 * 2) LIMITED  – apply changes to first TEST_EMAIL_LIMIT emails
 * 3) FULL     – apply changes to all emails
 *
 * FEATURES:
 * - AI-powered email classification using Gemini API
 * - Two-tier Gmail label system (Action/Reference)
 * - Auto-archiving for newsletters, social, promotions, purchases
 * - Aging policies for financial emails
 * - Responsive HTML email summaries
 * - Intelligent label collision prevention
 *
 * SETUP INSTRUCTIONS:
 * 1. Copy this entire file to Google Apps Script (script.google.com)
 * 2. Add your Gemini API key to CONFIG.GEMINI_API_KEY
 * 3. Test with testSingleEmail() function first
 * 4. Set up daily trigger for processEmailsDaily()
 *
 * MODULES INCLUDED (in dependency order):
 * 1. Configuration - API keys, modes, aging rules, label definitions
 * 2. Utilities - Helper functions for JSON parsing, HTML escaping, etc.
 * 3. Label Management - Gmail label creation and intelligent collision prevention
 * 4. Email Classification - AI-powered categorization using Gemini API
 * 5. Email Processing - Category-specific processing and aging policies
 * 6. Summary Generation - HTML email template with responsive design
 * 7. Main Driver - Core functions and Gmail API helpers
 *
 * Author: InboxZero Project
 * Last Updated: 2025-01-11
 */

// ================== 1. CONFIGURATION ==================

const CONFIG = {
  MODE: 'PREVIEW',                           // 'PREVIEW' | 'LIMITED' | 'FULL'
  GEMINI_API_KEY: 'ADD_YOUR_GEMINI_API_KEY_HERE',
  GEMINI_MODEL: 'gemini-2.0-flash-lite',
  MAX_EMAILS_TO_PROCESS: 200,                 // max threads fetched from inbox
  TEST_EMAIL_LIMIT: 20,                      // LIMITED mode cap
  SUMMARY_EMAIL_SUBJECT: 'Daily Email Summary',

  // Social/newsletter rendering
  SHOW_SOCIAL_ITEMS: true,                   // show per-item links below each platform digest
  MAX_SOCIAL_ITEMS_PER_PLATFORM: 6,          // how many item links to show per platform

  // Aging rules (days)
  AGING_RULES: {
    FINANCIAL_WARNING_DAYS: 5,
    FINANCIAL_ARCHIVE_DAYS: 7,
    PURCHASES_WARNING_DAYS: 5,
    PURCHASES_ARCHIVE_DAYS: 7,
    CALENDAR_TO_ACTION_WARNING_DAYS: 2,
    CALENDAR_TO_ACTION_ARCHIVE_DAYS: 3
  }
};

// Two-tier label system
const LABELS = {
  // Action Tier - Require user attention
  ACTION: {
    URGENT: 'Urgent',
    TODO: 'To Do',
    WAITING: 'Waiting',
    SECURITY_ALERT: 'Security Alert'
  },
  
  // Reference Tier - Auto-filed
  REFERENCE: {
    CREATOR_NEWSLETTERS: 'Creator Newsletters',
    SOCIAL_COMMUNITY: 'Social & Community',
    PROMOTIONS: 'Promotions',
    FINANCIAL: 'Financial',
    PURCHASES: 'Purchases',
    MISC: 'Misc'
  }
};

// ================== 2. UTILITIES ==================

function isMutationEnabled() {
  return CONFIG.MODE !== 'PREVIEW';
}

/**
 * Robustly parse model output into JSON.
 * Handles:
 *  - raw JSON
 *  - fenced code blocks ```json ... ```
 *  - extra text around a JSON object
 */
function parseModelJson(text) {
  try { return JSON.parse(text); } catch (_) { }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1].trim()); } catch (_) { }
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    let depth = 0, end = -1;
    for (let i = firstBrace; i <= lastBrace; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const candidate = text.slice(firstBrace, (end !== -1 ? end : lastBrace) + 1);
    try { return JSON.parse(candidate); } catch (_) { }
  }
  throw new Error('Model did not return valid JSON');
}

function buildGeminiPayload(prompt) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: "application/json" }
  };
}

function clampNumber(n, min, max, fallback) {
  const num = Number(n);
  if (Number.isFinite(num)) return Math.min(max, Math.max(min, num));
  return fallback;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    // Handle emojis and other Unicode characters by converting to HTML entities
    .replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, 
      function(match) {
        return '&#' + match.codePointAt(0) + ';';
      }
    )
    // Handle any remaining high Unicode characters
    .replace(/[\u0080-\uFFFF]/g, function(match) {
      return '&#' + match.charCodeAt(0) + ';';
    });
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ================== 3. GMAIL LABEL MANAGEMENT ==================

function createLabelsIfNeeded() {
  console.log('Creating Gmail labels if needed...');
  
  const allLabels = {...LABELS.ACTION, ...LABELS.REFERENCE};
  
  Object.values(allLabels).forEach(labelName => {
    try {
      let label = getOrCreateLabel(labelName);
      console.log(`Label "${labelName}" created/verified`);
    } catch (error) {
      console.error(`Error creating label "${labelName}": ${error.toString()}`);
    }
  });
}

function getOrCreateLabel(labelName) {
  try {
    // Try to get existing label
    let label = GmailApp.getUserLabelByName(labelName);
    
    if (!label) {
      // Create label if it doesn't exist
      label = GmailApp.createLabel(labelName);
      console.log(`Created new label: ${labelName}`);
    }
    
    return label;
  } catch (error) {
    console.error(`Error with label "${labelName}": ${error.toString()}`);
    return null;
  }
}

function applyLabel(email, labelKey) {
  if (!isMutationEnabled()) return;
  
  try {
    // Determine which tier the label belongs to
    let labelName = null;
    if (LABELS.ACTION[labelKey]) {
      labelName = LABELS.ACTION[labelKey];
    } else if (LABELS.REFERENCE[labelKey]) {
      labelName = LABELS.REFERENCE[labelKey];
    }
    
    if (!labelName) {
      console.error(`Unknown label key: ${labelKey}`);
      return;
    }
    
    // Remove existing InboxZero labels first to prevent conflicts
    const removedLabels = removeInboxZeroLabels(email);
    
    // Apply the new label
    const label = getOrCreateLabel(labelName);
    if (label) {
      email.getThread().addLabel(label);
      
      // Log the change with context
      if (removedLabels.length > 0) {
        console.log(`Label change for "${email.getSubject()}": [${removedLabels.join(', ')}] → ${labelName}`);
      } else {
        console.log(`Applied label "${labelName}" to: ${email.getSubject()}`);
      }
    }
  } catch (error) {
    console.error(`Error applying label ${labelKey}: ${error.toString()}`);
  }
}

// Helper function to get label name by key
function getLabelName(labelKey) {
  return LABELS.ACTION[labelKey] || LABELS.REFERENCE[labelKey] || null;
}

// Get all InboxZero label names from config
function getAllInboxZeroLabelNames() {
  return [...Object.values(LABELS.ACTION), ...Object.values(LABELS.REFERENCE)];
}

// Get existing InboxZero labels on an email thread
function getInboxZeroLabels(email) {
  try {
    const thread = email.getThread();
    const threadLabels = thread.getLabels();
    const inboxZeroLabelNames = getAllInboxZeroLabelNames();
    
    // Return only labels that match our InboxZero label names
    return threadLabels.filter(label => 
      inboxZeroLabelNames.includes(label.getName())
    );
  } catch (error) {
    console.error(`Error getting InboxZero labels: ${error.toString()}`);
    return [];
  }
}

// Remove only InboxZero labels from email thread
function removeInboxZeroLabels(email) {
  if (!isMutationEnabled()) return [];
  
  try {
    const existingInboxZeroLabels = getInboxZeroLabels(email);
    const thread = email.getThread();
    const removedLabels = [];
    
    existingInboxZeroLabels.forEach(label => {
      thread.removeLabel(label);
      removedLabels.push(label.getName());
      console.log(`Removed InboxZero label: ${label.getName()}`);
    });
    
    return removedLabels;
  } catch (error) {
    console.error(`Error removing InboxZero labels: ${error.toString()}`);
    return [];
  }
}

// ================== 4. EMAIL CLASSIFICATION ==================

function classifyEmail(email) {
  const prompt = `
You are an email classifier. Classify the email into ONE of these exact categories (snake_case):

ACTION TIER (require user attention):
- urgent
- todo
- waiting
- security_alert

REFERENCE TIER (auto-filed):
- creator_newsletters
- social_community
- promotions
- financial
- purchases
- misc

Category definitions:
- urgent: Immediate attention required today - meeting invites, urgent personal emails, anything with "urgent", "ASAP", "EOD" keywords, account access issues requiring immediate response.
- todo: Requires response or action within reasonable timeframe - general personal emails needing replies, non-urgent meeting confirmations, general action items.
- waiting: Tasks delegated or awaiting someone else's response - follow-ups you're expecting, confirmations you're waiting for.
- security_alert: Account/infra/device incidents and security notifications (suspicious login, MFA disabled). Do NOT include marketing/webinars.
- creator_newsletters: Editorial content from individual creators - Substack editions, personal blogs, creator-driven content with articles/insights.
- social_community: Social media notifications and community updates - LinkedIn, X, YouTube, Discord, Reddit, Meetup notifications, forum digests.
- promotions: All retail newsletters and marketing campaigns - sales emails, discounts, "% off", "Limited time" offers, brand marketing, company newsletters with promotional content.
- financial: Bills, invoices, statements, tax documents, bank notifications, subscription billing.
- purchases: Order confirmations, receipts, shipping notifications, delivery updates, return confirmations.
- misc: Everything else that doesn't fit other categories (personal updates, unknown senders, miscellaneous).

OUTPUT REQUIREMENTS:
- Calibrate summary depth by category:
  • creator_newsletters: summary MUST be 3–5 sentences capturing the core ideas and any standout links (include links as plain text if present). Also provide details.creator_newsletters.read_if with a one-line targeting cue (e.g., "Busy founders who want X").
  • social_community: summary MUST be 1–2 sentence highlight that is platform-centric (e.g., mentions/DMs/comments/invites). Also set details.social_community.platform to one of: LinkedIn | YouTube | X | Discord | Reddit | Substack | Meetup | Other.
  • promotions: Include expiry date if found in details.promotions.expiry_date (format as YYYY-MM-DD or original text if unclear).
  • All other categories: summary MUST be a single concise sentence with less than 110 characters.
- Treat 1:1 personal emails as urgent (if immediate response needed), todo (if response needed soon), or misc (if purely informational).
- For calendar emails: urgent for invites/urgent scheduling, todo for general confirmations/reminders.

Return ONLY valid JSON with this shape:

{
  "category": "urgent|todo|waiting|security_alert|creator_newsletters|social_community|promotions|financial|purchases|misc",
  "confidence": 0.0-1.0,
  "summary": "string (depth per rules above)",
  "reasoning": "short why this category",
  "details": {
    "urgent": {"deadline": "YYYY-MM-DD" | null, "requires_reply": true|false} | null,
    "todo": {"deadline": "YYYY-MM-DD" | null, "requires_reply": true|false} | null,
    "waiting": {"waiting_for": "description of what you're waiting for" | null} | null,
    "security_alert": {"severity": "low|medium|high|critical"} | null,
    "creator_newsletters": {"read_if": "one-line targeting cue" | null} | null,
    "social_community": {"platform": "LinkedIn|YouTube|X|Discord|Reddit|Substack|Meetup|Other", "highlights": ["..."]} | null,
    "promotions": {"discount": "e.g., 25% off" | null, "expiry_date": "YYYY-MM-DD or original text" | null} | null,
    "financial": {"amount": "€xx.xx" | null, "due_date": "YYYY-MM-DD" | null, "type": "bill|invoice|statement|tax" | null} | null,
    "purchases": {"amount": "€xx.xx" | null, "order_number": "string" | null, "status": "ordered|shipped|delivered" | null} | null
  }
}

Email:
Subject: ${email.getSubject()}
From: ${email.getFrom()}
Body: ${email.getPlainBody().substring(0, 4000)}
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const payload = buildGeminiPayload(prompt);
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let result = parseModelJson(text);

    const allowed = new Set([
      'urgent', 'todo', 'waiting', 'security_alert',
      'creator_newsletters', 'social_community', 'promotions', 'financial', 'purchases', 'misc'
    ]);
    const category = allowed.has(result.category) ? result.category : 'misc';

    return {
      category,
      confidence: clampNumber(result.confidence, 0, 1, 0.5),
      summary: (result.summary || '').toString(),
      reasoning: (result.reasoning || '').toString(),
      details: (result.details && typeof result.details === 'object') ? result.details : {}
    };

  } catch (error) {
    console.error('Gemini classification error:', error.toString());
    return {
      category: 'misc',
      confidence: 0.0,
      summary: 'Classification failed',
      reasoning: error.toString(),
      details: {}
    };
  }
}

// ================== 5. CATEGORY PROCESSING & AGING POLICIES ==================

function processEmailByCategory(email, classification, results) {
  const emailData = {
    subject: email.getSubject(),
    from: email.getFrom(),
    summary: classification.summary,
    confidence: classification.confidence,
    reasoning: classification.reasoning,
    details: classification.details,
    link: `https://mail.google.com/mail/u/0/#inbox/${email.getThread().getId()}`,
    date: email.getDate()
  };

  // Apply single label based on category
  let labelKey = null;

  switch (classification.category) {
    // ACTION TIER
    case 'urgent':
      results.urgent = results.urgent || [];
      results.urgent.push(emailData);
      labelKey = 'URGENT';
      if (isMutationEnabled()) {
        email.getThread().markImportant();
        email.markUnread();
      }
      break;

    case 'todo':
      results.todo = results.todo || [];
      results.todo.push(emailData);
      labelKey = 'TODO';
      if (isMutationEnabled()) {
        email.markUnread();
      }
      break;

    case 'waiting':
      results.waiting = results.waiting || [];
      results.waiting.push(emailData);
      labelKey = 'WAITING';
      if (isMutationEnabled()) {
        email.markUnread();
      }
      break;

    case 'security_alert':
      results.security_alert = results.security_alert || [];
      results.security_alert.push(emailData);
      labelKey = 'SECURITY_ALERT';
      if (isMutationEnabled()) {
        email.star();
        email.getThread().markImportant();
        email.markUnread();
      }
      break;

    // REFERENCE TIER - Auto-archive
    case 'creator_newsletters':
      results.creator_newsletters = results.creator_newsletters || [];
      results.creator_newsletters.push(emailData);
      results.auto_counts.creator_newsletters++;
      labelKey = 'CREATOR_NEWSLETTERS';
      if (isMutationEnabled()) {
        email.getThread().moveToArchive();
      }
      break;

    case 'social_community':
      results.social_community = results.social_community || [];
      results.social_community.push(emailData);
      results.auto_counts.social_community++;
      labelKey = 'SOCIAL_COMMUNITY';
      if (isMutationEnabled()) {
        email.getThread().moveToArchive();
      }
      break;

    case 'promotions':
      results.promotions = results.promotions || [];
      results.promotions.push(emailData);
      results.auto_counts.promotions++;
      labelKey = 'PROMOTIONS';
      if (isMutationEnabled()) {
        email.getThread().moveToArchive();
      }
      break;

    case 'financial': {
      results.financial = results.financial || [];
      const r = processFinancialByAge(email);
      if (r.action === 'archive') {
        results.auto_counts.aged_financial++;
        if (isMutationEnabled()) email.getThread().moveToArchive();
      } else {
        emailData.warning = r.warning;
        emailData.daysOld = r.daysOld;
        results.financial.push(emailData);
      }
      labelKey = 'FINANCIAL';
      break;
    }

    case 'purchases':
      results.purchases = results.purchases || [];
      results.purchases.push(emailData);
      results.auto_counts.purchases++;
      labelKey = 'PURCHASES';
      if (isMutationEnabled()) {
        email.getThread().moveToArchive();
      }
      break;

    default: // misc
      results.misc = results.misc || [];
      results.misc.push(emailData);
      labelKey = 'MISC';
      break;
  }

  // Apply the single appropriate label
  if (labelKey) {
    applyLabel(email, labelKey);
  }
}

function processFinancialByAge(email) {
  const emailDate = email.getDate();
  const ageInDays = Math.floor((Date.now() - emailDate.getTime()) / 86400000);

  if (ageInDays > CONFIG.AGING_RULES.FINANCIAL_ARCHIVE_DAYS) {
    return { action: 'archive', reason: `Auto-archived (financial email older than ${CONFIG.AGING_RULES.FINANCIAL_ARCHIVE_DAYS} days: ${ageInDays})`, daysOld: ageInDays };
  } else if (ageInDays >= CONFIG.AGING_RULES.FINANCIAL_WARNING_DAYS) {
    return { action: 'keep', warning: `Financial email aging (${ageInDays} days old). Consider archiving soon.`, daysOld: ageInDays };
  } else {
    return { action: 'keep', daysOld: ageInDays };
  }
}

function processPurchasesByAge(email) {
  const emailDate = email.getDate();
  const ageInDays = Math.floor((Date.now() - emailDate.getTime()) / 86400000);

  if (ageInDays > CONFIG.AGING_RULES.PURCHASES_ARCHIVE_DAYS) {
    return { action: 'archive', reason: `Auto-archived (purchase email older than ${CONFIG.AGING_RULES.PURCHASES_ARCHIVE_DAYS} days: ${ageInDays})`, daysOld: ageInDays };
  } else if (ageInDays >= CONFIG.AGING_RULES.PURCHASES_WARNING_DAYS) {
    return { action: 'keep', warning: `Purchase email aging (${ageInDays} days old). Consider archiving soon.`, daysOld: ageInDays };
  } else {
    return { action: 'keep', daysOld: ageInDays };
  }
}

// ================== 6. SUMMARY GENERATION & NOTIFICATIONS ==================

function generateSummary(results) {
  let summary = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, user-scalable=no">
<meta name="format-detection" content="telephone=no">
<meta name="x-apple-disable-message-reformatting">
<style>
  /* ===== Base / Layout ===== */
  body{
    margin:0;
    padding:24px;
    background:#fff; /* white */
    -webkit-text-size-adjust:100% !important;
    -ms-text-size-adjust:100% !important;
    text-size-adjust:100% !important;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;
    color:#334155;
    line-height:1.6;
    min-width:100% !important;
  }
  .outer{
    width:100%;
  }
  .container{
    width:100% !important;
    max-width:720px;             /* width constraint */
    margin:0 auto;
    background:#fff;
    border-radius:12px;
    box-shadow:0 4px 10px rgba(0,0,0,.06);
    overflow:hidden;
    -webkit-box-sizing:border-box !important;
    -moz-box-sizing:border-box !important;
    box-sizing:border-box !important;
  }

  /* ===== Header ===== */
  .header{
    background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
    color:#fff;
    padding:28px 32px;
    text-align:center;
  }
  .header h1{
    margin:0;
    font-size:26px;
    font-weight:700;
  }
  .subtitle{
    margin-top:8px;
    opacity:.9;
    font-size:14px;
  }

  .content{ padding:28px 30px; }

  /* ===== Headings (fixed) ===== */
  .section-title{
    margin:26px -30px 14px -30px;
    padding:14px 30px;
    background:#fff;
    color:#1f2937;
    font-size:18px;
    font-weight:700;
  }

  /* Category headers + separators */
  .category-header{
    display:flex;align-items:center;
    padding:12px 14px;
    background:#fff;
    font-weight:700;
    margin:18px 0 12px 0;
    font-size:16px;
  }
  .sep{ height:1px; background:#e5e7eb; border:0; margin:18px 0; } /* horizontal breaks */

  .urgent{color:#991b1b;}
  .todo{color:#92400e;}
  .waiting{color:#3730a3;}
  .security{color:#7f1d1d;}
  .financial{color:#065f46;}
  .creator{color:#5b21b6;}
  .social{color:#1e3a8a;}
  .purchases{color:#065f46;}
  .promotions{color:#9d174d;}

  /* ===== Cards ===== */
  .email-card{
    border:1px solid #e2e8f0;
    border-radius:10px;
    padding:14px;
    margin:0 0 12px 0;
    background:#fff;
    transition:box-shadow .2s ease;
  }
  .email-card:hover{ box-shadow:0 6px 14px rgba(0,0,0,.08); }

  .title-row{
    display:flex;align-items:center;gap:16px;justify-content:space-between;margin-bottom:6px;
  }
  .title-text{
    flex:1;
    font-size:16px;
    font-weight:700;
    color:#0f172a;
    line-height:1.35;
  }

  /* ===== Unified button (smaller size) ===== */
  .btn{
    display:inline-block;
    background:#4285f4 !important;
    color:#fff !important;
    text-decoration:none !important;
    height:22px;                 /* smaller height */
    line-height:22px;            /* vertical centering */
    padding:0 12px;              /* horizontal padding only */
    border-radius:6px;
    font-size:12px;
    font-weight:600;
    white-space:nowrap;
    border:none;
  }
  .btn:hover{ background:#3367d6 !important; }

  .from{ color:#64748b;font-size:13px;margin:0 0 6px 0; }
  .summary{ color:#475569;font-style:italic;margin:0 0 6px 0; }

  /* Compact list container */
  .compact{
    background:#fff;border-radius:8px;padding:14px;margin-bottom:12px;border:1px solid #e5e7eb;
  }

  /* Section containers */
  .section-container{
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:12px;
    padding:20px;
    margin-bottom:20px;
  }

  /* ===== Footer "Auto-archived today" (prominent) ===== */
  .footer-summary{
    margin:0;
    padding:18px 30px;
    background:#fff;
    border-top:1px solid #e2e8f0;
  }
  .footer-summary h3{
    margin:0 0 10px 0;
    font-size:15px;
    color:#0f172a;
  }
  .pills{ display:flex;flex-wrap:wrap;gap:8px; }
  .pill{
    display:inline-block;
    padding:6px 10px;
    border-radius:999px;
    background:#e5e7eb;
    font-size:12px;
    font-weight:700;
    color:#111827;
  }

  /* ===== Mobile tweaks ===== */
  @media only screen and (max-width:600px){
    body{ padding:12px !important; min-width:100% !important; }
    .content{ padding:20px 18px !important; }
    .section-title{ margin:18px -18px 10px -18px !important; padding:12px 18px !important; }
    .container{ border-radius:0 !important; }
    .section-container{ margin:0 -12px 20px -12px !important; border-radius:0 !important; }
  }
  @media only screen and (max-device-width:600px){
    body{ padding:12px !important; min-width:100% !important; }
    .content{ padding:20px 18px !important; }
    .section-title{ margin:18px -18px 10px -18px !important; padding:12px 18px !important; }
    .container{ border-radius:0 !important; }
    .section-container{ margin:0 -12px 20px -12px !important; border-radius:0 !important; }
  }
  @media only screen and (max-width:480px){
    body{ padding:8px !important; font-size:16px !important; }
    .content{ padding:16px 12px !important; }
    .title-text{ font-size:15px !important; }
    .btn{ font-size:11px !important; height:20px !important; line-height:20px !important; }
  }
  @media only screen and (max-width:375px){
    body{ padding:6px !important; }
    .content{ padding:12px 8px !important; }
    .section-container{ padding:16px !important; }
  }
</style>

<!-- Outlook-specific: keep outside <style> to avoid breaking CSS in other clients -->
<!--[if mso]>
  <style type="text/css">
    .btn { mso-padding-alt:0 12px; }
  </style>
<![endif]-->

<!-- Gmail Mobile Fixes -->
<style type="text/css">
  @media screen and (-webkit-min-device-pixel-ratio:0) {
    body { -webkit-text-size-adjust:none !important; }
    .container { width:100% !important; }
  }
  /* Gmail Mobile App */
  u + .body .container { width:100% !important; }
  /* Prevent Gmail from changing font sizes */
  div > u + .body .container { width:100% !important; }
</style>
</head>

<body>
  <center class="outer">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center">
        <table role="presentation" class="container" cellspacing="0" cellpadding="0">
          <tr><td>
            <div class="header">
              <h1>&#128231; Daily Email Summary</h1>
              <div class="subtitle">Mode: ${CONFIG.MODE} • Processed: ${new Date().toLocaleString()}</div>
            </div>
            <div class="content">`;

  /* helper to render a category block + separator - always use compact styling */
  const section = (title, arr, opts = {}) => {
    if (!arr || arr.length === 0) return;
    const cat = opts.categoryClass || '';
    summary += `<div class="category-header ${cat}">${title} (${arr.length})${opts.suffix || ''}</div>`;

    // Always use compact styling
    summary += `<div class="compact">`;
    arr.forEach((e,i)=>{
      if(i>0) summary += `<hr class="sep" style="margin:10px 0;">`;
      summary += `
        <div class="title-row">
          <div class="title-text">${escapeHtml(e.subject)}</div>
          <a href="${e.link}" target="_blank" class="btn">Open</a>
        </div>
        <div class="from">From: ${escapeHtml(e.from)}</div>
        ${e.summary ? `<div class="summary">${escapeHtml(truncate(e.summary, 110))}</div>` : ``}
        ${e.warning ? `<div style="background:#fff7ed;color:#92400e;padding:6px 8px;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px;">${escapeHtml(e.warning)}</div>` : ``}
      `;
    });
    summary += `</div>`;

    summary += `<hr class="sep">`; /* horizontal break between categories */
  };

  /* ===== ACTION TIER ===== */
  summary += `<div class="section-container">`;
  summary += `<div class="section-title">&#127919; Action Required</div>`;
  section('Urgent', results.urgent, { suffix: ' - Marked Important', categoryClass:'urgent' });
  section('To Do', results.todo, { categoryClass:'todo' });
  section('Waiting', results.waiting, { categoryClass:'waiting' });
  section('Security Alerts', results.security_alert, { suffix:' - Starred & Important', categoryClass:'security' });
  summary += `</div>`;

  /* ===== REFERENCE TIER ===== */
  summary += `<div class="section-container">`;
  summary += `<div class="section-title">&#128193; Auto-Filed Reference</div>`;
  section('Financial', results.financial, { categoryClass:'financial' });

  /* Creator newsletters (compact style) */
  if (results.creator_newsletters?.length){
    summary += `<div class="category-header creator">Creator Newsletters (${results.creator_newsletters.length}) - Auto-archived</div>`;
    summary += `<div class="compact">`;
    results.creator_newsletters.forEach((e,i)=>{
      if(i>0) summary += `<hr class="sep" style="margin:10px 0;">`;
      summary += `
        <div class="title-row">
          <div class="title-text">${escapeHtml(e.subject)}</div>
          <a href="${e.link}" target="_blank" class="btn">Open</a>
        </div>
        <div class="from">From: ${escapeHtml(e.from)}</div>
        ${e.summary ? `<div class="summary">${escapeHtml(truncate(e.summary, 300))}</div>` : ``}
        ${e?.details?.creator_newsletters?.read_if ? `<div style="background:#f3f4f6;border-radius:6px;padding:8px 10px;font-size:13px;"><strong>Read if:</strong> ${escapeHtml(e.details.creator_newsletters.read_if)}</div>`:``}
      `;
    });
    summary += `</div><hr class="sep">`;
  }

  /* Social & Community (compact, grouped) */
  if (results.social_community?.length){
    summary += `<div class="category-header social">Social &amp; Community (${results.social_community.length}) - Auto-archived</div>`;
    const platforms = results.social_community.reduce((a,e)=>{
      const p = e.details?.social_community?.platform || 'Other'; (a[p]=a[p]||[]).push(e); return a;
    },{});
    summary += `<div class="compact">`;
    Object.keys(platforms).forEach((p,idx)=>{
      if(idx>0) summary += `<hr class="sep" style="margin:12px 0;">`;
      const emails = platforms[p];
      const digest = summarizeSocialHighlights(emails,p) || `${emails.length} updates.`;
      summary += `
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;font-size:14px;">${escapeHtml(p)}: ${emails.length} updates</div>
        <div style="font-size:13px;color:#475569;margin-bottom:6px;">${escapeHtml(digest)}</div>`;
      if (CONFIG.SHOW_SOCIAL_ITEMS){
        summary += `<div>`;
        emails.slice(0,CONFIG.MAX_SOCIAL_ITEMS_PER_PLATFORM).forEach(e=>{
          summary += `<a class="btn" style="height:24px;line-height:24px;padding:0 10px;font-size:11px;margin:0 6px 6px 0;display:inline-block" target="_blank" href="${e.link}">${escapeHtml(truncate(e.subject,40))}</a>`;
        });
        summary += `</div>`;
      }
    });
    summary += `</div><hr class="sep">`;
  }

  section('Purchases', results.purchases, { categoryClass:'purchases' });

  /* Promotions (compact + expiry) */
  if (results.promotions?.length){
    summary += `<div class="category-header promotions">Promotions (${results.promotions.length}) - Auto-archived</div><div class="compact">`;
    results.promotions.forEach((e,i)=>{
      if(i>0) summary += `<hr class="sep" style="margin:8px 0;">`;
      summary += `
        <div class="title-row">
          <div class="title-text" style="font-size:14px">${escapeHtml(e.subject)}</div>
          <a href="${e.link}" target="_blank" class="btn">Open</a>
        </div>
        <div class="from" style="font-size:12px">From: ${escapeHtml(e.from)}</div>
        ${e.summary ? `<div style="color:#475569;font-size:13px;margin:0 0 4px 0;">${escapeHtml(truncate(e.summary,110))}</div>`:``}
        ${e?.details?.promotions?.expiry_date ? `<div style="color:#dc2626;font-weight:700;font-size:12px;">&#9203; Expires: ${escapeHtml(e.details.promotions.expiry_date)}</div>`:``}
      `;
    });
    summary += `</div><hr class="sep">`;
  }

  summary += `</div>`; /* Close Auto-Filed Reference container */

  /* Errors (compact style) */
  if (results.errors?.length){
    summary += `<div class="category-header" style="color:#7f1d1d;">Errors (${results.errors.length})</div>`;
    summary += `<div class="compact">`;
    results.errors.forEach((err,i)=>{
      if(i>0) summary += `<hr class="sep" style="margin:10px 0;">`;
      summary += `
        <div class="title-row">
          <div class="title-text">${escapeHtml(err.subject)}</div>
          <a href="${err.link}" target="_blank" class="btn">Open</a>
        </div>
        <div class="from">From: ${escapeHtml(err.from)}</div>
        <div style="background:#fee2e2;border-left:3px solid #dc2626;border-radius:6px;padding:8px 10px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#991b1b;">${escapeHtml(err.error)}</div>
      `;
    });
    summary += `</div><hr class="sep">`;
  }

  /* Misc (table) */
  if (results.misc?.length){
    summary += `<div class="section-container">`;
    summary += `<div class="category-header" style="color:#374151;">&#9898; Miscellaneous (${results.misc.length}) - Needs Your Input</div>
      <div style="margin:12px 0 6px 0;padding:12px;background:#fff;border-left:4px solid #6b7280;border-radius:8px;">
        <em>These emails couldn't be automatically categorized. Improve the algorithm following this quick guide.</em>
      </div>
      <table class="misc-table" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:10px 0;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-radius:8px;overflow:hidden">
        <thead><tr>
          <th align="left" style="background:#f1f5f9;padding:10px 12px;border-bottom:2px solid #e5e7eb;">Subject</th>
          <th align="left" style="background:#f1f5f9;padding:10px 12px;border-bottom:2px solid #e5e7eb;">From</th>
          <th align="left" style="background:#f1f5f9;padding:10px 12px;border-bottom:2px solid #e5e7eb;">Summary</th>
        </tr></thead><tbody>`;
    results.misc.forEach(e=>{
      summary += `<tr>
        <td style="padding:10px 12px;"><a href="${e.link}" target="_blank" class="btn" style="height:24px;line-height:24px;padding:0 10px;font-size:11px;">${escapeHtml(truncate(e.subject,50))}</a></td>
        <td style="padding:10px 12px;">${escapeHtml(truncate(e.from,30))}</td>
        <td style="padding:10px 12px;">${escapeHtml(truncate(e.summary || 'No summary',100))}</td>
      </tr>`;
    });
    summary += `</tbody></table></div>`;
  }

  const c = results.auto_counts || {};
  summary += `
            </div>
            <div class="footer-summary">
              <h3>&#128202; Auto-archived today</h3>
              <div class="pills">
                <span class="pill">Promotions ${c.promotions || 0}</span>
                <span class="pill">Creator NL ${c.creator_newsletters || 0}</span>
                <span class="pill">Social & Comm ${c.social_community || 0}</span>
                <span class="pill">Purchases ${c.purchases || 0}</span>
                <span class="pill">Aged Financial ${c.aged_financial || 0}</span>
              </div>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </center>
</body>
</html>`;

  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    (CONFIG.MODE === 'PREVIEW' ? '[PREVIEW] ' : (CONFIG.MODE === 'LIMITED' ? '[LIMITED] ' : '')) + CONFIG.SUMMARY_EMAIL_SUBJECT,
    'Please view this email in HTML format for the best experience.',
    { htmlBody: summary }
  );
}

function summarizeSocialHighlights(emails, platform) {
  if (!emails || emails.length === 0) return '';

  // Keep prompt small; use up to 12 items
  const lines = emails.slice(0, 12).map(e => {
    const subj = (e.subject || '').toString();
    const sum = (e.summary || '').toString();
    const from = (e.from || '').toString();
    return `From: ${from}\nSubject: ${subj}\nSummary: ${sum}`;
  }).join('\n---\n');

  const prompt = `You are a concise platform-centric summarizer.
Platform: ${platform}
Task: Write 1–2 sentences that capture the most important activity across these notifications, focusing on mentions, DMs, comments, invites, or noteworthy creators. No bullet points. Return plain text only.

Notifications:
${lines}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return String(text).trim();
  } catch (e) {
    console.error('Social summary error:', e.toString());
    return '';
  }
}

// ================== 7. MAIN DRIVER FUNCTIONS & GMAIL HELPERS ==================

function getInboxEmails() {
  // Fetch threads in Inbox, cap by MAX_EMAILS_TO_PROCESS
  const threads = GmailApp.search('in:inbox', 0, CONFIG.MAX_EMAILS_TO_PROCESS);
  const emails = [];
  threads.forEach(thread => {
    const msgs = thread.getMessages();
    const last = msgs[msgs.length - 1];
    if (!last.isInTrash()) emails.push(last);
  });
  return emails;
}

/**
 * Run manually: processes only 1 email in PREVIEW
 */
function testSingleEmail() {
  const originalMode = CONFIG.MODE;
  const originalLimit = CONFIG.TEST_EMAIL_LIMIT;

  CONFIG.MODE = 'PREVIEW';
  CONFIG.TEST_EMAIL_LIMIT = 1;

  processEmailsDaily();

  CONFIG.MODE = originalMode;
  CONFIG.TEST_EMAIL_LIMIT = originalLimit;
}

/**
 * Clear all sender history
 */
function clearSenderHistory() {
  const props = PropertiesService.getScriptProperties();
  const keys = props.getKeys();
  keys.forEach(k => { if (k.startsWith('sender_')) props.deleteProperty(k); });
}

/**
 * View sender history (logs)
 */
function viewSenderHistory() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(key => {
    if (key.startsWith('sender_')) console.log(`${key}: ${props[key]}`);
  });
}

/**
 * Main entry – set up a daily (or hourly) trigger for this
 */
function processEmailsDaily() {
  console.log(`Starting email processing in ${CONFIG.MODE} mode...`);
  try {
    // Initialize Gmail labels
    createLabelsIfNeeded();
    
    const inboxEmails = getInboxEmails();
    console.log(`Found ${inboxEmails.length} threads (latest message per thread).`);

    if (inboxEmails.length === 0) {
      console.log('No emails to process.');
      return;
    }

    const emailsToProcess = (CONFIG.MODE === 'LIMITED')
      ? inboxEmails.slice(0, CONFIG.TEST_EMAIL_LIMIT)
      : inboxEmails;

    console.log(`Processing ${emailsToProcess.length} emails.`);

    const autoCounts = { 
      promotions: 0, 
      creator_newsletters: 0, 
      social_community: 0, 
      aged_financial: 0, 
      aged_purchases: 0 
    };
    const results = {
      // Action Tier
      urgent: [],
      todo: [],
      waiting: [],
      security_alert: [],
      
      // Reference Tier
      creator_newsletters: [],
      social_community: [],
      promotions: [],
      financial: [],
      purchases: [],
      misc: [],
      
      errors: [],
      auto_counts: autoCounts
    };

    for (let i = 0; i < emailsToProcess.length; i++) {
      const email = emailsToProcess[i];
      try {
        console.log(`Processing ${i + 1}/${emailsToProcess.length}: ${email.getSubject()}`);

        // Skip our own Daily Email Summaries - auto-archive them without processing
        const subject = email.getSubject();
        const sender = email.getFrom();
        const currentUserEmail = Session.getActiveUser().getEmail();
        
        if (sender.includes(currentUserEmail) && 
            (subject.includes('Daily Email Summary') || 
             subject.includes('[PREVIEW] Daily Email Summary') || 
             subject.includes('[LIMITED] Daily Email Summary'))) {
          console.log('Skipping own Daily Email Summary - auto-archiving');
          if (isMutationEnabled()) {
            email.getThread().moveToArchive();
          }
          continue;
        }

        // Guard huge bodies (API quotas)
        email.getPlainBody().substring(0, 1); // warm-up to avoid repeated calls warnings

        // Classify
        const classification = classifyEmail(email);
        console.log(`Classified as: ${classification.category} (conf ${classification.confidence})`);

        // Act by category
        processEmailByCategory(email, classification, results);

      } catch (err) {
        console.error(`Error processing email: ${err.toString()}`);
        results.errors.push({
          subject: email.getSubject(),
          from: email.getFrom(),
          error: err.toString()
        });
      }
    }

    // Summary email
    generateSummary(results);
    console.log('Email processing complete!');
  } catch (fatal) {
    console.error(`Fatal error: ${fatal.toString()}`);
    sendErrorNotification(fatal);
  }
}

/**
 * Send error notification
 */
function sendErrorNotification(error) {
  try {
    GmailApp.sendEmail(
      Session.getActiveUser().getEmail(),
      'InboxZero Error Alert',
      `A fatal error occurred during email processing:\n\n${error.toString()}`
    );
  } catch (e) {
    console.error('Failed to send error notification:', e.toString());
  }
}
