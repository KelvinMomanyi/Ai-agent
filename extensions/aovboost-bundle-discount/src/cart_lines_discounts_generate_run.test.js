import { describe, expect, it } from "vitest";
import { cartLinesDiscountsGenerateRun } from "./cart_lines_discounts_generate_run.js";

const PRODUCT_ONE = "gid://shopify/Product/1";
const PRODUCT_TWO = "gid://shopify/Product/2";

describe("cartLinesDiscountsGenerateRun", () => {
  it("targets every required line for a configured percentage bundle", () => {
    const result = cartLinesDiscountsGenerateRun(
      input({ discountType: "percentage", discountValue: 15 }),
    );

    expect(result.operations[0].productDiscountsAdd).toMatchObject({
      selectionStrategy: "ALL",
      candidates: [
        {
          value: { percentage: { value: "15.00" } },
          targets: [
            { cartLine: { id: "line-1", quantity: 1 } },
            { cartLine: { id: "line-2", quantity: 2 } },
          ],
        },
      ],
    });
  });

  it("does not discount an incomplete bundle", () => {
    const value = input({ discountType: "percentage", discountValue: 15 });
    value.cart.lines[1].quantity = 1;

    expect(cartLinesDiscountsGenerateRun(value)).toEqual({ operations: [] });
  });

  it("applies a fixed amount once per complete bundle set", () => {
    const value = input({
      discountType: "fixed_amount",
      discountValue: 10,
    });
    value.cart.lines[0].quantity = 2;
    value.cart.lines[1].quantity = 4;

    const candidate =
      cartLinesDiscountsGenerateRun(value).operations[0].productDiscountsAdd
        .candidates[0];
    expect(candidate.value).toEqual({
      fixedAmount: { amount: "20.00", appliesToEachItem: false },
    });
    expect(candidate.targets).toEqual([
      { cartLine: { id: "line-1", quantity: 2 } },
      { cartLine: { id: "line-2", quantity: 4 } },
    ]);
  });

  it("rejects marked lines whose real products do not match the config", () => {
    const value = input({ discountType: "percentage", discountValue: 15 });
    value.cart.lines[1].merchandise.product.id =
      "gid://shopify/Product/spoofed";

    expect(cartLinesDiscountsGenerateRun(value)).toEqual({ operations: [] });
  });
});

function input(discount) {
  return {
    cart: {
      lines: [
        cartLine("line-1", PRODUCT_ONE, 1),
        cartLine("line-2", PRODUCT_TWO, 2),
      ],
    },
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          bundles: [
            {
              id: "bundle-1",
              version: "version-1",
              ...discount,
              items: [
                { productId: PRODUCT_ONE, quantity: 1 },
                { productId: PRODUCT_TWO, quantity: 2 },
              ],
            },
          ],
        },
      },
    },
  };
}

function cartLine(id, productId, quantity) {
  return {
    id,
    quantity,
    bundleId: { value: "bundle-1" },
    bundleVersion: { value: "version-1" },
    merchandise: {
      __typename: "ProductVariant",
      product: { id: productId },
    },
  };
}
