import { type ReactNode, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarDays, Check, CircleHelp, ClipboardList, FileText, ShieldCheck, Sparkles, Wheat } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  analyzeMessage,
  analyzeExtractedMessage,
  buildClarificationMessage,
  formatDate,
  getAnalysisOverview,
  purchaseLines,
  type Analysis,
} from './message-analysis';
import { SupplierExtractionSchema, type SupplierExtraction } from '@workspace/api-zod/supplierExtraction';
import {
  createReview,
  decideReview,
  editReviewDraft,
  loadWorkflow,
  PURCHASE_ORDER_ID,
  saveWorkflow,
  type DemoRole,
  type ReviewStatus,
  type WorkflowData,
} from './approval-workflow';

const queryClient = new QueryClient();
const initialMessage = 'Hi boss, we can deliver 35kg flour and 20kg butter on 26 Oct 2026. Sugar is currently unavailable. Remaining flour can be delivered next week.';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function getInitialWorkflow() {
  const storage = browserStorage();
  const loaded = loadWorkflow(storage);
  if (loaded.data.reviews.length > 0) return loaded;
  const seeded = createReview(loaded.data, initialMessage, buildClarificationMessage(analyzeMessage(initialMessage)), 'Demo Staff', 'Staff');
  const saved = loaded.warning ? false : saveWorkflow(storage, seeded);
  return {
    data: seeded,
    warning: loaded.warning ?? (saved ? null : 'Browser storage is unavailable or full. Changes will last only until this page closes.'),
  };
}

function actorFor(role: DemoRole) {
  return role === 'Owner' ? 'Demo Owner' : 'Demo Staff';
}

function prettyTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const statusLabel: Record<ReviewStatus, string> = { Pending: 'Awaiting owner decision', Approved: 'Approved', Rejected: 'Rejected' };

