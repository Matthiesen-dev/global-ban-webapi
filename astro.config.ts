import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    // Change this to your production URL when deploying
    site: 'http://localhost:4321',
    output: 'server',
    adapter: node({ mode: 'standalone' }),
    vite: { plugins: [tailwindcss()] },
});
