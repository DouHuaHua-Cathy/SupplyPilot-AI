export type DemoRole = 'Staff' | 'Owner';
export type ReviewStatus = 'Pending' | 'Approved' | 'Rejected';
export type ActivityAction = 'analysis' | 'draft_edited' | 'approved' | 'rejected';

export type ReviewRecord = {
  id: string;
  purchaseOrderId: string;
  supplierMessage: string;
  followUpMessage: string;
  status: ReviewStatus;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  reviewId: string;
  purchaseOrderId: string;
  actionType: ActivityAction;
  actor: string;
  role: DemoRole;
  timestamp: string;
  currentStatus: ReviewStatus;
  summary: string;
};

export type WorkflowData = {
  reviews: ReviewRecord[];
  events: ActivityEvent[];
  activeReviewId: string | null;
};

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const WORKFLOW_STORAGE_KEY = 'supplypilot-demo-workflow-v1';
export const PURCHASE_ORDER_ID = 'PO-1024';

export const emptyWorkflow = (): WorkflowData => ({
  reviews: [],
  events: [],
  activeReviewId: null,
});

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReview(value: unknown): value is ReviewRecord {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.purchaseOrderId === 'string' &&
    typeof value.supplierMessage === 'string' &&
    typeof value.followUpMessage === 'string' &&
    (value.status === 'Pending' || value.status === 'Approved' || value.status === 'Rejected') &&
    typeof value.createdAt === 'string';
}

function isEvent(value: unknown): value is ActivityEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.reviewId === 'string' &&
    typeof value.purchaseOrderId === 'string' &&
    (value.actionType === 'analysis' || value.actionType === 'draft_edited' || value.actionType === 'approved' || value.actionType === 'rejected') &&
    typeof value.actor === 'string' &&
    (value.role === 'Staff' || value.role === 'Owner') &&
    typeof value.timestamp === 'string' &&
    (value.currentStatus === 'Pending' || value.currentStatus === 'Approved' || value.currentStatus === 'Rejected') &&
    typeof value.summary === 'string';
}

export function loadWorkflow(storage: KeyValueStorage | null): { data: WorkflowData; warning: string | null } {
  if (!storage) return { data: emptyWorkflow(), warning: 'Browser storage is unavailable. Changes will last only until this page closes.' };
  try {
    const raw = storage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return { data: emptyWorkflow(), warning: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.reviews) || !Array.isArray(parsed.events) ||
      !(typeof parsed.activeReviewId === 'string' || parsed.activeReviewId === null) ||
      !parsed.reviews.every(isReview) || !parsed.events.every(isEvent) ||
      (typeof parsed.activeReviewId === 'string' && !parsed.reviews.some((review) => isReview(review) && review.id === parsed.activeReviewId))) {
      return { data: emptyWorkflow(), warning: 'Saved demo activity could not be read. A fresh review is available; previous browser data was left untouched.' };
    }
    return { data: parsed as WorkflowData, warning: null };
  } catch {
    return { data: emptyWorkflow(), warning: 'Saved demo activity could not be read. A fresh review is available; previous browser data was left untouched.' };
  }
}

export function saveWorkflow(storage: KeyValueStorage | null, data: WorkflowData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function addEvent(
  data: WorkflowData,
  review: ReviewRecord,
  actionType: ActivityAction,
  actor: string,
  role: DemoRole,
  summary: string,
  timestamp: string,
  idFactory: () => string,
): WorkflowData {
  return {
    ...data,
    events: [{
      id: idFactory(),
      reviewId: review.id,
      purchaseOrderId: review.purchaseOrderId,
      actionType,
      actor,
      role,
      timestamp,
      currentStatus: review.status,
      summary,
    }, ...data.events],
  };
}

export function createReview(
  data: WorkflowData,
  supplierMessage: string,
  followUpMessage: string,
  actor: string,
  role: DemoRole,
  options: { idFactory?: () => string; now?: () => string } = {},
): WorkflowData {
  const idFactory = options.idFactory ?? createId;
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  const review: ReviewRecord = {
    id: idFactory(),
    purchaseOrderId: PURCHASE_ORDER_ID,
    supplierMessage,
    followUpMessage,
    status: 'Pending',
    createdAt: timestamp,
  };
  const next = { ...data, reviews: [review, ...data.reviews], activeReviewId: review.id };
  return addEvent(next, review, 'analysis', actor, role, `Supplier message analyzed: ${supplierMessage.slice(0, 180)}`, timestamp, idFactory);
}

export function editReviewDraft(
  data: WorkflowData,
  reviewId: string,
  followUpMessage: string,
  actor: string,
  role: DemoRole,
  options: { idFactory?: () => string; now?: () => string } = {},
): WorkflowData {
  const review = data.reviews.find((item) => item.id === reviewId);
  if (!review || review.status !== 'Pending') return data;
  const updated = { ...review, followUpMessage };
  const next = { ...data, reviews: data.reviews.map((item) => item.id === reviewId ? updated : item) };
  return addEvent(next, updated, 'draft_edited', actor, role, `Follow-up draft edited: ${followUpMessage.slice(0, 180)}`, (options.now ?? (() => new Date().toISOString()))(), options.idFactory ?? createId);
}

export type DecisionResult = { data: WorkflowData; ok: true } | { data: WorkflowData; ok: false; reason: 'owner_only' | 'already_decided' | 'no_review' };

export function decideReview(
  data: WorkflowData,
  reviewId: string,
  decision: 'Approved' | 'Rejected',
  role: DemoRole,
  actor: string,
  options: { idFactory?: () => string; now?: () => string } = {},
): DecisionResult {
  if (role !== 'Owner') return { data, ok: false, reason: 'owner_only' };
  const review = data.reviews.find((item) => item.id === reviewId);
  if (!review) return { data, ok: false, reason: 'no_review' };
  if (review.status !== 'Pending') return { data, ok: false, reason: 'already_decided' };
  const updated = { ...review, status: decision };
  const next = { ...data, reviews: data.reviews.map((item) => item.id === reviewId ? updated : item) };
  return {
    data: addEvent(next, updated, decision === 'Approved' ? 'approved' : 'rejected', actor, role,
      decision === 'Approved' ? `Owner approved the review${updated.followUpMessage ? ' and its follow-up draft' : ''}.` : 'Owner rejected the review.',
      (options.now ?? (() => new Date().toISOString()))(), options.idFactory ?? createId),
    ok: true,
  };
}
