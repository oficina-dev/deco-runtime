import type { ComponentType } from "preact";
import { useContext } from "preact/hooks";
import { SectionContext } from "../components/section.tsx";
import { FieldResolver } from "../engine/core/resolver.ts";

import { Murmurhash3 } from "../deps.ts";

const hasher = new Murmurhash3();

// List from cloudflare APO https://developers.cloudflare.com/automatic-platform-optimization/reference/query-parameters
/** List of querystring that should not vary cache */
const BLOCKED_QS = new Set<string>([
  "ref",
  "fbclid",
  "fb_action_ids",
  "fb_action_types",
  "fb_source",
  "mc_cid",
  "mc_eid",
  "gclid",
  "dclid",
  "_ga",
  "campaignid",
  "adgroupid",
  "_ke",
  "cn-reloaded",
  "age-verified",
  "ao_noptimize",
  "usqp",
  "mkt_tok",
  "epik",
  "ck_subscriber_id",
]);

const ALLOWED_QS = new Set<string>();

export const addBlockedQS = (queryStrings: string[]): void => {
  queryStrings.forEach((qs) => BLOCKED_QS.add(qs));
};

export const addAllowedQS = (queryStrings: string[]): void => {
  queryStrings.forEach((qs) => ALLOWED_QS.add(qs));
};

/** Returns new props object with prop __cb with `pathname?querystring` from href */
const createStableHref = (href: string): string => {
  const hrefUrl = new URL(href!, "http://localhost:8000");
  const qsList = [...hrefUrl.searchParams.keys()];

  qsList.forEach((qsName: string) => {
    const shouldRemove = ALLOWED_QS.size > 0
      ? !ALLOWED_QS.has(qsName)
      : BLOCKED_QS.has(qsName);

    if (shouldRemove) {
      hrefUrl.searchParams.delete(qsName);
    }
  });

  hrefUrl.searchParams.sort();
  return hrefUrl.href;
};

export interface RenderCbInput {
  revision: unknown;
  vary: unknown;
  href: string;
  deploymentId?: string;
}

/**
 * Cache-bust value for `/deco/render` URLs. Single source of truth shared by
 * `useSection` (web partials) and JSON serialization consumers (e.g. the
 * website app's ?renderJson handler) — both sides MUST produce identical
 * values or web/JSON cache invalidation diverges.
 *
 * `revision`/`vary` join as-is (undefined → "undefined") to preserve the
 * historical recipe byte-for-byte. Shared `hasher` is safe ONLY because this
 * function is fully synchronous — no await between hash() and reset().
 */
export const computeRenderCb = (input: RenderCbInput): string => {
  const cbString = [
    input.revision,
    input.vary,
    createStableHref(input.href),
    input.deploymentId,
  ].join("|");
  hasher.hash(cbString);
  const cb = `${hasher.result()}`;
  hasher.reset();
  return cb;
};

export type Options<P> = {
  /** Section props partially applied */
  props?: Partial<P extends ComponentType<infer K> ? K : P>;

  /** Path where section is to be found */
  href?: string;
};

export const useSection = <P>(
  { props = {}, href }: Pick<Options<P>, "href" | "props"> = {},
): string => {
  const ctx = useContext(SectionContext);
  if (typeof document !== "undefined") {
    throw new Error("Partials cannot be used inside an Island!");
  }
  if (!ctx) {
    throw new Error("Missing context in rendering tree");
  }

  const revisionId = ctx?.revision;
  const vary = ctx?.context.state.vary.build();
  const { request, renderSalt, context: { state: { pathTemplate } } } = ctx;

  const hrefParam = href ?? request.url;
  const stableHref = createStableHref(hrefParam);
  const cb = computeRenderCb({
    revision: revisionId,
    vary,
    href: hrefParam,
    deploymentId: ctx?.deploymentId,
  });

  const params = new URLSearchParams([
    ["props", JSON.stringify(props)],
    ["href", stableHref],
    ["pathTemplate", pathTemplate],
    ["renderSalt", `${renderSalt ?? crypto.randomUUID()}`],
    ["__cb", `${cb}`],
  ]);

  if ((props as { __resolveType?: string })?.__resolveType === undefined) {
    params.set(
      "resolveChain",
      JSON.stringify(FieldResolver.minify(ctx.resolveChain.slice(0, -1))),
    );
  }

  return `/deco/render?${params}`;
};
