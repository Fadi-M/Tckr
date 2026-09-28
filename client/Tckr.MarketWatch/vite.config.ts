import { createHash } from 'node:crypto';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy for production builds, as a `<meta>` tag (GUIDELINES.md §6).
 * Build-only because Vite's dev server injects inline scripts for hot reload.
 *
 * - Inline scripts are allowed by hash only: index.html's pre-paint theme script is hashed
 *   from the built HTML, so editing it can't silently break the policy.
 * - `connect-src` adds the gateway's WebSocket and REST origins only when the build uses
 *   the gateway source (`VITE_TCKR_SOURCE=gateway`); the simulated source needs no network.
 * - A `<meta>` policy cannot set `frame-ancestors`; send that as a response header once
 *   there is a host (Phase 11).
 */
function contentSecurityPolicy(env: Record<string, string>): Plugin {
  return {
    name: 'tckr-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const scriptHashes = [
          ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
        ].map(
          ([, body]) =>
            `'sha256-${createHash('sha256')
              .update(body ?? '')
              .digest('base64')}'`,
        );
        const connect = ["'self'"];
        if (env.VITE_TCKR_SOURCE === 'gateway') {
          // Same fallback as config.ts's readEnvString: empty means unset. A relative URL
          // (same origin) is already covered by 'self'.
          const raw = env.VITE_TCKR_GATEWAY_URL || 'ws://localhost:5000';
          if (URL.canParse(raw)) {
            const gateway = new URL(raw);
            const http = gateway.protocol === 'wss:' ? 'https:' : 'http:';
            connect.push(`${gateway.protocol}//${gateway.host}`, `${http}//${gateway.host}`);
          }
        }
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${scriptHashes.join(' ')}`,
          "style-src 'self' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data:",
          `connect-src ${connect.join(' ')}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace(
          /<head>/,
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), contentSecurityPolicy(loadEnv(mode, process.cwd(), 'VITE_'))],
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    restoreMocks: true,
  },
}));
