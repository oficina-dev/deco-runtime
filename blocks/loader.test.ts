// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import type { DecofileProvider } from "../engine/decofile/provider.ts";
import { type LoaderModule, wrapLoader } from "./loader.ts";
import type { FnContext } from "./utils.tsx";

interface Listing {
  products: string[];
}

const GOOD: Listing = { products: ["camisa-azul", "camisa-branca"] };
const EMPTY: Listing = { products: [] };

const release = {
  revision: () => Promise.resolve("test-revision"),
} as DecofileProvider;

/**
 * In-memory stand-in for the loader cache. `put` stores synchronously, so a
 * write is visible to the very next request without awaiting the loader's
 * fire-and-forget `cache.put`.
 */
const memoryCache = () => {
  const entries = new Map<string, Response>();
  const cache = {
    match: (request: Request) =>
      Promise.resolve(entries.get(request.url)?.clone()),
    put: (request: Request, response: Response) => {
      entries.set(request.url, response);
      return Promise.resolve();
    },
  } as unknown as Cache;
  return { cache, size: () => entries.size };
};

/** A handler that answers each call with the next result in line. */
const scriptedHandler = (...results: Listing[]) => {
  let calls = 0;
  const handler = () =>
    Promise.resolve(results[Math.min(calls++, results.length - 1)]);
  return { handler, calls: () => calls };
};

const loaderOf = (
  mod: Omit<LoaderModule<unknown, unknown, Listing>, "default">,
  handler: () => Promise<Listing>,
  cache: Cache,
) => {
  const wrapped = wrapLoader(
    { ...mod, default: handler } as LoaderModule,
    [],
    release,
    `loader-${crypto.randomUUID()}`,
    () => cache,
  );
  return () =>
    wrapped.default(
      {},
      new Request("https://localhost/s?q=camisa"),
      {} as FnContext<any, any>,
    ) as Promise<Listing>;
};

const rejectsEmpty = (result: Listing) => result.products.length > 0;

// The stale path revalidates in the background; let it run to completion.
const flushBackgroundWork = () => new Promise((r) => setTimeout(r, 0));

Deno.test("a result the predicate rejects is returned but not stored", async () => {
  const { cache, size } = memoryCache();
  const { handler, calls } = scriptedHandler(EMPTY, GOOD);
  const load = loaderOf(
    {
      cache: "stale-while-revalidate",
      cacheKey: () => "camisa",
      shouldCache: rejectsEmpty,
    },
    handler,
    cache,
  );

  assertEquals(await load(), EMPTY);
  assertEquals(size(), 0);

  // The next request runs the loader again instead of reading the empty answer.
  assertEquals(await load(), GOOD);
  assertEquals(calls(), 2);
});

Deno.test("a result the predicate accepts is stored and served from cache", async () => {
  const { cache } = memoryCache();
  const { handler, calls } = scriptedHandler(GOOD, EMPTY);
  const load = loaderOf(
    {
      cache: "stale-while-revalidate",
      cacheKey: () => "camisa",
      shouldCache: rejectsEmpty,
    },
    handler,
    cache,
  );

  assertEquals(await load(), GOOD);
  assertEquals(await load(), GOOD);
  assertEquals(calls(), 1);
});

Deno.test("without a predicate every result is stored, as before", async () => {
  const { cache } = memoryCache();
  const { handler, calls } = scriptedHandler(EMPTY, GOOD);
  const load = loaderOf(
    { cache: "stale-while-revalidate", cacheKey: () => "camisa" },
    handler,
    cache,
  );

  assertEquals(await load(), EMPTY);
  assertEquals(await load(), EMPTY);
  assertEquals(calls(), 1);
});

Deno.test("a rejected revalidation keeps serving the previous entry", async () => {
  const { cache } = memoryCache();
  const { handler, calls } = scriptedHandler(GOOD, EMPTY);
  // maxAge 0: every entry is stale by the next request, so each read
  // triggers a background revalidation.
  const load = loaderOf(
    {
      cache: { maxAge: 0 },
      cacheKey: () => "camisa",
      shouldCache: rejectsEmpty,
    },
    handler,
    cache,
  );

  assertEquals(await load(), GOOD);
  assertEquals(await load(), GOOD); // stale, revalidates in the background
  await flushBackgroundWork();
  assertEquals(calls(), 2); // the revalidation ran and answered EMPTY

  assertEquals(await load(), GOOD);
});

Deno.test("an accepted revalidation replaces the previous entry", async () => {
  const { cache } = memoryCache();
  const refreshed: Listing = { products: ["camisa-verde"] };
  const { handler } = scriptedHandler(GOOD, refreshed);
  const load = loaderOf(
    {
      cache: { maxAge: 0 },
      cacheKey: () => "camisa",
      shouldCache: rejectsEmpty,
    },
    handler,
    cache,
  );

  assertEquals(await load(), GOOD);
  assertEquals(await load(), GOOD); // stale, revalidates in the background
  await flushBackgroundWork();

  assertEquals(await load(), refreshed);
});
