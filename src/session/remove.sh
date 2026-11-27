#!/bin/zsh
# Полное удаление функции «Сессия». Запускать из корня проекта; затем проверить, закоммитить и запушить.
set -e
[ -f src/main.ts ] && [ -d src/session ] || { echo "Запустите из корня проекта ВШМ.Кампус."; exit 1; }
for file in src/main.ts .github/workflows/pages.yml worker/dev/stand.mjs; do
  if [ -f "$file" ]; then
    grep -v 'SESSION-FEATURE' "$file" > "$file.tmp" || true
    mv "$file.tmp" "$file"
  fi
done
sed -i '' 's| src/session/model.test.ts||' package.json
python3 - <<'PY'
import re
s = open("README.md", encoding="utf-8").read()
open("README.md", "w", encoding="utf-8").write(re.sub(r"(?s)<!-- SESSION-FEATURE -->.*?<!-- /SESSION-FEATURE -->\n\n", "", s))
PY
rm -rf src/session
echo "Функция «Сессия» удалена. Проверьте: npm test && npm run build"
