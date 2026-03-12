/**
 * Provider composition utility.
 *
 * Flattens deeply nested provider trees into a readable, linear list.
 * Each entry is a [Provider, props?] tuple. Providers are composed
 * right-to-left (last entry is innermost), matching the visual nesting order.
 *
 * Usage:
 *   const AppProviders = composeProviders([
 *     [ThemeProvider],
 *     [QueryClientProvider, { client: queryClient }],
 *     [RoutingProvider],
 *   ]);
 *
 *   // In render:
 *   <AppProviders>{children}</AppProviders>
 */

import React from "react";
import type { ComponentType, PropsWithChildren } from "react";

type ProviderEntry =
  | [
      ComponentType<PropsWithChildren<Record<string, unknown>>>,
      Record<string, unknown>?,
    ]
  | [ComponentType<PropsWithChildren<Record<string, unknown>>>];

/**
 * Compose an array of [Provider, props?] into a single wrapper component.
 * Providers are nested in array order: first entry wraps everything.
 */
export function composeProviders(
  providers: ProviderEntry[],
): ComponentType<PropsWithChildren> {
  return function ComposedProviders({ children }: PropsWithChildren) {
    return providers.reduceRight<React.ReactElement>(
      (acc, [Provider, props]) => <Provider {...(props ?? {})}>{acc}</Provider>,
      children as React.ReactElement,
    );
  };
}
