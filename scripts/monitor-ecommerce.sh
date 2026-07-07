#!/usr/bin/env bash
# Runs ariadne's tracing backend against the ecommerce-kafka Kafka broker so
# ariadne can monitor ecommerce-kafka end to end.
#
#   ./scripts/monitor-ecommerce.sh
#
# What it does:
#   - starts ONLY ariadne's Postgres (ecommerce-kafka's Kafka is the single broker)
#   - applies storage migrations
#   - serves collector (consuming _tracing from localhost:9092), api and ui
#
# Ports: collector :3101 (avoids ecommerce order-service :3001), api :3000, ui :4200.
set -euo pipefail

ARIADNE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ARIADNE_DIR"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null
fi

export COLLECTOR_KAFKA_BROKERS="${COLLECTOR_KAFKA_BROKERS:-localhost:9092}"
export PORT="${COLLECTOR_PORT:-3101}"

echo "==> starting ariadne Postgres only (ecommerce-kafka owns Kafka on 9092)"
docker compose up -d postgres

echo "==> applying storage migrations"
npx nx run storage:migrate

echo "==> serving collector (:$PORT), api (:3000), ui (:4200)"
echo "    collector consumes '_tracing' from $COLLECTOR_KAFKA_BROKERS"
npx nx run-many -t serve --projects=collector,api,ui
