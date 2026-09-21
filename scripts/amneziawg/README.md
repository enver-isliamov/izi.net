# AmneziaWG на izinet

AmneziaWG — обфусцированный WireGuard: работает в ядре (быстро) и маскирует трафик от DPI. Пользователь получает **файл конфигурации** (`.conf`), который импортируется в приложение AmneziaWG / AmneziaVPN или в роутер с поддержкой AWG.

## Файлы

| Файл | Назначение |
|---|---|
| `setup_awg.sh` | Ставит amneziawg (модуль + awg-tools), создаёт интерфейс `awg0` с обфускацией, включает NAT/forward, открывает UDP-порт, запускает `awg-quick@awg0` и сохраняет параметры сервера в `/etc/amnezia/amneziawg/izinet-server.json` |
| `new_awg_client.sh <имя>` | Резервная выдача конфига из CLI в `/root/awg-clients/<имя>.conf` |

## Основной путь — через приложение

1. Админка → **Настройки** → карточка AmneziaWG: статус сервера (поднят/нет), количество клиентов.
2. Пользователь в кабинете: «Мои устройства» → **«Добавить AmneziaWG (файл)»** → скачивает `<имя>.conf`.
3. Это устройство видно в **админке** в карточке пользователя как обычное: можно пересоздать (новые ключи) или удалить (peer снимается с сервера).
4. При удалении устройства peer удаляется из `awg0` и из реестра `/etc/amnezia/amneziawg/izinet-peers.json`.

Приложение работает с сервером через docker-сокет и `nsenter` (тот же механизм, что уже используется для Hysteria2), поэтому AWG должен быть установлен **на хосте**, а не в контейнере.

## Проверка

```bash
awg show awg0                       # интерфейс и список peer'ов
systemctl is-active awg-quick@awg0  # active
cat /etc/amnezia/amneziawg/izinet-peers.json   # реестр выданных клиентов
```

## Откат

```bash
systemctl disable --now awg-quick@awg0
apt-get remove -y amneziawg amneziawg-tools
rm -rf /etc/amnezia/amneziawg /root/awg-clients
iptables -t nat -D POSTROUTING -s 10.9.0.0/24 -o eth0 -j MASQUERADE
```

## Важно

- Порт по умолчанию **UDP 51820** (443 занят Reality, UDP 443 — Hysteria2). Изменить: `AWG_PORT=51821 bash scripts/amneziawg/setup_awg.sh`.
- Обфускационные параметры (Jc/Jmin/Jmax/S1/S2/H1–H4) генерируются один раз и должны совпадать у сервера и клиента — они попадают в `.conf` автоматически.
- Расход трафика и срок подписки для AWG-устройств учитываются в лимите подписки на уровне кабинета; отдельного счётчика трафика по AWG пока нет.
