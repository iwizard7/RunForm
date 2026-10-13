#!/bin/bash
#
# Ставит ярлык RunForm.app в Applications: двойной клик запускает сервер
# (если он ещё не запущен) и открывает приложение в браузере.
#
# Использование:
#   ./scripts/install-launcher.sh
#
# Повторный запуск просто пересоздаёт ярлык (например, после переезда проекта).
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_NAME="RunForm.app"
ICON_SRC="$PROJECT_DIR/public/app-icon-1024.png"

log() { printf '%s\n' "$1"; }
fail() { printf 'ОШИБКА: %s\n' "$1" >&2; exit 1; }

# --- 1. Куда ставим -----------------------------------------------------------
if [[ -d /Applications && -w /Applications ]]; then
  DEST_DIR="/Applications"
else
  DEST_DIR="$HOME/Applications"
  mkdir -p "$DEST_DIR"
fi
APP="$DEST_DIR/$BUNDLE_NAME"

# --- 2. Каркас бандла ----------------------------------------------------------
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PROJECT_DIR/package.json" | head -n 1)"
VERSION="${VERSION:-0.0.0}"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>RunForm</string>
  <key>CFBundleDisplayName</key>
  <string>RunForm</string>
  <key>CFBundleIdentifier</key>
  <string>com.iwizard7.runform</string>
  <key>CFBundleExecutable</key>
  <string>RunForm</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

plutil -lint "$APP/Contents/Info.plist" >/dev/null || fail "Некорректный Info.plist"

# --- 3. Исполняемый файл-лаунчер ----------------------------------------------
# Finder запускает приложения вне шелла, поэтому PATH собираем вручную:
# без node@20 из Homebrew npm не найден и сервер не поднимется.
cat > "$APP/Contents/MacOS/RunForm" <<LAUNCHER
#!/bin/bash
# RunForm launcher (создан scripts/install-launcher.sh)
PROJECT_DIR="$PROJECT_DIR"
APP_URL="http://localhost:3000"
LOG="/tmp/runform-launcher.log"

export PATH="\$PROJECT_DIR/node_modules/.bin:/opt/homebrew/opt/node@20/bin:/usr/local/opt/node@20/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

notify() {
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "RunForm"' -e 'end run' "\$1" >/dev/null 2>&1 || true
}

# Сервер уже поднят — просто открываем вкладку.
if curl --silent --fail --max-time 2 --output /dev/null "\$APP_URL" 2>/dev/null; then
  open "\$APP_URL"
  exit 0
fi

# Первый клик ещё идёт — не плодим второй экземпляр сервера.
if pgrep -f "scripts/start-workout-app.sh" >/dev/null 2>&1; then
  notify "Приложение уже запускается, секунду..."
  exit 0
fi

if [ ! -x "\$PROJECT_DIR/scripts/start-workout-app.sh" ]; then
  osascript -e 'on run argv' -e 'display alert "RunForm не найден" message (item 1 of argv) as critical' -e 'end run' \\
    "Не найден проект: \$PROJECT_DIR. Склонируйте: git clone https://github.com/iwizard7/RunForm.git" >/dev/null 2>&1 || true
  exit 1
fi

notify "Запускаю сервер — приложение откроется в браузере..."
nohup "\$PROJECT_DIR/scripts/start-workout-app.sh" >>"\$LOG" 2>&1 &
exit 0
LAUNCHER
chmod +x "$APP/Contents/MacOS/RunForm"

# --- 4. Иконка (iconutil есть на каждом маке, PIL не нужна) --------------------
if [[ -f "$ICON_SRC" ]]; then
  ICONSET="$TMPDIR/RunForm.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"

  # имя_файла:пиксельный размер
  for spec in \
    "icon_16x16.png:16" "icon_16x16@2x.png:32" \
    "icon_32x32.png:32" "icon_32x32@2x.png:64" \
    "icon_128x128.png:128" "icon_128x128@2x.png:256" \
    "icon_256x256.png:256" "icon_256x256@2x.png:512" \
    "icon_512x512.png:512" "icon_512x512@2x.png:1024"; do
    name="${spec%%:*}"
    size="${spec##*:}"
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/$name" >/dev/null
  done

  if iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null; then
    log "Иконка: $APP/Contents/Resources/AppIcon.icns"
  else
    log "Иконка не собралась (не критично) — ярлык будет со стандартной иконкой."
  fi
  rm -rf "$ICONSET"
fi

# --- 5. Готово -----------------------------------------------------------------
touch "$APP"
log "Ярлык установлен: $APP (версия $VERSION, проект: $PROJECT_DIR)"
log "Двойной клик по RunForm.app запускает приложение и открывает его в браузере."
