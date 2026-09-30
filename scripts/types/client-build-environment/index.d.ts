/** Build-time values that bundlers replace before client code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly [name: `DSH_CLIENT_${string}` | `CLH_CLIENT_${string}`]: string | undefined
  }
}
