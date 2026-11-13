import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '../design/States';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The address may be mistyped, or the page may have moved."
      action={
        <Link to="/" className="text-sm font-medium text-accent underline underline-offset-4">
          Go to the dashboard
        </Link>
      }
    />
  );
}
