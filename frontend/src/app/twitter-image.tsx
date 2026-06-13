// X / Twitter uses the same card as the Open Graph image. Re-export so the
// summary_large_image card gets a populated twitter:image without duplicating
// the design.
export { default, runtime, alt, size, contentType } from "./opengraph-image";
