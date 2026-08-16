/**
 * Host half of dsh-runtime-bar.
 *
 * The bar is entirely a client surface: every fact it shows — working
 * directory, run state, background jobs, session count — already rides the
 * runtime's session list feed into the browser, so there is no route to serve
 * and no host state to keep. What this half exists for is the mount itself:
 * DSH loads plugins host-side, and the row it mounts here is what makes the
 * declared client bundle (`dsh.plugin.json` → `client.main`) ship to the page.
 *
 * Keep it free of Node-only work regardless: the same identity is read by the
 * bundle patch (`cordis.patch.yml`) and by the profile boot.
 */

/** Plugin identity for cordis.yml rows and the bundle patch. */
export const name = 'dsh-runtime-bar';

/**
 * Host plugin body. Deliberately empty — see the module doc: the bar has no
 * host-side state, and a host half that quietly grew one would be a second
 * source of truth for facts the session feed already publishes.
 */
export function apply(): void {}
