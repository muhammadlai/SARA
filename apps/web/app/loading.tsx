import { Spinner } from "@sara/ui";

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-violet-300">
      <Spinner className="size-8" />
    </div>
  );
}
