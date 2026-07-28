'use client';

import { TriangleAlert } from 'lucide-react';
import { EmptyState } from './empty-state';
import { Button } from '@/components/ui/button';

/**
 * What a list shows when its request FAILED — as opposed to genuinely having nothing
 * in it.
 *
 * Most screens used to destructure only `{ data, isLoading }`, so a dropped connection
 * left `data` undefined, the list fell back to an empty array, and the "nothing here
 * yet" state rendered. On patchy mobile data that told people they had no tasks or no
 * team when in fact the request never arrived — and offered nothing to do about it.
 *
 * Render this instead whenever `isError` is set and there is no cached data to show.
 */
export function QueryError({ title = 'Couldn’t load this', error, onRetry, className }) {
  return (
    <EmptyState
      icon={TriangleAlert}
      title={title}
      description={error?.message || 'Something went wrong on the way. Check your connection and try again.'}
      action={onRetry ? <Button variant="outline" onClick={() => onRetry()}>Try again</Button> : null}
      className={className}
    />
  );
}
