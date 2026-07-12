# Yoda Relay AWS production deployment

The production Relay runs as one Node process on an encrypted EC2 instance. CloudFront provides the
public HTTPS/WebSocket origin, and AWS WAF protects the upgrade and HTTP endpoints. The instance has
no SSH ingress; port `8787` only accepts the AWS-managed CloudFront origin-facing prefix list.

The three templates are intentionally split:

1. `bootstrap.yml` creates the encrypted source bucket, isolated CodeBuild project, immutable ECR
   repository, and non-root provisioning role.
2. `waf.yml` is deployed in `us-east-1`, as required for a CloudFront-scoped web ACL.
3. `relay.yml` is deployed in `ap-southeast-1` after CodeBuild has pushed the image.

After the Relay stack reaches `CREATE_COMPLETE`, write
`https://<DistributionDomainName>` to `/yoda/production/relay-public-base-url`, restart the
`yoda-relay` systemd service through SSM, and set the same origin as LovStudio Web's
`YODA_RELAY_PUBLIC_URL`. Copy the generated Secrets Manager value directly into Vercel as
`YODA_RELAY_SERVICE_SECRET`; never print or persist it.

Production verification must cover `/health`, a real authorized WebSocket `101`, pairing,
`/v1/snapshot`, and an SSE stream longer than 70 seconds while the desktop host remains connected.
