import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Change this to your production domain when deploying
const baseDomain = process.env.BASE_DOMAIN ?? 'example.com';

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
});
