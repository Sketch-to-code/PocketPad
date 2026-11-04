import fs from 'node:fs';
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel environment variables. Never use service_role keys.');
fs.writeFileSync('web/config.js', 'window.POCKETPAD_CONFIG='+JSON.stringify({supabaseUrl:url,supabaseAnonKey:key})+';\n');
