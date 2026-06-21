import { describe, it, expect } from "vitest";
import { deriveClientPrice } from "./client-price-derivation";

// Client Price derivation from the brief's raw trio (#86 / ADR-0015, ADR-0027).
// The brief supplies {Client Item Price, Client Item Price Currency, Client Item
// Price Quantity}; the system derives USD/unit = price / priceQuantity. v1
// requires USD. The trio is all-or-nothing; the raw values are retained as seed.

describe("deriveClientPrice", () => {
  it("derives USD/unit as price / priceQuantity and keeps the raw trio as seed", () => {
    expect(deriveClientPrice({ price: "100", currency: "USD", priceQuantity: "4" })).toEqual({
      ok: true,
      clientPrice: 25,
      seed: { price: 100, currency: "USD", priceQuantity: 4 },
    });
  });

  it("treats an entirely blank trio as an unpriced item (null, no seed)", () => {
    expect(deriveClientPrice({ price: "", currency: "", priceQuantity: "" })).toEqual({
      ok: true,
      clientPrice: null,
      seed: null,
    });
  });

  it("normalises currency casing/whitespace to USD", () => {
    const r = deriveClientPrice({ price: "50", currency: " usd ", priceQuantity: "2" });
    expect(r).toEqual({ ok: true, clientPrice: 25, seed: { price: 50, currency: "USD", priceQuantity: 2 } });
  });

  it("rejects a partial trio (price without quantity)", () => {
    const r = deriveClientPrice({ price: "100", currency: "USD", priceQuantity: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-USD currency", () => {
    const r = deriveClientPrice({ price: "100", currency: "EUR", priceQuantity: "4" });
    expect(r).toEqual({ ok: false, message: "Client Item Price Currency must be USD" });
  });

  it("rejects a non-positive price", () => {
    expect(deriveClientPrice({ price: "0", currency: "USD", priceQuantity: "4" }).ok).toBe(false);
  });

  it("rejects a non-positive price quantity (guards divide-by-zero)", () => {
    expect(deriveClientPrice({ price: "100", currency: "USD", priceQuantity: "0" }).ok).toBe(false);
  });
});
