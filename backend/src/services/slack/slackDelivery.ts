/**
 * Slack Delivery Service
 *
 * Sends structured Block Kit messages to Slack Incoming Webhook URLs.
 * Each feature (audit, reconciliation, strategy brief, IHC, signal tracking,
 * crawl) has a dedicated message builder that produces a concise summary card.
 *
 * Design contract: sendSlackMessage() never throws — failures are logged and
 * surfaced as a boolean return value.
 */

import logger from '@/utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlackTextElement {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

interface SlackHeaderBlock {
  type: 'header';
  text: SlackTextElement;
}

interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextElement;
  fields?: SlackTextElement[];
}

interface SlackDividerBlock {
  type: 'divider';
}

interface SlackContextBlock {
  type: 'context';
  elements: SlackTextElement[];
}

type SlackBlock =
  | SlackHeaderBlock
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackContextBlock;

// ── Core delivery ─────────────────────────────────────────────────────────────

export async function sendSlackMessage(
  webhookUrl: string,
  blocks: SlackBlock[],
  fallbackText: string,
): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallbackText, blocks }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, '[slackDelivery] Webhook returned non-2xx');
      return false;
    }

    logger.info('[slackDelivery] Message sent');
    return true;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[slackDelivery] Failed to send message',
    );
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function footer(): SlackContextBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Atlas · atlas.vimi.digital' }],
  };
}

function mrkdwn(text: string): SlackTextElement {
  return { type: 'mrkdwn', text };
}

function severityEmoji(sev: string): string {
  switch (sev) {
    case 'critical': return ':red_circle:';
    case 'high':     return ':large_orange_circle:';
    case 'medium':   return ':large_yellow_circle:';
    default:         return ':white_circle:';
  }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'healthy':  return ':large_green_circle:';
    case 'pass':     return ':large_green_circle:';
    case 'warning':  return ':large_yellow_circle:';
    case 'at_risk':  return ':large_yellow_circle:';
    case 'fail':     return ':red_circle:';
    case 'critical': return ':red_circle:';
    case 'broken':   return ':red_circle:';
    default:         return ':white_circle:';
  }
}

// ── Audit message ─────────────────────────────────────────────────────────────

interface AuditSummary {
  auditId: string;
  status: string;
  businessSummary: string;
  conversionSignalHealth: number;
  attributionRisk: string;
  criticalCount: number;
  highCount: number;
}

export function buildAuditMessage(s: AuditSummary): { blocks: SlackBlock[]; text: string } {
  const text = `Atlas Audit Report — Signal Health ${s.conversionSignalHealth}/100`;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':bar_chart: Atlas Audit Report', emoji: true },
    },
    {
      type: 'section',
      text: mrkdwn(s.businessSummary),
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Signal Health*\n${s.conversionSignalHealth}/100`),
        mrkdwn(`*Overall Status*\n${statusEmoji(s.status)} ${s.status.replace(/_/g, ' ')}`),
        mrkdwn(`*Attribution Risk*\n${s.attributionRisk}`),
        mrkdwn(`*Findings*\n${severityEmoji('critical')} ${s.criticalCount} critical  ${severityEmoji('high')} ${s.highCount} high`),
      ],
    },
    footer(),
  ];
  return { blocks, text };
}

// ── Strategy brief message ────────────────────────────────────────────────────

interface BriefObjectiveSummary {
  name: string;
  verdict: string | null;
  platforms: string[];
}

interface StrategySummary {
  briefName: string | null;
  clientName: string | null;
  versionNo: number;
  locked: boolean;
  objectives: BriefObjectiveSummary[];
}

export function buildStrategyBriefMessage(s: StrategySummary): { blocks: SlackBlock[]; text: string } {
  const title = s.briefName ?? 'Strategy Brief';
  const text = `Atlas Strategy Brief — ${title}`;

  const verdictLine = (o: BriefObjectiveSummary) => {
    const emoji =
      o.verdict === 'CONFIRM' ? ':white_check_mark:' :
      o.verdict === 'AUGMENT' ? ':large_yellow_circle:' :
      o.verdict === 'REPLACE' ? ':red_circle:' : ':white_circle:';
    return `${emoji} *${o.name}* — ${o.verdict ?? 'pending'} (${o.platforms.join(', ')})`;
  };

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':clipboard: Atlas Strategy Brief', emoji: true },
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Brief*\n${title}`),
        mrkdwn(`*Client*\n${s.clientName ?? '—'}`),
        mrkdwn(`*Version*\nv${s.versionNo}`),
        mrkdwn(`*Status*\n${s.locked ? ':lock: Locked' : ':pencil: Draft'}`),
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: mrkdwn('*Objectives*\n' + s.objectives.map(verdictLine).join('\n')),
    },
    footer(),
  ];
  return { blocks, text };
}

// ── Reconciliation message ────────────────────────────────────────────────────

interface ReconciliationFindingSummary {
  narrative: string;
  severity: string;
  dimension: string;
  platform: string;
}

