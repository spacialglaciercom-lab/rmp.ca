/**
 * Minimal Buffer shim for React Native / Metro when the "buffer" package
 * is not installed in node_modules (e.g. react-native-svg only needs
 * Buffer.from(str, 'base64').toString('utf-8')).
 */
"use strict";

if (typeof global !== "undefined" && global.Buffer) {
  module.exports = global.Buffer;
} else {
  function base64ToUtf8(base64) {
    if (typeof atob !== "function") {
      throw new Error("buffer-shim: atob not available");
    }
    const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  const BufferShim = {
    from(value, encoding) {
      if (encoding === "base64" && typeof value === "string") {
        const utf8 = base64ToUtf8(value);
        return { toString: () => utf8 };
      }
      throw new Error("buffer-shim: only Buffer.from(str, 'base64') is supported");
    },
  };

  module.exports = BufferShim;
}
