declare module '*.module.css' {
  /** Hashed class map produced by the bundle's CSS-module transform. */
  const classes: Record<string, string>;
  export default classes;
}
