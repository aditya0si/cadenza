import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/feedback';

export function NotFoundPage(): JSX.Element {
  return (
    <EmptyState
      title="Page not found"
      description="That route does not exist in CADENZA. Try Discover, Search, Library or Rooms."
      action={
        <Button asChild variant="outline">
          <Link to="/">Back to Discover</Link>
        </Button>
      }
    />
  );
}
