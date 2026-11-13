import { useRouteError } from 'react-router';
import { ErrorState } from '../design/States';

/** Last-resort boundary for render errors, so a crash never shows a blank page. */
export function RouteError() {
  const error = useRouteError();
  return (
    <div className="grid min-h-screen place-items-center">
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}
