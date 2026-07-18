# Authentication & protected COPC sources

Stream a `.copc.laz` file that sits behind a token, signed URL, or private object store. All requests `copc-tileset` makes are HTTP **range requests**, so whatever auth your host expects must ride along on every one of them.

Related: [Bundler & Service Worker setup](./bundler-setup.md) · [Picking & shading](./picking-and-shading.md) · [Custom shaders](./custom-shaders.md)

## Pass custom headers to every range request

`CopcProvider.fromUrl` takes an options object whose `headers` are merged into every range request. Use it for `Authorization`, API keys, or any custom header.

```ts
import { CopcProvider, CopcPointCloudPrimitive } from "@gyeonghokim/copc-tileset";

const provider = await CopcProvider.fromUrl(
  "https://data.example.com/private/scan.copc.laz",
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  },
);

const pointCloud = await CopcPointCloudPrimitive.fromProvider(provider);
```

The `CopcProviderOptions` type has a single field:

```ts
interface CopcProviderOptions {
  /** Extra headers to send with each range request (e.g. for authentication). */
  headers?: Record<string, string>;
}
```

## The host must return HTTP 206 (Partial Content)

When you supply `headers`, `copc-tileset` switches to a `fetch`-based range getter that sends `Range: bytes=<begin>-<end>` alongside your headers and **requires** a `206 Partial Content` response. A server that ignores `Range` and answers `200` with the whole file is rejected — treating a full-file body as the requested slice would silently corrupt reads.

```
copc-tileset: expected HTTP 206 for a range request but got 200 —
the host may not support range requests (https://data.example.com/private/scan.copc.laz)
```

If you see this, enable range-request support on the host (S3, GCS, Azure Blob, and most CDNs support it; some app servers need it turned on).

## Signed / pre-signed URLs

A pre-signed URL carries its credentials in the query string, so no headers are needed — pass it straight to `fromUrl`. Without `headers`, the provider uses copc.js's default getter.

```ts
const signedUrl = await getPresignedUrl("scan.copc.laz"); // your backend
const provider = await CopcProvider.fromUrl(signedUrl);
```

Note that a pre-signed URL expires; refetch and rebuild the primitive if a long session outlives the signature.

## CORS

If the COPC file is served from a different origin than your app, the host must send CORS headers that permit the `Range` header and expose ranged responses:

```
Access-Control-Allow-Origin: https://your-app.example.com
Access-Control-Allow-Headers: Range, Authorization
Access-Control-Allow-Methods: GET, HEAD
```

Auth headers count as non-simple request headers, so the browser will send a CORS **preflight** — make sure `Authorization` (and any custom header) is listed in `Access-Control-Allow-Headers`.
