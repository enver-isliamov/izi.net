import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const tables = ['subscriptions', 'support_tickets', 'support_messages'];

async function checkRealtime() {
    console.log("Starting diagnostic for Realtime...");
    
    for (const table of tables) {
        const channel = supabase.channel(`test-${table}`)
            .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
                console.log(`Event on ${table}:`, payload);
            })
            .subscribe((status) => {
                console.log(`Status for table "${table}": ${status}`);
                if (status === 'CHANNEL_ERROR') {
                    console.error(`❌ Table "${table}" is likely NOT in supabase_realtime publication.`);
                }
            });
        
        // Wait a bit to see the status
        await new Promise(resolve => setTimeout(resolve, 2000));
        await channel.unsubscribe();
    }
}

checkRealtime().catch(console.error);
