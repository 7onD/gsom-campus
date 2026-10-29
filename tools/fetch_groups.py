"""Снимок списка групп бакалавриата ВШМ (наборы 2023-2026) -> src/data/groups.json.
Источник: https://timetable.spbu.ru/GSOM и /api/v1/programs/{id}/groups. Запуск: python3 -I tools/fetch_groups.py"""
import json, re, html, datetime, subprocess
from concurrent.futures import ThreadPoolExecutor

def get(url, timeout=90):
    # curl: у системного Python на macOS нет корневых сертификатов
    return subprocess.run(["curl", "-sf", "-m", str(timeout), url], capture_output=True, check=True).stdout.decode("utf8")

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
        if 2023 <= int(years) <= 2026:
            progs.append((RU.get(name, name), int(years), int(pid)))

def load(p):
    name, year, pid = p
    data = json.loads(get(f"https://timetable.spbu.ru/api/v1/programs/{pid}/groups"))
    return {"program": name, "admission": year, "programId": pid,
            "groups": [{"id": g["StudentGroupId"], "name": g["StudentGroupName"]} for g in data["Groups"]]}

with ThreadPoolExecutor(8) as ex:
    out = list(ex.map(load, progs))
out.sort(key=lambda o: (-o["admission"], o["program"]))
json.dump({"fetched": datetime.date.today().isoformat(), "programs": out},
          open("src/data/groups.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(len(out), "программ,", sum(len(o["groups"]) for o in out), "групп")
