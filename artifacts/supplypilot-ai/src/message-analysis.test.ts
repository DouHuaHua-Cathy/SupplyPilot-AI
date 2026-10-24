import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeMessage,
  analyzeExtractedMessage,
  buildClarificationMessage,
  getAnalysisOverview,
} from './message-analysis.ts';

function fact(name: string, options: { quantity?: number | null; unit?: string | null; availability?: 'available' | 'unavailable' | 'unknown'; confirmed?: boolean; ambiguous?: boolean; evidence?: string[] } = {}) {
  return {
    productName: name, aliases: [], quantity: options.quantity ?? null, unit: options.unit ?? null,
    availability: options.availability ?? 'unknown', confirmed: options.confirmed ?? false,
    ambiguous: options.ambiguous ?? false, evidence: options.evidence ?? [],
  };
}

function extracted(items: ReturnType<typeof fact>[], dates: { dateISO: string | null; confirmed: boolean; ambiguous: boolean; evidence: string[] }[] = []) {
  return { items, deliveryDates: dates, missingDetails: [] };
}

test('fully confirmed order is complete with no discrepancies or missing details', () => {
  const analysis = analyzeMessage(
    'We can deliver 50kg flour, 20kg butter, and 30kg sugar on 24 Oct 2026.',
  );
  const overview = getAnalysisOverview(analysis);

  assert.deepEqual(analysis.lines.map((line) => line.status), [
    'Fully confirmed',
    'Fully confirmed',
    'Fully confirmed',
  ]);
  assert.equal(overview.dateDelta, 0);
  assert.equal(overview.confirmedIssueCount, 0);
  assert.equal(overview.missingConfirmationCount, 0);
  assert.equal(overview.needsReview, false);
  assert.doesNotMatch(buildClarificationMessage(analysis), /Could you please confirm/);
});

test('partial delivery keeps shortages and late delivery as confirmed issues', () => {
  const analysis = analyzeMessage(
    'Hi boss, we can deliver 35kg flour and 20kg butter on 26 Oct 2026. Sugar is currently unavailable. Remaining flour can be delivered next week.',
  );
  const overview = getAnalysisOverview(analysis);
  const clarification = buildClarificationMessage(analysis);

  assert.equal(analysis.lines[0].status, '15 kg short');
  assert.equal(analysis.lines[1].status, 'Fully confirmed');
  assert.equal(analysis.lines[2].status, 'Unavailable');
  assert.equal(overview.dateDelta, 2);
  assert.equal(overview.confirmedIssueCount, 3);
  assert.equal(overview.missingConfirmationCount, 0);
  assert.equal(overview.needsReview, true);
  assert.match(clarification, /remaining 15 kg of flour/);
  assert.match(clarification, /ordered 30 kg of sugar/);
  assert.match(clarification, /26 October 2026/);
});

test('incomplete supplier response is reviewable, with missing details left unconfirmed', () => {
  const analysis = analyzeMessage(
    'Hi, we will update you about the delivery soon.',
  );
  const overview = getAnalysisOverview(analysis);
  const clarification = buildClarificationMessage(analysis);

  assert.deepEqual(analysis.lines.map((line) => line.status), [
    'Not Confirmed',
    'Not Confirmed',
    'Not Confirmed',
  ]);
  assert.equal(analysis.lines[0].confirmed, null);
  assert.equal(analysis.lines[1].confirmed, null);
  assert.equal(analysis.lines[2].confirmed, null);
  assert.equal(analysis.messageDate, null);
  assert.equal(overview.dateDelta, null);
  assert.equal(overview.confirmedIssueCount, 0);
  assert.equal(overview.missingConfirmationCount, 4);
  assert.equal(overview.needsReview, true);
  assert.match(clarification, /ordered 50 kg of flour/);
  assert.match(clarification, /ordered 20 kg of butter/);
  assert.match(clarification, /ordered 30 kg of sugar/);
  assert.match(clarification, /the delivery date/);
  assert.doesNotMatch(clarification, /on 24 October 2026/);
});

test('validated extracted facts confirm normal PO quantities and a clear delivery date', () => {
  const analysis = analyzeExtractedMessage(extracted([
    fact('flour', { quantity: 50, unit: 'kg', availability: 'available', confirmed: true }),
    fact('butter', { quantity: 20, unit: 'kg', availability: 'available', confirmed: true }),
    fact('sugar', { quantity: 30, unit: 'kg', availability: 'available', confirmed: true }),
  ], [{ dateISO: '2026-10-24', confirmed: true, ambiguous: false, evidence: ['on 24 Oct 2026'] }]));
  assert.deepEqual(analysis.lines.map((line) => line.status), ['Fully confirmed', 'Fully confirmed', 'Fully confirmed']);
  assert.equal(getAnalysisOverview(analysis).dateDelta, 0);
});

test('validated extracted facts retain a shortage, unavailability, and late date for deterministic comparison', () => {
  const analysis = analyzeExtractedMessage(extracted([
    fact('flour', { quantity: 35, unit: 'kg', availability: 'available', confirmed: true, evidence: ['35kg flour'] }),
    fact('butter', { quantity: 20, unit: 'kg', availability: 'available', confirmed: true }),
    fact('sugar', { quantity: 30, unit: 'kg', availability: 'unavailable', confirmed: true }),
  ], [{ dateISO: '2026-10-26', confirmed: true, ambiguous: false, evidence: ['on 26 Oct 2026'] }]));
  assert.equal(analysis.lines[0].status, '15 kg short');
  assert.equal(analysis.lines[2].status, 'Unavailable');
  assert.equal(getAnalysisOverview(analysis).dateDelta, 2);
  assert.deepEqual(analysis.lines[0].evidence, ['35kg flour']);
});

test('incomplete extraction leaves unconfirmed quantities and dates unknown', () => {
  const analysis = analyzeExtractedMessage(extracted([]));
  assert.deepEqual(analysis.lines.map((line) => line.status), ['Not Confirmed', 'Not Confirmed', 'Not Confirmed']);
  assert.deepEqual(analysis.lines.map((line) => line.confirmed), [null, null, null]);
  assert.equal(analysis.messageDate, null);
});

test('negated supply is treated as unavailable, never as a positive quantity confirmation', () => {
  const analysis = analyzeExtractedMessage(extracted([
    fact('flour', { quantity: 20, unit: 'kg', availability: 'unavailable', confirmed: true, evidence: ['cannot supply 20kg flour'] }),
  ]));
  assert.equal(analysis.lines[0].status, 'Unavailable');
  assert.equal(analysis.lines[0].confirmed, null);
});

test('conflicting quantities and multiple confirmed dates remain unconfirmed', () => {
  const analysis = analyzeExtractedMessage(extracted([
    fact('flour', { quantity: 20, unit: 'kg', availability: 'available', confirmed: true }),
    fact('flour', { quantity: 35, unit: 'kg', availability: 'available', confirmed: true }),
  ], [
    { dateISO: '2026-10-24', confirmed: true, ambiguous: false, evidence: ['on 24 Oct 2026'] },
    { dateISO: '2026-10-26', confirmed: true, ambiguous: false, evidence: ['on 26 Oct 2026'] },
  ]));
  assert.equal(analysis.lines[0].confirmed, null);
  assert.equal(analysis.lines[0].status, 'Not Confirmed');
  assert.equal(analysis.messageDate, null);
});
