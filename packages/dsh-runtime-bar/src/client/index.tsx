/**
 * Client half. Provides the bar's entry registry, registers this plugin's own
 * entries through it, and mounts the bar into the composer dock.
 *
 * `slots.inject` rather than a bare `register`: the dock is declared by the
 * conversation shell, which may not have mounted when this plugin activates —
 * injecting waits for each declaration lifetime, while registering into an
 * undeclared slot throws.
 */
import { createRuntimeBarRegistry } from '@yoda/runtime-bar/registry';
import type { Context } from '../context-types.ts';
import { RuntimeBar } from './bar.tsx';
import { registerBuiltinItems } from './builtins.ts';
import { en, LOCALE_NS, zh } from './locales.ts';

export const name = 'dsh-runtime-bar';

export const inject = ['slots', 'workspaces', 'locale'];

/** The slot the bar mounts into: the band under the composer card. */
const DOCK_SLOT = 'conversation.composer.dock';

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ctx.locale.register(LOCALE_NS, 'zh', { ...zh }),
      ctx.locale.register(LOCALE_NS, 'en', { ...en }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'runtime-bar locales');

  // One registry per activation, exposed as a service so other plugins can add
  // entries: `ctx.yodaRuntimeBar.register({ id, slot, order, Component })`.
  const registry = createRuntimeBarRegistry();
  ctx.provide('yodaRuntimeBar', registry);
  ctx.effect(() => registerBuiltinItems(registry), 'runtime-bar built-in entries');

  ctx.effect(
    () =>
      ctx.slots.inject(DOCK_SLOT, () =>
        ctx.slots.register(
          {
            name: DOCK_SLOT,
            id: 'runtime-bar',
            inject: () => ({ registry, locale: ctx.locale, workspaces: ctx.workspaces }),
          },
          RuntimeBar
        )
      ),
    'runtime-bar dock mount'
  );
}
