import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarDays, Check, CircleHelp, ClipboardList, FileText, ShieldCheck, Sparkles, Wheat } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  analyzeMessage,
  buildClarificationMessage,
  formatDate,
  getAnalysisOverview,
  purchaseLines,
  type Analysis,
} from './message-analysis';

const queryClient = new QueryClient();
const initialMessage = 'Hi boss, we can deliver 35kg flour and 20kg butter on 26 Oct 2026. Sugar is currently unavailable. Remaining flour can be delivered next week.';

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
    setError('');
    setAnalysis(analyzeMessage(message));
  }

  const overview = analysis ? getAnalysisOverview(analysis) : null;
  const dateDelta = overview?.dateDelta ?? null;
  const issueSummary = overview
    ? [
        overview.confirmedIssueCount > 0
          ? `${overview.confirmedIssueCount} confirmed ${overview.confirmedIssueCount === 1 ? 'issue' : 'issues'}`
          : '',
        overview.missingConfirmationCount > 0
          ? `${overview.missingConfirmationCount} missing ${overview.missingConfirmationCount === 1 ? 'confirmation' : 'confirmations'}`
          : '',
      ].filter(Boolean).join(' · ') || 'No discrepancies or missing confirmations'
    : '';

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
              <span className="sp-results-caption" data-testid="text-issue-count">{issueSummary}</span>
            </div>
            <div className={`sp-summary${overview?.hasConfirmedIssue ? '' : overview?.needsReview ? ' sp-summary-neutral' : ' sp-summary-success'}`} data-testid="status-analysis-summary">
              {overview?.needsReview
                ? <AlertTriangle size={20} className="sp-summary-icon" aria-hidden="true" />
                : <Check size={20} className="sp-summary-icon" aria-hidden="true" />}
              <div>
                <strong data-testid="text-analysis-status">
                  {overview?.needsReview ? 'Analysis Complete — Needs Review' : 'Analysis Complete — Confirmed'}
                </strong>
                <span>Rule-based extraction. Missing confirmations are shown separately from explicit shortages or delivery differences.</span>
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
                    <span>{line.unavailable ? '—' : line.confirmed === null ? 'Not Confirmed' : `${line.confirmed} kg`}</span>
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
                      ? `Required 24 Oct 2026 · Supplier says ${formatDate(analysis.messageDate)}`
                      : 'Required 24 Oct 2026 · Supplier delivery date not confirmed'}
                  </div>
                </div>
              </div>
              <div className={`sp-date-delta${dateDelta === null ? ' is-neutral' : ''}`} data-testid="text-delivery-status">
                {dateDelta === null ? 'Not Confirmed' : dateDelta > 0 ? `${dateDelta} day${dateDelta === 1 ? '' : 's'} late` : dateDelta < 0 ? `${Math.abs(dateDelta)} day${dateDelta === -1 ? '' : 's'} early` : 'On time'}
              </div>
            </div>
            {overview?.needsReview && (
              <div className="sp-next-step" data-testid="card-recommended-next-step">
                <div className="sp-next-step-heading">
                  <div>
                    <div className="sp-next-step-label">Recommended next action</div>
                    <strong data-testid="text-recommended-action">Request confirmation from supplier</strong>
                  </div>
                  <span className="sp-next-step-note">Suggested clarification · Not sent</span>
                </div>
                <p data-testid="text-suggested-clarification">{buildClarificationMessage(analysis)}</p>
              </div>
            )}
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
