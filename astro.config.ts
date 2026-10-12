import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

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
});
