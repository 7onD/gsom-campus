"""Снимок списка групп бакалавриата ВШМ (наборы 2023-2026) -> src/data/groups.json.
Источник: https://timetable.spbu.ru/GSOM и /api/v1/programs/{id}/groups. Запуск: python3 -I tools/fetch_groups.py"""
import json, re, html, datetime, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

def get(url, timeout=90):
    # curl: у системного Python на macOS нет корневых сертификатов
    return subprocess.run(["curl", "-sf", "-m", str(timeout), url], capture_output=True, check=True).stdout.decode("utf8")

# учебный год начинается 1 сентября; бакалавры учатся 4 года -> наборы от (текущий - 3) до текущего
today = datetime.date.today()
current_year = today.year if today.month >= 8 else today.year - 1
first_admission = current_year - 3

page = get("https://timetable.spbu.ru/GSOM")
sec = page[page.find('id="studyProgramLevel4"'):page.find('id="studyProgramLevel5"')]
RU = {
    "International Management": "Международный менеджмент",
    "International Management (with study of Modern European or Oriental Languages)": "Международный менеджмент (с изучением языков)",
    "Management": "Менеджмент",
    "Management (with additional qualification «Business Analyst»)": "Менеджмент (бизнес-аналитик)",
    "Public Administration": "Государственное и муниципальное управление",
}
progs = []
for row in re.split(r'<li class="common-list-item row">', sec)[2:]:
    m = re.search(r'col-sm-5">\s*([^<]+?)\s*<', row)
    if not m: continue
    name = html.unescape(m.group(1))
    for pid, years in re.findall(r'href="/GSOM/StudyProgram/(\d+)"[^>]*>\s*(\d{4})', row):
        if first_admission <= int(years) <= current_year:
            progs.append((RU.get(name, name), int(years), int(pid)))

def load(p):
    name, year, pid = p
    data = json.loads(get(f"https://timetable.spbu.ru/api/v1/programs/{pid}/groups"))
    return {"program": name, "admission": year, "programId": pid,
            "groups": [{"id": g["StudentGroupId"], "name": g["StudentGroupName"]} for g in data["Groups"]]}

with ThreadPoolExecutor(8) as ex:
    out = list(ex.map(load, progs))
out.sort(key=lambda o: (-o["admission"], o["program"]))

# защита от плохого ответа сервера: не затираем рабочий файл пустыми или обрезанными данными
total = sum(len(o["groups"]) for o in out)
try:
    old = json.load(open("src/data/groups.json", encoding="utf8"))
    old_total = sum(len(o["groups"]) for o in old["programs"])
except (OSError, ValueError, KeyError):
    old, old_total = None, 0
if len(out) < 4 or total < max(10, int(old_total * 0.6)):
    print(f"ОШИБКА: подозрительно мало данных ({len(out)} программ, {total} групп; было {old_total}). Файл не изменён.")
    sys.exit(1)

# если групп не прибавилось и не убавилось, файл не трогаем (иначе каждую неделю меняется только дата)
if old is not None and old["programs"] == out:
    print(f"Без изменений: {len(out)} программ, {total} групп.")
    sys.exit(0)

json.dump({"fetched": today.isoformat(), "programs": out},
          open("src/data/groups.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(f"Обновлено: {len(out)} программ, {total} групп (было {old_total}).")
