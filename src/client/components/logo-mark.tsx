import { cn } from '@/lib/utils'

export function LogoMark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizes = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16',
  }

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn(sizes[size], className)}
      aria-hidden="true"
    >
      <path d="M16 1.5L3.5 6.5v9c0 8.5 5.5 14.5 12.5 16 7-1.5 12.5-7.5 12.5-16v-9L16 1.5z" className="fill-primary dark:fill-primary" />
      <path d="M16 3L5 7.5v8.25c0 7.5 4.75 12.75 11 14.25 6.25-1.5 11-6.75 11-14.25V7.5L16 3z" className="fill-primary/70 dark:fill-primary/50" />
      <path d="M11 10.5c0-.83.67-1.5 1.5-1.5h1c.83 0 1.5.67 1.5 1.5v3.5h4c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-1c-.83 0-1.5-.67-1.5-1.5V17h-4c-.83 0-1.5-.67-1.5-1.5v-5z" className="fill-primary-foreground" />
      <path d="M21.5 10.5a5 5 0 0 1 0 5" className="stroke-primary-foreground" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M23.5 9a7.5 7.5 0 0 1 0 8" className="stroke-primary-foreground" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}
