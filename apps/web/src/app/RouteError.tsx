import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { ErrorState } from '../design/States';

/**
 * Error boundary for render errors, so a crash never shows a blank page.
 *
 * The staff and portal shells each have one around their pages (`inline`), so
 * when a page fails the navigation stays usable and the user can go elsewhere.
 * The top-level one catches anything else, such as a failure in a shell itself.
 */
export function RouteError({ inline = false }: { inline?: boolean }) {
  const error = useRouteError();
  useEffect(() => {
    // The technical detail goes to the console for whoever investigates.
    console.error(error);
  }, [error]);
  return (
    <div className={inline ? undefined : 'grid min-h-screen place-items-center'}>
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}
