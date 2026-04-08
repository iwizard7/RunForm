# RunForm Roadmap

## Done

- [x] Нормальный календарь тренировок
- [x] Умный weekly summary
- [x] Индекс формы
- [x] Цели и прогресс-бары
- [x] AI-сравнение тренировок
- [x] Умный AI-разбор тренировки
- [x] AI weekly coach
- [x] AI-объяснение красных флагов
- [x] AI-объяснение показателей
- [x] AI next workout planner v2
- [x] Экспорт красивого отчета
- [x] Heatmap активности
- [x] Цели нового уровня
- [x] Smart workout labels
- [x] PDF-отчёт уровня coach brief
- [x] Красные флаги по здоровью
- [x] JSON analytics expansion
  Добавить аналитику по полям, которые уже есть в исходных тренировочных JSON.
- [x] Прогноз следующего результата
- [x] Теги и категории тренировок (UI + поиск)
- [x] Отслеживание износа экипировки (кроссовок)
- [x] Интеграция HRV в ИИ тренера

## In Progress

## Next

- [ ] Автоимпорт папки с тренировками
  Приложение само подхватывает новые JSON-файлы и добавляет их в историю без ручного импорта.

- [ ] Визуализация GPS-трека
  Реализация отрисовки полилинии трека на странице Дашборда (подробнее: скрытые инструкции в workflow).

## JSON Analytics Expansion

- [x] Intensity Score
  Использовать `averageIntensity`, `minIntensity`, `maxIntensity` для оценки тяжести тренировки.

- [x] Running Efficiency
  Использовать `pace`, `avgHeartRate`, `cadence`, `steps`, `distance` для расчета эффективности.

- [x] Warmup / Cooldown Analysis
  Использовать `minHeartRate` и `zones.WARM UP` для оценки качества разминки и входа в тренировку.

- [x] Zone Profile
  Классифицировать тренировку как recovery / aerobic / threshold / hard по распределению времени по зонам.

- [x] Weather Impact
  Использовать `weather.temperature` и `weather.humidity` для влияния условий на темп и пульс.

- [x] MET-based Weekly Load
  Использовать `averageMETs` и длительность для умной оценки недельной нагрузки.

- [x] Indoor / Outdoor Profiling
  Использовать `location` для сравнения indoor и outdoor сессий.

- [x] Source / Device Audit
  Использовать `source` и `device.*` для техничного аудита происхождения данных.