interface ReconciliationSummary {
  runId: string;
  clientName: string | null;
  status: string;
  platformsRun: string[];
  totalFindings: number;
  bySeverity: Record<string, number>;
  topFindings: ReconciliationFindingSummary[];
}

export function buildReconciliationMessage(s: ReconciliationSummary): { blocks: SlackBlock[]; text: string } {
  const text = `Atlas Reconciliation — ${s.totalFindings} finding(s)`;
  const sevSummary = Object.entries(s.bySeverity)
    .filter(([, count]) => count > 0)
    .map(([sev, count]) => `${severityEmoji(sev)} ${count} ${sev}`)
    .join('  ');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':mag: Atlas Reconciliation Run', emoji: true },
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Client*\n${s.clientName ?? '—'}`),
        mrkdwn(`*Status*\n${s.status}`),
        mrkdwn(`*Platforms*\n${s.platformsRun.join(', ')}`),
        mrkdwn(`*Findings*\n${s.totalFindings}`),
      ],
    },
  ];

  if (sevSummary) {
    blocks.push({ type: 'section', text: mrkdwn(sevSummary) });
  }

  if (s.topFindings.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: mrkdwn(
        '*Top Findings*\n' +
        s.topFindings.slice(0, 5).map(
          (f) => `${severityEmoji(f.severity)} [${f.dimension}/${f.platform}] ${f.narrative}`,
        ).join('\n'),
      ),
    });
  }

  blocks.push(footer());
  return { blocks, text };
}

// ── IHC / Health message ──────────────────────────────────────────────────────

interface IHCSummary {
  clientName: string | null;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export function buildIHCMessage(s: IHCSummary): { blocks: SlackBlock[]; text: string } {
  const text = `Atlas IHC — ${s.total} finding(s) for ${s.clientName ?? 'client'}`;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':health: Atlas Implementation Health', emoji: true },
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Client*\n${s.clientName ?? '—'}`),
        mrkdwn(`*Total Findings*\n${s.total}`),
        mrkdwn(
          `*By Severity*\n` +
          `${severityEmoji('critical')} ${s.critical}  ` +
          `${severityEmoji('high')} ${s.high}  ` +
          `${severityEmoji('medium')} ${s.medium}  ` +
          `${severityEmoji('low')} ${s.low}`,
        ),
      ],
    },
    footer(),
  ];
  return { blocks, text };
}

// ── Signal tracking message ───────────────────────────────────────────────────

interface SignalAggSummary {
  provider: string | null;
  totalSignals: number;
  avgMatchQuality: number | null;
  dedupHitRate: number | null;
  avgLatencyMs: number | null;
}

export function buildSignalAggregatesMessage(s: SignalAggSummary): { blocks: SlackBlock[]; text: string } {
  const text = `Atlas Signal Tracking — ${s.totalSignals.toLocaleString()} signals`;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':signal_strength: Atlas Signal Tracking', emoji: true },
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Total Signals*\n${s.totalSignals.toLocaleString()}`),
        mrkdwn(`*Match Quality*\n${s.avgMatchQuality != null ? `${(s.avgMatchQuality * 100).toFixed(1)}%` : '—'}`),
        mrkdwn(`*Dedup Rate*\n${s.dedupHitRate != null ? `${(s.dedupHitRate * 100).toFixed(1)}%` : '—'}`),
        mrkdwn(`*Avg Latency*\n${s.avgLatencyMs != null ? `${Math.round(s.avgLatencyMs)}ms` : '—'}`),
      ],
    },
    footer(),
  ];
  return { blocks, text };
}

// ── Crawl run message ─────────────────────────────────────────────────────────

interface CrawlSummary {
  runId: string;
  mode: string;
  status: string;
  totalPages: number;
  pagesCompleted: number;
  signalsFound: number;
  signalsHealthy: number;
  signalsDegraded: number;
  signalsMissing: number;
  regressionsCount: number;
  durationSeconds: number | null;
}

export function buildCrawlRunMessage(s: CrawlSummary): { blocks: SlackBlock[]; text: string } {
  const text = `Atlas Crawl Run — ${s.pagesCompleted}/${s.totalPages} pages, ${s.signalsFound} signals`;
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':spider_web: Atlas Crawl Signal Extractor', emoji: true },
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`*Status*\n${statusEmoji(s.status)} ${s.status}`),
        mrkdwn(`*Pages*\n${s.pagesCompleted} / ${s.totalPages}`),
        mrkdwn(`*Signals Found*\n${s.signalsFound}`),
        mrkdwn(`*Duration*\n${s.durationSeconds != null ? `${s.durationSeconds}s` : '—'}`),
      ],
    },
    {
      type: 'section',
      fields: [
        mrkdwn(`:large_green_circle: ${s.signalsHealthy} healthy`),
        mrkdwn(`:large_yellow_circle: ${s.signalsDegraded} degraded`),
        mrkdwn(`:red_circle: ${s.signalsMissing} missing`),
        mrkdwn(`:warning: ${s.regressionsCount} regression(s)`),
      ],
    },
    footer(),
  ];
  return { blocks, text };
}
