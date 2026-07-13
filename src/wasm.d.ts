// Bundler asset imports: `import url from "foo.wasm?url"` yields the emitted URL.
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
