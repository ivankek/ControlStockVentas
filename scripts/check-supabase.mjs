import { createClient } from '@supabase/supabase-js';

// Diagnostics deliberately print no URLs, credentials, user records or table data.
try { process.loadEnvFile('.env.local'); } catch { console.log('CONFIG_FILE_MISSING'); process.exit(1); }
const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = names.filter(name => !process.env[name]?.trim());
if (missing.length) { console.log(JSON.stringify({missing})); process.exit(1); }
try {
 const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
 if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.search || url.hash) throw Error();
 const options = {auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})}};
 const server = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
 const browser = createClient(url.origin, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
 for (const table of ['account_states','meli_connections']) {
  const result = await server.from(table).select('owner_id',{head:true,count:'exact'});
  console.log(JSON.stringify({check:`server_${table}`,ok:!result.error,code:result.error?.code}));
  const denied = await browser.from(table).select('owner_id').limit(0);
  console.log(JSON.stringify({check:`anonymous_${table}_blocked`,ok:!!denied.error,code:denied.error?.code}));
 }
 const rpc = await server.rpc('save_account_state',{p_owner:'00000000-0000-0000-0000-000000000000',p_expected:-1,p_state:{}});
 console.log(JSON.stringify({check:'save_function_noop',ok:!rpc.error&&rpc.data===false,code:rpc.error?.code}));
 const users = await server.auth.admin.listUsers({page:1,perPage:1});
 console.log(JSON.stringify({check:'auth_user_exists',ok:!users.error&&users.data.users.length>0,status:users.error?.status}));
 const settings = await fetch(`${url.origin}/auth/v1/settings`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(15000)});
 if(settings.ok){const data=await settings.json();console.log(JSON.stringify({check:'auth_settings',ok:true,signupDisabled:data.disable_signup,emailEnabled:data.external?.email}));}
 else console.log(JSON.stringify({check:'auth_settings',ok:false,status:settings.status}));
} catch { console.log('CONNECTION_CHECK_FAILED_NO_CREDENTIALS_DISPLAYED'); process.exitCode=1; }
