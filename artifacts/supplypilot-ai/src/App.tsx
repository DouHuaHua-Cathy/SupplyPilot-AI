import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarDays, Check, CircleHelp, ClipboardList, FileText, ShieldCheck, Sparkles, Wheat } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const initialMessage = 'Hi boss, we can deliver 35kg flour and 20kg butter on 26 Oct 2026. Sugar is currently unavailable. Remaining flour can be delivered next week.';
const purchaseLines = [
  { name: 'Flour', quantity: 50, aliases: ['flour'] },
  { name: 'Butter', quantity: 20, aliases: ['butter'] },
  { name: 'Sugar', quantity: 30, aliases: ['sugar'] },
];
const monthMap: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

type LineResult = {
  name: string;
  ordered: number;
  confirmed: number | null;
  unavailable: boolean;
  mentioned: boolean;
  status: string;
  badge: 'warn' | 'ok' | 'neutral';
  explanation: string;
};
type Analysis = { lines: LineResult[]; messageDate: Date | null; hasAnyDetected: boolean };

function parseMessageDate(text: string): Date | null {
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
  return match ? Number(match[1]) : null;
}

function isUnavailable(text: string, item: string): boolean {
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const afterItem = new RegExp(`\\b${escaped}\\b(?:\\s+\\w+){0,4}\\s+(?:is\\s+)?(?:currently\\s+)?(?:unavailable|not available|out of stock)\\b`, 'i');
  const beforeItem = new RegExp(`\\b(?:unavailable|not available|out of stock)\\b[^.!?\\n]{0,28}\\b${escaped}\\b`, 'i');
  return afterItem.test(text) || beforeItem.test(text);
}

