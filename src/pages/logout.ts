import type { APIRoute } from 'astro';
import { auth } from '../auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
    await auth.api.signOut({ headers: request.headers });
    return redirect('/');
};

export const GET: APIRoute = () => new Response('Method not allowed', { status: 405 });