function Home() {
  const [workflowState, setWorkflowState] = useState(getInitialWorkflow);
  const [message, setMessage] = useState(() => workflowState.data.reviews.find((review) => review.id === workflowState.data.activeReviewId)?.supplierMessage ?? initialMessage);
  const [role, setRole] = useState<DemoRole>('Staff');
  const [draftInput, setDraftInput] = useState(() => workflowState.data.reviews.find((review) => review.id === workflowState.data.activeReviewId)?.followUpMessage ?? '');
  const [workflowFeedback, setWorkflowFeedback] = useState('');
  const [error, setError] = useState('');
  const [analysisMode, setAnalysisMode] = useState<'openrouter' | 'rules'>('openrouter');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const analysisInFlight = useRef(false);

  const workflow = workflowState.data;
  const activeReview = workflow.reviews.find((review) => review.id === workflow.activeReviewId) ?? null;
  const analysis: Analysis | null = activeReview
    ? (activeReview.analysisSource === 'openrouter' || activeReview.analysisSource === 'gemini') && activeReview.extraction
      ? analyzeExtractedMessage(activeReview.extraction)
      : analyzeMessage(activeReview.supplierMessage)
    : null;
  const storage = browserStorage();

  function commitWorkflow(next: WorkflowData) {
    const saved = saveWorkflow(storage, next);
    setWorkflowState({
      data: next,
      warning: saved ? null : 'Browser storage is unavailable or full. Changes will last only until this page closes.',
    });
  }

  async function handleAnalyze() {
    if (analysisInFlight.current) return;
    if (!message.trim()) {
      setError('Add the supplier’s message before checking it. You can paste the relevant WhatsApp-style text here.');
      return;
    }
    if (message.length > 5000) {
      setError('Supplier messages must be 5,000 characters or fewer.');
      return;
    }
    analysisInFlight.current = true;
    setAnalysisBusy(true);
    setError('');
    setAnalysisNotice('');
    let source: 'openrouter' | 'rules' = 'rules';
    let extraction: SupplierExtraction | undefined;
    let compared = analyzeMessage(message);
    if (analysisMode === 'openrouter') {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 65_000);
      try {
        const response = await fetch('/api/analyze-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        const data = payload as { error?: unknown; extraction?: unknown };
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'OpenRouter analysis could not be completed.');
        const parsed = SupplierExtractionSchema.safeParse(data.extraction);
        if (!parsed.success) throw new Error('OpenRouter result did not pass browser validation. Rule-based results are shown instead.');
        extraction = parsed.data;
        compared = analyzeExtractedMessage(extraction);
        source = 'openrouter';
      } catch (cause) {
        const reason = cause instanceof Error && cause.name === 'AbortError'
          ? 'OpenRouter request timed out.'
          : cause instanceof TypeError
            ? 'Could not reach the OpenRouter API server.'
            : cause instanceof SyntaxError
              ? 'OpenRouter API server returned an unreadable response.'
              : cause instanceof Error ? cause.message : 'OpenRouter analysis is unavailable.';
        setAnalysisNotice(`${reason} Showing the rule-based result instead; no AI result was used.`);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    const next = createReview(workflow, message, buildClarificationMessage(compared), actorFor(role), role, {
      analysisSource: source,
      ...(extraction ? { extraction } : {}),
    });
    setDraftInput(next.reviews[0].followUpMessage);
    setWorkflowFeedback('A new review was created as Pending. Earlier activity remains in the log.');
    commitWorkflow(next);
    setAnalysisBusy(false);
    analysisInFlight.current = false;
  }

  function handleSaveDraft() {
    if (!activeReview || activeReview.status !== 'Pending') return;
    const next = editReviewDraft(workflow, activeReview.id, draftInput, actorFor(role), role);
    if (next === workflow) return;
    commitWorkflow(next);
    setWorkflowFeedback('Draft saved. It has not been sent to the supplier.');
  }

  function handleDecision(decision: 'Approved' | 'Rejected') {
    if (role !== 'Owner') {
      setWorkflowFeedback('Only the demo Owner can approve or reject this review.');
      return;
    }
    if (!activeReview) return;
    let next = workflow;
    if (activeReview.status !== 'Pending') {
      setWorkflowFeedback('This review already has a final decision.');
      return;
    }
    if (draftInput !== activeReview.followUpMessage) {
      next = editReviewDraft(next, activeReview.id, draftInput, actorFor(role), role);
    }
    const result = decideReview(next, activeReview.id, decision, role, actorFor(role));
    if (!result.ok) {
      setWorkflowFeedback(result.reason === 'owner_only' ? 'Only the demo Owner can approve or reject this review.' : 'This review can no longer be changed.');
      return;
    }
    commitWorkflow(result.data);
    setWorkflowFeedback(decision === 'Approved' ? 'Review approved. The message remains a draft until you copy it and send it yourself.' : 'Review rejected. No message was sent.');
  }

  async function handleCopyApprovedMessage() {
    if (!activeReview || activeReview.status !== 'Approved' || !activeReview.followUpMessage.trim()) return;
    try {
      await navigator.clipboard.writeText(activeReview.followUpMessage);
      setWorkflowFeedback('Approved message copied. It has not been sent to the supplier.');
    } catch {
      setWorkflowFeedback('Clipboard access is unavailable here. You can select and copy the approved message manually.');
    }
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
        <div className="sp-top-meta"><ShieldCheck size={15} aria-hidden="true" /><span>PRIVATE STAGE 3 DEMO</span></div>
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
                <p className="sp-card-description">Paste the message you received. Review data is saved only in this browser for the demo.</p>
              </div>
              <div className="sp-rule-pill" data-testid="status-analysis-mode"><Sparkles size={13} aria-hidden="true" /> {analysisMode === 'openrouter' ? 'OpenRouter AI (Free Router)' : 'Rule-based demo'}</div>
            </div>
            <label className="sp-label" htmlFor="supplier-message">Message text</label>
            <textarea
              id="supplier-message"
              className="sp-textarea"
              value={message}
              onChange={(event) => { setMessage(event.target.value); setError(''); }}
              placeholder="Paste supplier message here…"
              maxLength={5000}
              aria-describedby="message-help"
              data-testid="input-supplier-message"
            />
            <div className="sp-input-foot" id="message-help">
              <span>Use synthetic demo text only. OpenRouter mode sends this text to a dynamically selected free model.</span>
              <span aria-live="polite" data-testid="text-message-length">{message.length} characters</span>
            </div>
            <div className="sp-button-row">
              <label className="sp-mode-control" htmlFor="analysis-mode">Analysis mode
                <select id="analysis-mode" value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value as 'openrouter' | 'rules')} data-testid="select-analysis-mode">
                  <option value="openrouter">OpenRouter AI (Free Router)</option>
                  <option value="rules">Rule-based demo (offline)</option>
                </select>
              </label>
              <button type="button" className="sp-primary-button" onClick={handleAnalyze} disabled={analysisBusy} data-testid="button-check-discrepancies">
                <FileText size={16} aria-hidden="true" /> {analysisBusy ? 'Analyzing…' : 'Check for discrepancies'}
              </button>
              <span className="sp-button-note">{analysisMode === 'openrouter' ? 'Free Router extracts evidence; PO checks stay deterministic. Allow up to 60 seconds.' : 'Local rules only. No AI request is sent.'}</span>
            </div>
            {analysisBusy && <div className="sp-workflow-feedback" role="status" aria-live="polite">Analyzing supplier message…</div>}
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

        <section className="sp-review-controls" aria-label="Demo approval controls">
          <div className="sp-role-control">
            <label htmlFor="demo-role">Demo role</label>
            <select id="demo-role" value={role} onChange={(event) => { setRole(event.target.value as DemoRole); setWorkflowFeedback(''); }} data-testid="select-demo-role">
              <option value="Staff">Staff</option>
              <option value="Owner">Owner</option>
            </select>
            <span>Demo-only simulated access control</span>
          </div>
          {activeReview && <div className={`sp-status-pill is-${activeReview.status.toLowerCase()}`} data-testid="status-review">{statusLabel[activeReview.status]}</div>}
        </section>
        {workflowState.warning && <div className="sp-storage-warning" role="status" data-testid="status-storage-warning">{workflowState.warning}</div>}

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
                <span>{activeReview?.analysisSource === 'openrouter' || activeReview?.analysisSource === 'gemini' ? `${activeReview.analysisSource === 'openrouter' ? 'OpenRouter AI (Free Router)' : 'Legacy Gemini AI'} extracted supplier evidence; deterministic TypeScript compared validated facts with the purchase order.` : 'Rule-based fallback/demo extraction. Missing confirmations are shown separately from explicit shortages or delivery differences.'}</span>
              </div>
            </div>
            {(activeReview?.analysisSource === 'openrouter' || activeReview?.analysisSource === 'gemini') && <div className="sp-unrecognized" data-testid="status-openrouter-analysis">Source: {activeReview.analysisSource === 'openrouter' ? 'OpenRouter AI (Free Router)' : 'Legacy Gemini AI'}. Supporting evidence is extracted from the supplier message; purchase-order comparison remains deterministic.</div>}
            {activeReview?.analysisSource !== 'openrouter' && activeReview?.analysisSource !== 'gemini' && <div className="sp-unrecognized" data-testid="status-rules-analysis">Source: Rule-based {analysisMode === 'rules' ? 'demo' : 'fallback'}. This result is not AI-generated.</div>}
            {analysisNotice && <div role="status" className="sp-error" data-testid="status-analysis-fallback">{analysisNotice}</div>}
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
                      <span><strong>{line.name}:</strong> {line.explanation}{line.evidence?.map((quote, index) => <small className="sp-evidence-quote" key={`${index}-${quote}`}>Evidence: “{quote}”</small>)}</span>
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
                  <span className="sp-next-step-note">Draft · Not sent</span>
                </div>
                <label className="sp-label" htmlFor="follow-up-draft">Supplier follow-up draft</label>
                <textarea id="follow-up-draft" className="sp-textarea sp-draft-textarea" value={draftInput} onChange={(event) => setDraftInput(event.target.value)} disabled={activeReview?.status !== 'Pending'} data-testid="input-follow-up-draft" />
                <div className="sp-draft-actions">
                  <span>This message has not been sent. Review and edit it before the Owner decides.</span>
                  <button type="button" className="sp-secondary-button" onClick={handleSaveDraft} disabled={activeReview?.status !== 'Pending' || draftInput === activeReview?.followUpMessage}>Save draft</button>
                </div>
              </div>
            )}
            <div className="sp-unrecognized" data-testid="text-parsing-limits">
              Extraction limits: only item names, quantities followed by kg (or kilograms), explicit unavailable wording, and written dates are recognized. Unmentioned or unquantified details remain unknown; future timing such as “next week” is not converted into a date.
            </div>
          </section>
        )}
        {activeReview && (
          <section className="sp-approval-card" aria-label="Human approval" data-testid="section-human-approval">
            <div className="sp-approval-copy">
              <div className="sp-next-step-label">Human decision · {PURCHASE_ORDER_ID}</div>
              <strong>{activeReview.status === 'Pending' ? 'Owner review required' : `Review ${activeReview.status.toLowerCase()}`}</strong>
              <span>{activeReview.status === 'Pending' ? 'The Owner checks the comparison and draft, then records a decision.' : `Decision recorded by ${workflow.events.find((event) => event.reviewId === activeReview.id && (event.actionType === 'approved' || event.actionType === 'rejected'))?.actor ?? 'Demo Owner'}.`}</span>
            </div>
            <div className="sp-approval-actions">
              <button type="button" className="sp-reject-button" onClick={() => handleDecision('Rejected')} disabled={role !== 'Owner' || activeReview.status !== 'Pending'} data-testid="button-reject">Reject</button>
              <button type="button" className="sp-approve-button" onClick={() => handleDecision('Approved')} disabled={role !== 'Owner' || activeReview.status !== 'Pending'} data-testid="button-approve"><Check size={15} aria-hidden="true" /> Approve</button>
            </div>
            {role !== 'Owner' && activeReview.status === 'Pending' && <p className="sp-role-hint">Switch to the demo Owner role to record the approval decision.</p>}
          </section>
        )}

        {activeReview?.status === 'Approved' && activeReview.followUpMessage.trim() && (
          <section className="sp-approved-message" aria-label="Approved message output" data-testid="section-approved-message">
            <div><strong>Approved message</strong><span>Copy it if you choose to contact the supplier. SupplyPilot never sends it automatically.</span></div>
            <textarea className="sp-textarea" value={activeReview.followUpMessage} readOnly data-testid="text-approved-message" />
            <button type="button" className="sp-secondary-button" onClick={handleCopyApprovedMessage} data-testid="button-copy-approved"><FileText size={14} aria-hidden="true" /> Copy approved message</button>
          </section>
        )}

        {workflowFeedback && <div className="sp-workflow-feedback" role="status" aria-live="polite" data-testid="text-workflow-feedback">{workflowFeedback}</div>}

        <section className="sp-activity-card" aria-label="Activity log" data-testid="section-activity-log">
          <div className="sp-activity-heading"><div><div className="sp-next-step-label">This browser only · Demo activity</div><h2>Activity log</h2></div><span>{workflow.events.length} {workflow.events.length === 1 ? 'event' : 'events'}</span></div>
          {workflow.events.length === 0 ? <p className="sp-activity-empty">No activity recorded yet.</p> : (
            <ol className="sp-activity-list">
              {workflow.events.slice(0, 12).map((event) => (
                <li key={event.id} data-testid={`activity-${event.actionType}-${event.id}`}>
                  <span className={`sp-activity-dot is-${event.currentStatus.toLowerCase()}`} aria-hidden="true" />
                  <div><strong>{event.actionType === 'analysis' ? 'Message analyzed' : event.actionType === 'draft_edited' ? 'Follow-up draft edited' : event.actionType === 'approved' ? 'Review approved' : 'Review rejected'}</strong><span>{event.summary}</span><small>{event.actor} · {event.role} · {prettyTimestamp(event.timestamp)} · {event.purchaseOrderId} · {event.currentStatus}</small></div>
                </li>
              ))}
            </ol>
          )}
          <p className="sp-activity-note">Demo record stored in this browser’s localStorage. It is not a production audit log.</p>
        </section>
        <footer className="sp-footer">SUPPLYPILOT · STAGE 3 DEMO · ALL DATA SHOWN IS FICTIONAL</footer>
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
