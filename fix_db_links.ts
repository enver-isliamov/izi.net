import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function fixDbLinks() {
  console.log("Fetching subscriptions...");
  const { data: subs, error } = await supabase.from('subscriptions').select('id, v2ray_config');
  if (error) {
    console.error("Error fetching subscriptions:", error);
    return;
  }

  for (const sub of subs) {
    if (!sub.v2ray_config) continue;
    
    let updatedConfig = sub.v2ray_config;
    let changed = false;

    // Check if JSON
    if (updatedConfig.trim().startsWith('[')) {
      try {
        const devices = JSON.parse(updatedConfig);
        for (const device of devices) {
          if (device.config) {
            const lines = device.config.split('\n');
            const newLines = lines.map((line: string) => {
              if (line.includes('security=reality') && !line.includes('spx=')) {
                changed = true;
                return line.replace('&flow=', '&spx=%2F&flow=');
              }
              return line;
            });
            device.config = newLines.join('\n');
          }
        }
        updatedConfig = JSON.stringify(devices);
      } catch (e) {
        console.error("Error parsing JSON config for sub", sub.id);
      }
    } else {
        const lines = updatedConfig.split('\n');
        const newLines = lines.map((line: string) => {
          if (line.includes('security=reality') && !line.includes('spx=')) {
            changed = true;
            return line.replace('&flow=', '&spx=%2F&flow=');
          }
          return line;
        });
        updatedConfig = newLines.join('\n');
    }

    if (changed) {
      console.log(`Updating sub ${sub.id}`);
      await supabase.from('subscriptions').update({ v2ray_config: updatedConfig }).eq('id', sub.id);
    }
  }
  console.log("Done fixing links!");
}

fixDbLinks();
