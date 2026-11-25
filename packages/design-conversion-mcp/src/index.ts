/**
 * @avant-garde/design-conversion-mcp: conversion-oriented storefront design
 * decisions over MCP (spec 35). The server core is transport-free; wrap it with
 * `serveStdio` (local) or `createHttpHandler` (any fetch runtime).
 */
export * from "./server.js";
export * from "./transports.js";
export * from "./audit.js";
export * from "./data.js";
export { capturePage } from "./capture.js";
