export const purchaseLines = [
  { name: 'Flour', quantity: 50, aliases: ['flour'] },
  { name: 'Butter', quantity: 20, aliases: ['butter'] },
  { name: 'Sugar', quantity: 30, aliases: ['sugar'] },
] as const;

const monthMap: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export type LineResult = {
  name: string;
  ordered: number;
  confirmed: number | null;
  unavailable: boolean;
  mentioned: boolean;
  status: string;
  badge: 'warn' | 'ok' | 'neutral';
  explanation: string;
};

export type Analysis = {
  lines: LineResult[];
  messageDate: Date | null;
};

export type AnalysisOverview = {
  dateDelta: number | null;
  missingConfirmationCount: number;
  confirmedIssueCount: number;
  hasConfirmedIssue: boolean;
  needsReview: boolean;
};

export function parseMessageDate(text: string): Date | null {
  const monthPattern = Object.keys(monthMap).join('|');
  const monthFirst = new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})\\b`, 'i');
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?[,]?\\s+(20\\d{2})\\b`, 'i');
  const firstMatch = text.match(monthFirst);
  const secondMatch = text.match(dayFirst);
  if (firstMatch) {
    const date = new Date(Date.UTC(Number(firstMatch[3]), monthMap[firstMatch[1].toLowerCase()], Number(firstMatch[2])));
    if (date.getUTCMonth() === monthMap[firstMatch[1].toLowerCase()] && date.getUTCDate() === Number(firstMatch[2])) return date;
  }
  if (secondMatch) {
    const date = new Date(Date.UTC(Number(secondMatch[3]), monthMap[secondMatch[2].toLowerCase()], Number(secondMatch[1])));
    if (date.getUTCMonth() === monthMap[secondMatch[2].toLowerCase()] && date.getUTCDate() === Number(secondMatch[1])) return date;
  }
  return null;
}

function extractQuantity(text: string, item: string): number | null {
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:kg|kilograms?)\\s*(?:of\\s+)?(?:the\\s+)?${escaped}\\b`, 'i');
  const after = new RegExp(`\\b${escaped}\\b[^.!?\\n]{0,18}?(\\d+(?:\\.\\d+)?)\\s*(?:kg|kilograms?)`, 'i');
  const match = text.match(before) ?? text.match(after);
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) ? quantity : null;
}

function isUnavailable(text: string, item: string): boolean {
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const afterItem = new RegExp(`\\b${escaped}\\b(?:\\s+\\w+){0,4}\\s+(?:is\\s+)?(?:currently\\s+)?(?:unavailable|not available|out of stock)\\b`, 'i');
  const beforeItem = new RegExp(`\\b(?:unavailable|not available|out of stock)\\b[^.!?\\n]{0,28}\\b${escaped}\\b`, 'i');
  return afterItem.test(text) || beforeItem.test(text);
}

export function analyzeMessage(text: string): Analysis {
  const normalized = text.toLowerCase();
  const lines = purchaseLines.map((line): LineResult => {
    const mentioned = line.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(normalized));
    const unavailable = line.aliases.some((alias) => isUnavailable(normalized, alias));
    const quantity = line.aliases.map((alias) => extractQuantity(normalized, alias)).find((value) => value !== null) ?? null;

    if (unavailable) {
      return {
        name: line.name,
        ordered: line.quantity,
        confirmed: null,
        unavailable: true,
        mentioned: true,
        status: 'Unavailable',
        badge: 'warn',
        explanation: `Supplier explicitly says ${line.name.toLowerCase()} is unavailable. All ${line.quantity} kg remain unresolved.`,
      };
    }
    if (!mentioned) {
      return {
        name: line.name,
        ordered: line.quantity,
        confirmed: null,
        unavailable: false,
        mentioned: false,
        status: 'Not Confirmed',
        badge: 'neutral',
        explanation: 'No supplier confirmation for this item was detected.',
      };
    }
    if (quantity === null) {
      return {
        name: line.name,
        ordered: line.quantity,
        confirmed: null,
        unavailable: false,
        mentioned: true,
        status: 'Not Confirmed',
        badge: 'neutral',
        explanation: `Supplier mentioned ${line.name.toLowerCase()} but did not confirm a quantity in kg.`,
      };
    }

    const gap = Math.max(0, line.quantity - quantity);
    return {
      name: line.name,
      ordered: line.quantity,
      confirmed: quantity,
      unavailable: false,
      mentioned: true,
      status: gap > 0 ? `${gap} kg short` : quantity >= line.quantity ? 'Fully confirmed' : 'Part-confirmed',
      badge: gap > 0 ? 'warn' : 'ok',
      explanation: quantity > line.quantity
        ? `${quantity} kg stated against ${line.quantity} kg ordered; the order quantity is covered.`
        : gap > 0
          ? `${quantity} kg stated against ${line.quantity} kg ordered; ${gap} kg is not covered by this confirmation.`
          : `${quantity} kg stated, matching the ordered quantity.`,
    };
  });

  return { lines, messageDate: parseMessageDate(text) };
}

export function getAnalysisOverview(analysis: Analysis): AnalysisOverview {
  const requiredDate = new Date(Date.UTC(2026, 9, 24));
  const dateDelta = analysis.messageDate
    ? Math.round((analysis.messageDate.getTime() - requiredDate.getTime()) / 86400000)
    : null;
  const missingConfirmationCount =
    analysis.lines.filter((line) => line.status === 'Not Confirmed').length +
    (analysis.messageDate === null ? 1 : 0);
  const hasConfirmedIssue = analysis.lines.some((line) => line.badge === 'warn') ||
    (dateDelta !== null && dateDelta !== 0);
  const confirmedIssueCount = analysis.lines.filter((line) => line.badge === 'warn').length +
    (dateDelta !== null && dateDelta !== 0 ? 1 : 0);

  return {
    dateDelta,
    missingConfirmationCount,
    confirmedIssueCount,
    hasConfirmedIssue,
    needsReview: missingConfirmationCount > 0 || hasConfirmedIssue,
  };
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function joinRequests(requests: string[]): string {
  if (requests.length <= 1) return requests[0] ?? 'the order details';
  if (requests.length === 2) return `${requests[0]} and ${requests[1]}`;
  return `${requests.slice(0, -1).join(', ')}, and ${requests[requests.length - 1]}`;
}

export function buildClarificationMessage(analysis: Analysis): string {
  const requests: string[] = [];
  for (const line of analysis.lines) {
    if (line.status === 'Not Confirmed') {
      requests.push(line.mentioned
        ? `the quantity you can supply for ${line.name.toLowerCase()}`
        : `whether you can supply the ordered ${line.ordered} kg of ${line.name.toLowerCase()}`);
    } else if (line.status === 'Unavailable') {
      requests.push(`whether the ordered ${line.ordered} kg of ${line.name.toLowerCase()} may become available`);
    } else if (line.confirmed !== null && line.confirmed < line.ordered) {
      requests.push(`whether the remaining ${line.ordered - line.confirmed} kg of ${line.name.toLowerCase()} can be supplied`);
    }
  }

  const overview = getAnalysisOverview(analysis);
  if (analysis.messageDate === null) {
    requests.push('the delivery date');
  } else if (overview.dateDelta !== 0) {
    requests.push(`whether delivery on ${formatDate(analysis.messageDate)} is confirmed`);
  }

  if (requests.length === 0) return '';
  return `Hi, thanks for the update. Could you please confirm ${joinRequests(requests)} for PO-1024? Thanks.`;
}
