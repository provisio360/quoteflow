// The one shared zero-state convention (#55): when a role signal's count is
// zero, show a calm "you're all caught up" line rather than hiding the row — an
// absent number reads as broken/loading. The message is per-context so each
// signal phrases its own all-clear; the styling stays uniform across the home.
export function ZeroState({ message }: { message: string }) {
  return (
    <p style={{ color: "#777", margin: "0.25rem 0" }}>{message}</p>
  );
}
