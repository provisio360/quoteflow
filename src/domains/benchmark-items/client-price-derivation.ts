// Pure decision core — no framework, DB, or network imports.
//
// Client Price derivation (#86). The brief carries Client Price as a raw trio —
// {Client Item Price, Client Item Price Currency, Client Item Price Quantity} —
// from which we derive the operative USD/unit value = price / priceQuantity. v1
// requires the currency to be USD (a non-USD price is an import validation
// error). The trio is all-or-nothing and the raw values are retained as seed
// provenance (ADR-0015, ADR-0027). An entirely blank trio is an unpriced item.

/** The raw brief cells for Client Price, already trimmed by the caller is fine
 *  (we trim defensively too). */
export interface ClientPriceTrioRaw {
  readonly price: string;
  readonly currency: string;
  readonly priceQuantity: string;
}

/** The retained seed provenance: the raw trio, numbers parsed, currency folded. */
export interface ClientPriceSeed {
  readonly price: number;
  readonly currency: string;
  readonly priceQuantity: number;
}

export type ClientPriceDerivation =
  | { readonly ok: true; readonly clientPrice: number | null; readonly seed: ClientPriceSeed | null }
  | { readonly ok: false; readonly message: string };

/**
 * Derive the USD/unit Client Price from the brief trio. Blank-all → unpriced
 * (null). Any value present makes the whole trio required (all-or-nothing);
 * currency must be USD; price and priceQuantity must be numbers > 0.
 */
export function deriveClientPrice(raw: ClientPriceTrioRaw): ClientPriceDerivation {
  const price = raw.price.trim();
  const currency = raw.currency.trim();
  const priceQuantity = raw.priceQuantity.trim();

  // Entirely blank: an item the client never priced.
  if (price === "" && currency === "" && priceQuantity === "") {
    return { ok: true, clientPrice: null, seed: null };
  }

  // All-or-nothing: a partial trio is a validation error.
  if (price === "" || currency === "" || priceQuantity === "") {
    return {
      ok: false,
      message: "Client Price requires Price, Currency and Quantity together",
    };
  }

  if (currency.toUpperCase() !== "USD") {
    return { ok: false, message: "Client Item Price Currency must be USD" };
  }

  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return { ok: false, message: "Client Item Price must be a number greater than 0" };
  }

  const qtyNum = Number(priceQuantity);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    return { ok: false, message: "Client Item Price Quantity must be a number greater than 0" };
  }

  return {
    ok: true,
    clientPrice: priceNum / qtyNum,
    seed: { price: priceNum, currency: "USD", priceQuantity: qtyNum },
  };
}
