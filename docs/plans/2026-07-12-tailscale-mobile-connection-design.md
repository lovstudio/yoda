# Tailscale mobile connection

Yoda Mobile should connect to its desktop gateway away from the desktop's physical LAN without
making the gateway public. The first implementation uses the private Tailscale network already
managed by the user and preserves the existing token-protected HTTP API and SSE protocol.

The desktop enumerates network interfaces and classifies IPv4 addresses in Tailscale's
`100.64.0.0/10` range. A Tailscale address becomes the primary gateway URL and therefore the URL
encoded in the existing pairing QR code. Ordinary LAN addresses remain available as fallbacks. If
Tailscale is absent, behavior is unchanged. The connection view identifies when the remote path is
active and tells the user that the phone must join the same tailnet.

The connection view always renders a Tailscale setup card. Before detection it gives installation,
same-tailnet login, and rescan instructions with links to the official download and setup pages.
After detection it becomes a success state and displays the selected remote gateway URL. This keeps
first-run configuration discoverable instead of only confirming users who already finished setup.

This version deliberately does not run `tailscale serve`, change tailnet configuration, or expose a
Funnel endpoint. Those operations persist outside Yoda and can conflict with an existing Serve
route. A future HTTPS/MagicDNS integration can be added as an explicit opt-in flow. Unit tests cover
the address boundary and preference order; the existing API contract continues to cover pairing.
