export function DeskMark({ className }: { className?: string }) {
  return (
    <svg viewBox="5 6 43 40" className={className} aria-hidden="true">
      <path d="M31.2 23.2 29.6 43.2H46.8L39.2 21.6Z" fill="var(--gold)" />
      <g fill="currentColor">
        <path d="M7.2 39.6c0-2.4 5.6-4.2 12.8-4.2s12.8 1.8 12.8 4.2-5.6 4.4-12.8 4.4-12.8-2-12.8-4.4z" />
        <path d="M15.6 29.2h5.2c.9 0 1.6.7 1.6 1.6v8.2h-8.4v-8.2c0-.9.7-1.6 1.6-1.6z" />
        <circle cx="18.2" cy="29.6" r="2.5" />
        <path
          d="M18.2 29.4c-2.4-7.2 2.8-13.8 10.4-12.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <circle cx="28.6" cy="16.9" r="1.7" />
        <path
          d="M28.6 16.9 33.2 18.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M26.8 11c.6-3.8 10-6.2 14.8-2.2 3.2 2.6 3.2 7.2.2 10.2-2.4 2.4-6.6 3.2-10.2 1.8l-4-1.4c-2.4-.8-3.2-3.8-2.2-6.2.3-.8.8-1.6 1.4-2.2z" />
      </g>
      <ellipse cx="35.6" cy="20.2" rx="5.6" ry="1.9" transform="rotate(18 35.6 20.2)" fill="var(--gold-bright)" />
      <path
        d="M30.8 10c1.8-1.4 6.2-1.6 7.4-.2.3.4 0 .85-.55.9-1.6.3-4.2.55-6.1 0-.45-.15-.5-.45-.1-.7z"
        fill="var(--paper)"
      />
    </svg>
  );
}
