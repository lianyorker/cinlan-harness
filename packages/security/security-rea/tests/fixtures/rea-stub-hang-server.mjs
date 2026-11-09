/**
 * MCP stdio server that accepts input but never replies — used to verify that
 * SecurityRea's startup timeout degrades to `unavailable` instead of hanging
 * plugin activation.
 */
process.stdin.setEncoding('utf8')
process.stdin.resume()
process.stdin.on('data', () => {})
