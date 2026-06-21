import { exec } from 'child_process';

export function restartContainer(containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isDocker = process.env.IS_DOCKER === 'true';
    if (!isDocker) {
      console.warn(`⚠️ [Docker] Not in Docker, skipping restart of ${containerName}`);
      resolve(false);
      return;
    }

    exec(`docker restart ${containerName}`, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`⚠️ [Docker] Could not restart ${containerName}: ${error.message}`);
        resolve(false);
      } else {
        console.log(`✅ [Docker] Container ${containerName} restarted successfully`);
        resolve(true);
      }
    });
  });
}
