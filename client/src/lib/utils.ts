import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const API_ORIGIN = (() => {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return configured.replace(/\/api\/?$/, '');
  return 'http://localhost:4000';
})();

/** Turns a server-relative asset path (`/api/media/cover/...`) into a URL. */
export const assetUrl = (path: string | null | undefined): string => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
};
