import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://global-ban.matthiesen.dev',
    security: {
        allowedDomains: [
            { hostname: 'global-ban.matthiesen.dev' },
            { hostname: `*.global-ban.matthiesen.dev` },
        ]
    },
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    vite: { plugins: [tailwindcss()] },
    env: {
        schema: {
            DATABASE_URL: envField.string({
                context: "server",
                access: "secret",
                optional: false,
            }),
            DATABASE_AUTH_TOKEN: envField.string({
                context: "server",
                access: "secret",
                optional: true,
            }),
            BETTER_AUTH_SECRET: envField.string({
                context: "server",
                access: "secret",
                optional: false,
            }),
            BETTER_AUTH_URL: envField.string({
                context: "server",
                access: "secret",
                optional: false,
            }),
            DISCORD_CLIENT_ID: envField.string({
                context: "server",
                access: "secret",
                optional: false,
            }),
            DISCORD_CLIENT_SECRET: envField.string({
                context: "server",
                access: "secret",
                optional: false,
            }),
            TRUSTED_PROXY: envField.string({
                context: "server",
                access: "secret",
                optional: true,
                default: "none"
            }),
            TRUSTED_PROXY_HOPS: envField.number({
                context: "server",
                access: "secret",
                optional: true,
                default: 1
            }),
        }
    }
});
