import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReview,
  decideReview,
  editReviewDraft,
  loadWorkflow,
  saveWorkflow,
  WORKFLOW_STORAGE_KEY,
  type KeyValueStorage,
  type WorkflowData,
} from './approval-workflow.ts';

function makeIds() {
  let next = 0;
  return () => `id-${++next}`;
}

function startReview(data: WorkflowData = { reviews: [], events: [], activeReviewId: null }) {
  return createReview(data, 'Supplier confirms 35kg flour.', 'Please confirm the remaining flour.', 'Demo Staff', 'Staff', {
    idFactory: makeIds(),
    now: () => '2026-10-23T01:00:00.000Z',
  });
}

test('Staff cannot approve or reject a pending review', () => {
  const data = startReview();
  const reviewId = data.activeReviewId!;
  const approved = decideReview(data, reviewId, 'Approved', 'Staff', 'Demo Staff');
  const rejected = decideReview(data, reviewId, 'Rejected', 'Staff', 'Demo Staff');

  assert.equal(approved.ok, false);
  assert.equal(rejected.ok, false);
  if (!approved.ok) assert.equal(approved.reason, 'owner_only');
  if (!rejected.ok) assert.equal(rejected.reason, 'owner_only');
  assert.equal(data.reviews[0].status, 'Pending');
  assert.equal(data.events.length, 1);
});

test('Owner can approve and approval event records actor, role, status, and summary', () => {
  const data = startReview();
  const result = decideReview(data, data.activeReviewId!, 'Approved', 'Owner', 'Demo Owner', {
    idFactory: makeIds(), now: () => '2026-10-23T01:05:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.reviews[0].status, 'Approved');
  assert.equal(result.data.events[0].actionType, 'approved');
  assert.equal(result.data.events[0].actor, 'Demo Owner');
  assert.equal(result.data.events[0].role, 'Owner');
  assert.equal(result.data.events[0].currentStatus, 'Approved');
  assert.match(result.data.events[0].summary, /approved/);
});

test('Owner can reject a pending review', () => {
  const data = startReview();
  const result = decideReview(data, data.activeReviewId!, 'Rejected', 'Owner', 'Demo Owner');

  assert.equal(result.ok, true);
  assert.equal(result.data.reviews[0].status, 'Rejected');
  assert.equal(result.data.events[0].actionType, 'rejected');
  assert.equal(result.data.events[0].currentStatus, 'Rejected');
});

test('edited draft is preserved and logged with the editing actor', () => {
  const data = startReview();
  const reviewId = data.activeReviewId!;
  const edited = editReviewDraft(data, reviewId, 'Please confirm the revised delivery date.', 'Demo Staff', 'Staff', {
    idFactory: makeIds(), now: () => '2026-10-23T01:10:00.000Z',
  });

  assert.equal(edited.reviews[0].followUpMessage, 'Please confirm the revised delivery date.');
  assert.equal(edited.events[0].actionType, 'draft_edited');
  assert.equal(edited.events[0].actor, 'Demo Staff');
  assert.equal(edited.events[0].role, 'Staff');

  const values = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  saveWorkflow(storage, edited);
  assert.equal(loadWorkflow(storage).data.reviews[0].followUpMessage, 'Please confirm the revised delivery date.');
});

test('localStorage save and reload preserve reviews and activity', () => {
  const values = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const firstReview = startReview();
  assert.equal(saveWorkflow(storage, firstReview), true);
  const secondReview = createReview(firstReview, 'Supplier confirms delivery on 24 Oct 2026.', 'Thanks, confirmed.', 'Demo Owner', 'Owner', { idFactory: makeIds() });
  assert.equal(saveWorkflow(storage, secondReview), true);

  const reloaded = loadWorkflow(storage);
  assert.equal(reloaded.warning, null);
  assert.equal(reloaded.data.reviews.length, 2);
  assert.equal(reloaded.data.events.length, 2);
  assert.equal(reloaded.data.activeReviewId, secondReview.activeReviewId);
  assert.equal(reloaded.data.events[1].actionType, 'analysis');
  assert.equal(values.has(WORKFLOW_STORAGE_KEY), true);
});

test('OpenRouter analyses are logged and legacy Gemini browser history remains readable', () => {
  const openrouter = createReview(
    { reviews: [], events: [], activeReviewId: null },
    'Supplier confirms 35kg flour.',
    'Please confirm the balance.',
    'Demo Staff',
    'Staff',
    { idFactory: makeIds(), analysisSource: 'openrouter' },
  );
  assert.equal(openrouter.reviews[0].analysisSource, 'openrouter');
  assert.match(openrouter.events[0].summary, /OpenRouter AI \(Free Router\)/);

  const legacy = createReview(
    { reviews: [], events: [], activeReviewId: null },
    'Previously analyzed message.',
    'Previous draft.',
    'Demo Staff',
    'Staff',
    { idFactory: makeIds(), analysisSource: 'gemini' },
  );
  const storage: KeyValueStorage = {
    getItem: () => JSON.stringify(legacy),
    setItem: () => undefined,
  };
  const restored = loadWorkflow(storage);
  assert.equal(restored.warning, null);
  assert.equal(restored.data.reviews[0].analysisSource, 'gemini');
});

test('duplicate final decisions do not create duplicate approval or rejection events', () => {
  const pending = startReview();
  const reviewId = pending.activeReviewId!;
  const approved = decideReview(pending, reviewId, 'Approved', 'Owner', 'Demo Owner');
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const duplicate = decideReview(approved.data, reviewId, 'Approved', 'Owner', 'Demo Owner');
  const conflicting = decideReview(approved.data, reviewId, 'Rejected', 'Owner', 'Demo Owner');
  assert.equal(duplicate.ok, false);
  assert.equal(conflicting.ok, false);
  assert.equal(approved.data.events.filter((event) => event.actionType === 'approved' || event.actionType === 'rejected').length, 1);
});

test('a new analysis creates a pending review without deleting prior audit records', () => {
  const first = startReview();
  const second = createReview(first, 'New supplier response', 'Please confirm quantities.', 'Demo Staff', 'Staff', { idFactory: makeIds() });

  assert.equal(second.reviews.length, 2);
  assert.equal(second.events.length, 2);
  assert.equal(second.reviews.find((review) => review.id === first.activeReviewId)?.status, 'Pending');
  assert.equal(second.reviews[0].status, 'Pending');
  assert.equal(second.events.some((event) => event.reviewId === first.activeReviewId), true);
});

test('corrupted and unavailable browser storage are handled without throwing', () => {
  const corrupted: KeyValueStorage = { getItem: () => '{broken', setItem: () => undefined };
  assert.match(loadWorkflow(corrupted).warning ?? '', /could not be read/);
  assert.equal(loadWorkflow(null).data.events.length, 0);
  assert.equal(saveWorkflow(null, startReview()), false);
  const throwing: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.ok(loadWorkflow(throwing).warning);
  assert.equal(saveWorkflow(throwing, startReview()), false);
});
