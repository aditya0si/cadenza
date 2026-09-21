import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border', className)}
    {...props}
  />
));
Avatar.displayName = 'Avatar';

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
));
AvatarImage.displayName = 'AvatarImage';

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn('flex h-full w-full items-center justify-center bg-secondary text-xs font-medium uppercase', className)}
    {...props}
  />
));
AvatarFallback.displayName = 'AvatarFallback';

/** Presence avatar with a green dot when the listener is connected. */
export function PresenceAvatar({
  displayName,
  avatarUrl,
  connected,
}: {
  displayName: string;
  avatarUrl?: string | null;
  connected?: boolean;
}): JSX.Element {
  return (
    <div className="relative" title={connected ? `${displayName} (connected)` : displayName}>
      <Avatar className="h-8 w-8">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{displayName.slice(0, 2)}</AvatarFallback>
      </Avatar>
      {connected !== undefined ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background',
            connected ? 'bg-emerald-500' : 'bg-muted-foreground/50',
          )}
        />
      ) : null}
      <span className="sr-only">{connected ? `${displayName} is listening` : `${displayName} is away`}</span>
    </div>
  );
}
