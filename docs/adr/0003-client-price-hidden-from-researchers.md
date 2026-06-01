# Client Price is an internal QC benchmark, hidden from researchers and clients

Each Benchmark Item carries a **Client Price** — an expected price-per-unit benchmark entered by an analyst. Its sole purpose is internal quality control: the system flags competitor quotes whose USD price-per-unit falls above or below the expected range around the Client Price, so analysts can spot suspect quotes.

Client Price is **hidden from researchers** (knowing it could anchor and bias the competitor quotes they collect) **and is never exposed to clients** — not in any client-facing dashboard and not in client exports. It powers an internal analyst QC view only. Client-facing dashboards show the competitor price range (view A) and competitor breakdown (view B); the client-vs-benchmark comparison (view D) is internal.

The researcher blindness is deliberately narrow: researchers **can** see each other's competitor quotes on the same Benchmark Item — those are real market observations and aid coordination; only the Client Price anchors toward "the answer."

A future engineer may see a field hidden from the staff who do data entry, or absent from client exports, and try to "fix" it by exposing it — do not. The hiding is the point.
