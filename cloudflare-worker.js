// Cloudflare Worker — TCP Proxy для Reality VPN
// Деплой: Cloudflare Dashboard → Workers → Create Worker

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket proxy для Reality
    if (request.headers.get('Upgrade') === 'websocket') {
      const serverHost = env.VPN_SERVER || '194.50.94.28';
      const serverPort = env.VPN_PORT || '443';

      try {
        // Подключаемся к VPN-серверу через TCP
        const socket = connect({ hostname: serverHost, port: parseInt(serverPort) });

        // Создаём WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // Проксируем данные
        const writer = server.writable.getWriter();
        const reader = server.readable.getReader();

        // Клиент → Сервер
        const clientReader = client.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await clientReader.read();
              if (done) break;
              writer.write(value);
            }
          } catch (e) {}
        })();

        // Сервер → Клиент
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              client.send(value);
            }
          } catch (e) {}
        })();

        return new Response(null, { status: 101, webSocket: client });
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 502 });
      }
    }

    return new Response('Cloudflare TCP Proxy', { status: 200 });
  }
};
