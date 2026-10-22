import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeMessage,
  buildClarificationMessage,
  getAnalysisOverview,
} from './message-analysis.ts';

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
