// A per-role section shell for this slice: a role-named heading plus a muted
// "not built yet" note. Deliberately NOT the ZeroState convention — ZeroState
// means "a real signal exists and its count is zero", whereas this means "this
// section's signals haven't been built yet" (#55 lays the shell; signals land
// in follow-up slices). Keeping them visually distinct avoids teaching users
// that an unbuilt section reads as "all caught up".
export function Placeholder({ title }: { title: string }) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>{title}</h2>
      <p style={{ color: "#999", fontStyle: "italic", margin: 0 }}>
        Your home signals arrive in a follow-up slice.
      </p>
    </section>
  );
}
