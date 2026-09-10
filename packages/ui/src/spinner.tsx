/** Accessible loading spinner. */
export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={`inline-block animate-spin ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="size-full">
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          className="opacity-20"
        />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
