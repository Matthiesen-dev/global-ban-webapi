import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';
import { loadEnv } from "vite";

const { BASE_DOMAIN } = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), "");

// Change this to your production domain when deploying
const baseDomain = BASE_DOMAIN ?? 'example.com';

// https://astro.build/config
export default defineConfig({
    site: 'https://' + baseDomain,
    security: {
        allowedDomains: [
            { hostname: baseDomain },
            { hostname: `*.${baseDomain}` },
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
