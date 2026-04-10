type HeaderProps = {
  frontBufferLength: number;
  paused: boolean;
};

export function Header({ frontBufferLength, paused }: HeaderProps) {
  return (
    <div className="mb-3">
      goal {frontBufferLength} · {paused ? "paused" : "playing"}
    </div>
  );
}
