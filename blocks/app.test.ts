// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { injectAppStateOnShouldCache } from "./app.ts";
import type { FnContext } from "./utils.tsx";

Deno.test("shouldCache sees the app state in its ctx, as cacheKey does", () => {
  const seen: unknown[] = [];
  const shouldCache = injectAppStateOnShouldCache(
    { cachedSearchTerms: ["camisa"] },
    (result, props, _req, ctx: any) => {
      seen.push(result, props, ctx.cachedSearchTerms, ctx.bag);
      return false;
    },
  );
  const bag = new WeakMap();

  const decision = shouldCache(
    { products: [] },
    { query: "camisa" },
    new Request("https://localhost/s?q=camisa"),
    { bag } as unknown as FnContext,
  );

  assertEquals(decision, false);
  assertEquals(seen, [{ products: [] }, { query: "camisa" }, ["camisa"], bag]);
});
