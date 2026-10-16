import type { ReviewStatus } from './types';
export type ReviewDraft = { version: 1; review_status: ReviewStatus; notes: string; personal_tags: string };
export const reviewDraftKey = (id: string) => `tubescope.review.v1.${id}`;
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readReviewDraft(storage: DraftStorage | undefined, id: string): ReviewDraft | null {
  try {
    const value = JSON.parse(storage?.getItem(reviewDraftKey(id)) || 'null');
    return value?.version === 1 && ['todo','keep','skip'].includes(value.review_status) && typeof value.notes === 'string' && typeof value.personal_tags === 'string' ? value : null;
  } catch { return null; }
}
export function writeReviewDraft(storage: DraftStorage | undefined, id: string, draft: ReviewDraft | null): void {
  try { if (draft) storage?.setItem(reviewDraftKey(id), JSON.stringify(draft)); else storage?.removeItem(reviewDraftKey(id)); } catch { /* Browsers may disable session storage. The editor and explicit save remain available. */ }
}
