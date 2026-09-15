import type { TrendWatchItem } from './types';

// Shown only when the table is genuinely empty — before the first collection run, or on a fresh
// deployment. It is always labelled "Демо-данные" in the header, and the numbers below are
// invented, which is exactly why that badge is not optional: an unlabelled example set would be
// indistinguishable from real reach figures someone might plan a campaign on.
//
// Thumbnails point at images this app already ships, so the demo works offline and adds no
// weight to the bundle.
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const dateAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

export const DEMO_TRENDS: TrendWatchItem[] = [
  {
    id: 'demo-1',
    platform: 'tiktok',
    title: 'Товар в неожиданном масштабе',
    description:
      'Продукт снят рядом с объектом несопоставимого размера — приём читается за первую секунду и удерживает до конца ролика.',
    video_url: null,
    thumbnail_url: '/onelaunch-templates/premium/04-pyramid.jpg',
    source_url: null,
    author: 'planet.noah',
    stats: { views: 2_400_000, likes: 318_000, shares: 12_400, comments: 4_100 },
    ai_advice:
      'Покажите ваш продукт в неожиданном масштабе, чтобы подчеркнуть ценность и вызвать эмоциональный отклик. Используйте реальные локации и людей для ощущения достоверности.',
    popularity_score: 98,
    region_rank: 1,
    fetch_date: dateAgo(3),
    fetched_at: daysAgo(3),
  },
  {
    id: 'demo-2',
    platform: 'instagram',
    title: 'Один предмет — три сценария',
    description:
      'Карусель из трёх кадров: один и тот же предмет в трёх бытовых ситуациях. Работает как наглядный ответ на «а мне это зачем».',
    video_url: null,
    thumbnail_url: '/onelaunch-templates/electronics/03.jpg',
    source_url: null,
    author: 'mari.daily',
    stats: { views: 890_000, likes: 132_000, shares: 6_800, comments: 2_300 },
    ai_advice:
      'Возьмите один товар и покажите три разных повода им воспользоваться. Один кадр — один сценарий, без текста поверх.',
    popularity_score: 91,
    region_rank: 1,
    fetch_date: dateAgo(4),
    fetched_at: daysAgo(4),
  },
  {
    id: 'demo-3',
    platform: 'tiktok',
    title: 'Честный обзор вместо рекламы',
    description:
      'Автор проговаривает недостатки продукта до его достоинств. Комментарии заметно теплее, чем под обычной интеграцией.',
    video_url: null,
    thumbnail_url: '/onelaunch-templates/premium/01-body.jpg',
    source_url: null,
    author: 'katya.review',
    stats: { views: 1_100_000, likes: 174_000, shares: 9_200, comments: 7_800 },
    ai_advice:
      'Начните ролик с настоящего минуса продукта и только потом переходите к сильным сторонам — доверие к остальному тексту резко растёт.',
    popularity_score: 87,
    region_rank: 2,
    fetch_date: dateAgo(5),
    fetched_at: daysAgo(5),
  },
  {
    id: 'demo-4',
    platform: 'threads',
    title: 'Почему покупатели возвращаются',
    description:
      'Короткий тред о том, что удерживает клиента после первой покупки: упаковка, следующий шаг и повод вернуться.',
    video_url: null,
    thumbnail_url: null,
    source_url: null,
    author: 'brand_thinker',
    stats: { comments: 1_900 },
    ai_advice:
      'Соберите свой список причин вернуться и проверьте, какие из них клиент вообще замечает. То, что не видно, — не работает.',
    popularity_score: 74,
    region_rank: 1,
    fetch_date: dateAgo(6),
    fetched_at: daysAgo(6),
  },
  {
    id: 'demo-5',
    platform: 'instagram',
    title: 'Распаковка без лица в кадре',
    description:
      'Только руки, стол и предмет. Формат снимается за час и не требует ни ведущего, ни сценария.',
    video_url: null,
    thumbnail_url: '/onelaunch-templates/electronics/06.jpg',
    source_url: null,
    author: 'studio.grain',
    stats: { views: 640_000, likes: 78_000, shares: 3_100, comments: 900 },
    ai_advice:
      'Снимите распаковку сверху, одним планом, без монтажа. Главное — звук: шуршание, щелчки, фактура.',
    popularity_score: 68,
    region_rank: 2,
    fetch_date: dateAgo(7),
    fetched_at: daysAgo(7),
  },
];