function analyzeMessage(text: string): Analysis {
  const normalized = text.toLowerCase();
  let hasAnyDetected = false;
  const lines = purchaseLines.map((line): LineResult => {
    const mentioned = line.aliases.some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(normalized));
    const unavailable = line.aliases.some((alias) => isUnavailable(normalized, alias));
    const quantity = line.aliases.map((alias) => extractQuantity(normalized, alias)).find((value) => value !== null) ?? null;
    if (mentioned) hasAnyDetected = true;
    if (quantity !== null) hasAnyDetected = true;
    if (unavailable) hasAnyDetected = true;
    if (unavailable) {
      return { ...line, ordered: line.quantity, confirmed: null, unavailable: true, mentioned: true, status: 'Unavailable', badge: 'warn', explanation: `Supplier explicitly says ${line.name.toLowerCase()} is unavailable. All ${line.quantity} kg remain unresolved.` };
    }
    if (!mentioned) {
      return { ...line, ordered: line.quantity, confirmed: null, unavailable: false, mentioned: false, status: 'Not mentioned', badge: 'neutral', explanation: 'No supplier confirmation for this item was detected.' };
    }
    if (quantity === null) {
      return { ...line, ordered: line.quantity, confirmed: null, unavailable: false, mentioned: true, status: 'Quantity unknown', badge: 'neutral', explanation: 'Item was mentioned, but no quantity in kg was detected.' };
    }
    const gap = Math.max(0, line.quantity - quantity);
    return {
      ...line, ordered: line.quantity, confirmed: quantity, unavailable: false, mentioned: true,
      status: gap > 0 ? `${gap} kg short` : quantity >= line.quantity ? 'Fully confirmed' : 'Part-confirmed',
      badge: gap > 0 ? 'warn' : 'ok',
      explanation: quantity > line.quantity
        ? `${quantity} kg stated against ${line.quantity} kg ordered; the order quantity is covered.`
        : gap > 0 ? `${quantity} kg stated against ${line.quantity} kg ordered; ${gap} kg is not covered by this confirmation.`
          : `${quantity} kg stated, matching the ordered quantity.`,
    };
  });
  return { lines, messageDate: parseMessageDate(text), hasAnyDetected };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function Home() {
  const [message, setMessage] = useState(initialMessage);
  const [analysis, setAnalysis] = useState<Analysis | null>(() => analyzeMessage(initialMessage));
  const [error, setError] = useState('');

  function handleAnalyze() {
    setAnalysis(null);
    if (!message.trim()) {
      setError('Add the supplier’s message before checking it. You can paste the relevant WhatsApp-style text here.');
      return;
    }
    const parsed = analyzeMessage(message);
    if (!parsed.hasAnyDetected) {
      setError('No supported item, quantity, availability status, or delivery date was detected. Try including an item name (flour, butter, or sugar), a quantity in kg, or a written date.');
      return;
    }
    setError('');
    setAnalysis(parsed);
  }

  const requiredDate = new Date(Date.UTC(2026, 9, 24));
  const dateDelta = analysis?.messageDate ? Math.round((analysis.messageDate.getTime() - requiredDate.getTime()) / 86400000) : null;
  const issueCount = analysis?.lines.filter((line) => line.badge === 'warn' || line.status === 'Quantity unknown' || line.status === 'Not mentioned').length ?? 0;

  return (
    <div className="sp-shell">
      <header className="sp-topbar">
        <div className="sp-brand" aria-label="SupplyPilot AI">
          <span className="sp-mark"><Wheat size={18} strokeWidth={2.3} aria-hidden="true" /></span>
          <span>SupplyPilot <span style={{ color: '#ed9852' }}>AI</span></span>
        </div>
        <div className="sp-top-meta"><ShieldCheck size={15} aria-hidden="true" /><span>PRIVATE STAGE 1 PROTOTYPE</span></div>
      </header>

      <main className="sp-main">
        <div className="sp-eyebrow">Purchasing desk / Message check</div>
        <h1 className="sp-title">Know what’s confirmed.</h1>
        <p className="sp-intro">Compare a supplier’s note with your purchase order—before delivery day.</p>

        <section className="sp-order" aria-label="Purchase order summary" data-testid="card-purchase-order">
          <div className="sp-order-main">
            <div className="sp-order-icon"><ClipboardList size={21} aria-hidden="true" /></div>
            <div>
              <div className="sp-order-name">PO-1024 <span style={{ color: '#9caaa0', fontWeight: 500 }}>·</span> FreshBake Bakery</div>
              <div className="sp-order-sub">Supplier: ABC Ingredients</div>
            </div>
          </div>
          <div className="sp-order-details">
            <div><span className="sp-detail-label">Required delivery</span><span className="sp-detail-value" data-testid="text-required-delivery">24 October 2026</span></div>
            <div><span className="sp-detail-label">Order lines</span><span className="sp-detail-value">3 items</span></div>
          </div>
        </section>

        <div className="sp-workspace">
          <section className="sp-card sp-message-card">
            <div className="sp-card-heading">
              <div>
                <h2 className="sp-card-title">Supplier message</h2>
                <p className="sp-card-description">Paste the message you received. Nothing is sent or stored.</p>
              </div>
              <div className="sp-rule-pill" data-testid="status-rule-based"><Sparkles size={13} aria-hidden="true" /> Rule-based extraction</div>
            </div>
            <label className="sp-label" htmlFor="supplier-message">Message text</label>
            <textarea
              id="supplier-message"
              className="sp-textarea"
              value={message}
              onChange={(event) => { setMessage(event.target.value); setError(''); setAnalysis(null); }}
              placeholder="Paste supplier message here…"
              aria-describedby="message-help"
              data-testid="input-supplier-message"
            />
            <div className="sp-input-foot" id="message-help">
              <span>Plain text only. Review the result before acting.</span>
              <span aria-live="polite" data-testid="text-message-length">{message.length} characters</span>
            </div>
            <div className="sp-button-row">
              <button type="button" className="sp-primary-button" onClick={handleAnalyze} data-testid="button-check-discrepancies">
                <FileText size={16} aria-hidden="true" /> Check for discrepancies
              </button>
              <span className="sp-button-note">A simple, local rules check.<br />No AI guesswork.</span>
            </div>
            {error && (
              <div role="alert" className="sp-error" data-testid="status-analysis-error">
                <AlertCircle size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} aria-hidden="true" />{error}
              </div>
            )}
          </section>

          <aside className="sp-card sp-side-card" aria-label="Ordered items">
            <div className="sp-side-title"><ClipboardList size={17} aria-hidden="true" /> On this purchase order</div>
            {purchaseLines.map((line) => (
              <div className="sp-line" key={line.name} data-testid={`row-order-line-${line.name.toLowerCase()}`}>
                <span className="sp-line-name">{line.name}</span><span className="sp-line-qty">{line.quantity} kg</span>
              </div>
            ))}
            <div className="sp-side-foot"><CircleHelp size={15} aria-hidden="true" /><span>Only details stated in the message can be checked. Anything else stays unknown.</span></div>
          </aside>
        </div>

        {analysis && (
          <section className="sp-results" aria-live="polite" data-testid="section-analysis-results">
            <div className="sp-results-head">
              <h2 className="sp-results-title">Discrepancy check</h2>
              <span className="sp-results-caption" data-testid="text-issue-count">{issueCount} item{issueCount === 1 ? '' : 's'} need attention</span>
            </div>
            <div className="sp-summary" data-testid="status-analysis-summary">
              <AlertTriangle size={20} className="sp-summary-icon" aria-hidden="true" />
              <div>
                <strong>{issueCount > 0 ? 'Some details need follow-up' : 'The detected quantities match the order'}</strong>
                <span>Rule-based extraction from the message text. Check each line against the original supplier note.</span>
              </div>
            </div>
            <div className="sp-results-grid">
              <div className="sp-card sp-result-card">
                <h3>Line-by-line comparison</h3>
                <div className="sp-table-head"><span>Item</span><span>Ordered</span><span>Confirmed</span><span>Check</span></div>
                {analysis.lines.map((line) => (
                  <div className="sp-table-row" key={line.name} data-testid={`row-result-${line.name.toLowerCase()}`}>
                    <strong>{line.name}</strong>
                    <span>{line.ordered} kg</span>
                    <span>{line.unavailable ? '—' : line.confirmed === null ? 'Unknown' : `${line.confirmed} kg`}</span>
                    <span className={`sp-badge ${line.badge}`} data-testid={`status-line-${line.name.toLowerCase()}`}>{line.status}</span>
                  </div>
                ))}
              </div>
              <div className="sp-card sp-result-card">
                <h3>What needs attention</h3>
                <div className="sp-issue-list">
                  {analysis.lines.map((line) => (
                    <div className="sp-issue" key={line.name} data-testid={`explanation-${line.name.toLowerCase()}`}>
                      {line.badge === 'ok' ? <Check size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
                      <span><strong>{line.name}:</strong> {line.explanation}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sp-date-card" data-testid="status-delivery-date">
              <div className="sp-date-detail">
                <span className="sp-date-icon"><CalendarDays size={17} aria-hidden="true" /></span>
                <div>
                  <div className="sp-date-title">Delivery date comparison</div>
                  <div className="sp-date-sub">
                    {analysis.messageDate
                      ? `Required 24 Oct 2026 · Message says ${formatDate(analysis.messageDate)}`
                      : 'Required 24 Oct 2026 · No message delivery date detected'}
                  </div>
                </div>
              </div>
              <div className="sp-date-delta">
                {dateDelta === null ? 'Unknown' : dateDelta > 0 ? `${dateDelta} day${dateDelta === 1 ? '' : 's'} late` : dateDelta < 0 ? `${Math.abs(dateDelta)} day${dateDelta === -1 ? '' : 's'} early` : 'On time'}
              </div>
            </div>
            <div className="sp-unrecognized" data-testid="text-parsing-limits">
              Extraction limits: only item names, quantities followed by kg (or kilograms), explicit unavailable wording, and written dates are recognized. Unmentioned or unquantified details remain unknown; future timing such as “next week” is not converted into a date.
            </div>
          </section>
        )}
        <footer className="sp-footer">SUPPLYPILOT · STAGE 1 PROTOTYPE · ALL DATA SHOWN IS FICTIONAL</footer>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
