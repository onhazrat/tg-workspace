import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  input: "./openapi.json",
  output: "./src/client",

  plugins: [
    // `throwOnError` belongs to the *client* plugin, not the SDK one: it is what
    // flips the generated `ThrowOnError` type parameter's default to `true` and
    // writes `throwOnError: true` into `client.gen.ts`'s runtime config. Setting
    // it on `@hey-api/sdk` is silently accepted and does nothing.
    { name: "@hey-api/client-fetch", throwOnError: true },
    {
      name: "@hey-api/sdk",
      // Function names come straight from the spec's operationId, which the
      // backend formats as `<tag>-<function_name>` (`users-create_user`) and
      // hey-api camelCases to `usersCreateUser`. The `legacy/axios` config used
      // a `methodNameBuilder` to strip the tag back off for the class form;
      // with standalone functions the tag is the disambiguator, so the default
      // is what we want. The builders were legacy-only options anyway — they
      // read `operation.name`/`operation.service`, which the modern parser does
      // not emit, and crash the generator outright.
      operationId: true,
      // Keep the transport swap a *transport* swap. `@hey-api/client-fetch`
      // otherwise returns `{data, error, response}` and never throws, which
      // would change the contract at all 16 call sites and — worse — silently
      // break every react-query `queryFn`, since react-query decides a query
      // failed by the promise rejecting. `responseStyle` here plus
      // `throwOnError` above make the generated functions resolve to the
      // payload and throw on failure, exactly as `legacy/axios` did.
      //
      // `responseStyle` must be set *here* rather than on the client config:
      // the runtime honours a client-level `responseStyle`, but the SDK only
      // threads the matching type parameter when the generator emits it per
      // call, so setting it at runtime alone would leave the types describing
      // a shape the functions no longer return.
      responseStyle: "data",
    },
  ],
})
