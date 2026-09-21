# AmneziaWG в контейнере (userspace, БЕЗ модуля ядра).
# Собирает amneziawg-go (userspace-реализация) и awg-tools, затем запускает интерфейс awg0.
FROM golang:1.23-alpine AS gobuild
RUN apk add --no-cache git make gcc musl-dev linux-headers
WORKDIR /src
RUN git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-go.git /src/awg-go \
 && cd /src/awg-go && make

FROM alpine:3.20 AS toolsbuild
RUN apk add --no-cache git make gcc musl-dev linux-headers bash
WORKDIR /src
RUN git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git /src/awg-tools \
 && cd /src/awg-tools/src && make

FROM alpine:3.20
RUN apk add --no-cache bash iproute2 iptables openresolv
COPY --from=gobuild /src/awg-go/amneziawg-go /usr/bin/amneziawg-go
COPY --from=toolsbuild /src/awg-tools/src/wg /usr/bin/awg
COPY --from=toolsbuild /src/awg-tools/src/wg-quick/linux.bash /usr/bin/awg-quick
RUN chmod +x /usr/bin/amneziawg-go /usr/bin/awg /usr/bin/awg-quick \
 && mkdir -p /etc/amnezia/amneziawg
ENV AWG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
ENV WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
# Интерфейс поднимает entrypoint-скрипт ниже
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
