import { EmptyState } from '@/components/ui/EmptyState';

/**
 * The body of an /admin section whose read failed. The page reads every
 * section at once, and one failed read must not take the operator tools
 * down with it: the section keeps its heading and says so in words.
 */
export function LoadFailed({ what }: { what: string }) {
  return (
    <EmptyState
      title={`Couldn't load ${what}`}
      description="The rest of this page is unaffected. Reload to try again."
      headingLevel={3}
    />
  );
}
