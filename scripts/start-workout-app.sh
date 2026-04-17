#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_URL="http://localhost:3000"
OLLAMA_URL="http://localhost:11434/api/tags"
BUILD_MARKER="$PROJECT_DIR/.next/BUILD_ID"

log() {
  printf '%s\n' "$1"
}

is_ollama_ready() {
  curl --silent --fail --max-time 2 "$OLLAMA_URL" >/dev/null 2>&1
}

start_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    log "Ollama CLI не найдена. Установите Ollama: https://ollama.com/download"
    exit 1
  fi

  log "Ollama не запущена. Пробую стартовать сервис..."
  nohup ollama serve >/tmp/workout-app-ollama.log 2>&1 &

  for _ in {1..20}; do
    if is_ollama_ready; then
      log "Ollama отвечает на localhost:11434"
      return
    fi
    sleep 1
  done

  log "Не удалось дождаться запуска Ollama. Лог: /tmp/workout-app-ollama.log"
  exit 1
}

is_app_ready() {
  curl --silent --output /dev/null --max-time 2 "$APP_URL" >/dev/null 2>&1
}

listener_pid() {
  lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

ensure_build() {
  cd "$PROJECT_DIR"

  if [ ! -f "$BUILD_MARKER" ]; then
    log "Собираю production-версию приложения..."
    npm run build
    return
  fi

  if find src package.json package-lock.json next.config.ts -newer "$BUILD_MARKER" -print -quit | grep -q .; then
    log "Исходники изменились. Пересобираю приложение..."
    npm run build
  fi
}

start_app() {
  log "Запускаю приложение..."
  cd "$PROJECT_DIR"

  (
    for _ in {1..30}; do
      if is_app_ready; then
        # Даём серверу дополнительные 1.5 сек на инициализацию Server Actions
        # и подключение к БД, прежде чем браузер откроется и отправит запросы.
        sleep 1.5
        open "$APP_URL"
        exit 0
      fi
      sleep 1
    done
    log "Приложение не поднялось на $APP_URL"
  ) &

  # Явно передаём путь к БД — не зависит от рабочей директории процесса.
  export RUNFORM_DATA_DIR="$PROJECT_DIR/data"
  npm run start
}

kill_stuck_app_if_needed() {
  local pid
  pid="$(listener_pid)"

  if [ -n "$pid" ] && ! is_app_ready; then
    log "На порту 3000 найден зависший процесс ($pid). Останавливаю его..."
    kill -9 "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi
}

main() {
  if is_ollama_ready; then
    log "Ollama уже запущена"
  else
    start_ollama
  fi

  if is_app_ready; then
    log "Приложение уже запущено на $APP_URL"
    open "$APP_URL"
    exit 0
  fi

  kill_stuck_app_if_needed
  ensure_build
  start_app
}

main "$@"
