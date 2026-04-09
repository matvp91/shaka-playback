type HeaderProps = {
  bufferGoal: number;
  paused: boolean;
};

export function Header({ bufferGoal, paused }: HeaderProps) {
  return (
    <div className="mb-3">
      goal {bufferGoal} · {paused ? "paused" : "playing"}
    </div>
  );
}
