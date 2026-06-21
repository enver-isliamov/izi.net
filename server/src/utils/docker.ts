import http from 'http';

export function restartContainer(containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
    
    const req = http.request({
      socketPath,
      path: `/containers/${containerName}/restart?t=5`,
      method: 'POST',
      timeout: 15000,
    }, (res) => {
      if (res.statusCode === 204 || res.statusCode === 200) {
        console.log(`✅ [Docker] Container ${containerName} restarted successfully`);
        resolve(true);
      } else {
        console.warn(`⚠️ [Docker] Restart returned status ${res.statusCode}`);
        resolve(false);
      }
    });
    
    req.on('error', (err) => {
      console.warn(`⚠️ [Docker] Could not restart ${containerName}: ${err.message}`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.warn(`⚠️ [Docker] Restart timeout for ${containerName}`);
      resolve(false);
    });
    
    req.end();
  });
}
