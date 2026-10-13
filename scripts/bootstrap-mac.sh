#!/bin/bash
#
# RunForm bootstrap для macOS: ставит всё нужное на чистой машине,
# клонирует проект, собирает и открывает приложение.
#
# Использование (одной командой из любого места):
#   curl -fsSL https://raw.githubusercontent.com/iwizard7/RunForm/main/scripts/bootstrap-mac.sh -o /tmp/runform-bootstrap.sh && bash /tmp/runform-bootstrap.sh
#
# Либо из уже склонированного репозитория:
#   ./scripts/bootstrap-mac.sh
#
# Переменные окружения:
#   RUNFORM_INSTALL_DIR  — куда клонировать (по умолчанию ~/RunForm)
#
set -euo pipefail

REPO_URL="https://github.com/iwizard7/RunForm.git"
INSTALL_DIR="${RUNFORM_INSTALL_DIR:-$HOME/RunForm}"
TEXT_MODEL="qwen3:4b"
VISION_MODEL="qwen2.5-vl:3b"

log()  { printf '\n== %s\n' "$1"; }
ok()   { printf '   %s\n' "$1"; }
fail() { printf '\nОШИБКА: %s\n' "$1" >&2; exit 1; }

# --- 1. Только macOS ---------------------------------------------------------
[[ "$(uname -s)" == "Darwin" ]] || fail "Скрипт предназначен для macOS."

# --- 2. Homebrew -------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  fail "Homebrew не найден. Установите https://brew.sh и запустите скрипт снова."
fi

# --- 3. Node 20 (нужен для нативного better-sqlite3) -------------------------
node20_prefix="$(brew --prefix node@20 2>/dev/null || true)"
current_major="$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v' || true)"

if [[ "$current_major" != "20" ]]; then
  if [[ -z "$node20_prefix" || ! -x "$node20_prefix/bin/node" ]]; then
    log "Ставлю Node 20 (brew install node@20)..."
    brew install node@20
    node20_prefix="$(brew --prefix node@20)"
  fi
  export PATH="$node20_prefix/bin:$PATH"
  ok "Node в этом запуске: $(node -v)"

  # Постоянно добавляем node@20 в PATH, чтобы следующие терминалы
  # (и ./scripts/start-workout-app.sh) не упирались в другую версию Node.
  zprofile="$HOME/.zprofile"
  marker="$node20_prefix/bin"
  if ! grep -qF "$marker" "$zprofile" 2>/dev/null; then
    {
      printf '\n# RunForm: Node 20 нужен для нативного модуля better-sqlite3\n'
      printf 'export PATH="%s:$PATH"\n' "$marker"
    } >> "$zprofile"
    ok "Добавил PATH в ~/.zprofile (активируется в новых терминалах)"
  fi
fi
[[ "$(node -v | cut -d. -f1 | tr -d 'v')" == "20" ]] || fail "Не удалось получить Node 20."

# --- 4. Клонирование репозитория ---------------------------------------------
if [[ -f package.json ]] && grep -q '"name": "workout-app"' package.json 2>/dev/null; then
  PROJECT_DIR="$(pwd)"
  ok "Запущен из репозитория RunForm — использую текущую папку: $PROJECT_DIR"
else
  PROJECT_DIR="$INSTALL_DIR"
  if [[ -d "$PROJECT_DIR/.git" ]]; then
    ok "Найден существующий клон: $PROJECT_DIR (обновляю...)"
    git -C "$PROJECT_DIR" pull --ff-only || ok "Не удалось обновить — продолжаю с локальной версией."
  else
    log "Клонирую репозиторий в $PROJECT_DIR..."
    git clone "$REPO_URL" "$PROJECT_DIR"
  fi
fi
cd "$PROJECT_DIR"

# --- 5. Зависимости npm ------------------------------------------------------
log "Ставлю зависимости (npm ci)..."
npm ci

if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  # Prebuilt-бинарь не подошёл — нужен локальный компилятор.
  xcode-select -p >/dev/null 2>&1 \
    || fail "Нет Xcode Command Line Tools. Выполните: xcode-select --install, затем повторите скрипт."
  log "Пересобираю нативный модуль better-sqlite3..."
  npm rebuild better-sqlite3
  node -e "require('better-sqlite3')" >/dev/null 2>&1 \
    || fail "better-sqlite3 не загружается под Node $(node -v)."
fi

# --- 6. Ollama ----------------------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
  log "Ставлю Ollama (brew install --cask ollama)..."
  brew install --cask ollama
fi

if ! curl --silent --fail --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  log "Запускаю Ollama..."
  open -a Ollama >/dev/null 2>&1 || nohup ollama serve >/tmp/runform-ollama.log 2>&1 &
  for _ in $(seq 1 30); do
    curl --silent --fail --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
  curl --silent --fail --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1 \
    || fail "Ollama не поднялась. Лог: /tmp/runform-ollama.log"
fi
ok "Ollama отвечает на localhost:11434"

# --- 7. Модели ----------------------------------------------------------------
# `ollama list` печатает тег с ":latest", поэтому сравниваем по префиксу.
has_model() {
  ollama list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -q "^${1}"
}

if has_model "$TEXT_MODEL"; then
  ok "Текст-модель $TEXT_MODEL уже есть"
else
  log "Качаю текст-модель $TEXT_MODEL (~2.6 ГБ, первый ответ AI будет после этого)..."
  ollama pull "$TEXT_MODEL"
fi

if has_model "$VISION_MODEL"; then
  ok "Vision-модель $VISION_MODEL уже есть"
else
  answer=""
  # Читаем с /dev/tty, чтобы работал и вариант «curl | bash».
  printf '   Скачать vision-модель %s (~2 ГБ, для импорта тренировок со скриншотов)? [y/N] ' "$VISION_MODEL"
  read -r answer < /dev/tty 2>/dev/null || answer=""
  if [[ "$answer" == [yY] ]]; then
    ollama pull "$VISION_MODEL"
  else
    ok "Пропущено. Позже: ollama pull $VISION_MODEL"
  fi
fi

# --- 8. Ярлык в Applications ----------------------------------------------------
log "Ставлю ярлык RunForm.app в Applications..."
if ./scripts/install-launcher.sh; then
  ok "Ярлык установлен — запуск двойным кликом по RunForm.app"
else
  ok "Ярлык не установлен (не критично). Позже: ./scripts/install-launcher.sh"
fi

# --- 9. Сборка и запуск ------------------------------------------------------
log "Собираю и запускаю приложение (откроется в браузере)..."
exec ./scripts/start-workout-app.sh
