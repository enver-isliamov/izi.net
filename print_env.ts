import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

console.log('.env file exists:', fs.existsSync('.env'));
if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf8');
  console.log('Lines in .env (without secrets):');
  content.split('\n').forEach(line => {
    // Hide actual passwords / keys to maintain security
    if (line.includes('KEY') || line.includes('PASSWORD') || line.includes('TOKEN') || line.includes('KEY2') || line.includes('SECRET')) {
      const parts = line.split('=');
      console.log(`${parts[0]}= [SECRET]`);
    } else {
      console.log(line);
    }
  });
} else {
  console.log('No .env found');
}
