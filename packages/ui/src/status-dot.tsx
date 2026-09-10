export type StatusTone = "green" | "amber" | "red" | "gray" | "violet";

const TONE_CLASSES: Record<StatusTone, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  gray: "bg-zinc-500",
  violet: "bg-violet-400",
};

/** Small colored dot for status indicators; `pulse` adds a soft animation. */
export function StatusDot({
  tone,
  pulse = false,
  className = "",
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex size-2.5 ${className}`}>
      {pulse ? (
        <span
          className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${TONE_CLASSES[tone]}`}
        />
      ) : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${TONE_CLASSES[tone]}`} />
    </span>
  );
}
