// Real, pre-designed "One Launch" card templates for step 3 of OneLaunchPanel.tsx — each is a
// finished graphic design (background, decorative shapes, icons, badges, typography) exported as
// a PNG under public/onelaunch-templates/<section>/. Picking one swaps ONLY the headline text,
// the product photo, and the feature-callout labels via an image-to-image generation call (the
// template PNG + the user's product photo go in as reference images, buildPrompt below is the
// instruction) — everything else on the card must come out pixel-identical to the template.
//
// Sections/templates are added incrementally as real design files arrive (the catalog is meant
// to grow to ~200 templates across many sections) — this file is the single place to register a
// new one: drop the PNG under public/onelaunch-templates/<section>/, add a matching entry below.
// Names are unlocalized proper nouns, same convention as PRODUCT_PALETTES in palettes.ts.

export interface OneLaunchTemplateSection {
  key: string;
  label: string;
}

export interface OneLaunchTemplate {
  id: string;
  section: string;
  name: string;
  image: string;
  // Nearest aspect ratio label from the app's shared vocabulary (see ASPECT_RATIO_DIMENSIONS in
  // generate-image/index.ts) — the server maps it onto whatever ratios the chosen model actually
  // supports, same as every other aspect-ratio field in the app.
  aspectRatio: string;
  // How many feature-callout text slots this design has, in on-card top-to-bottom order.
  advantageSlots: number;
  buildPrompt: (name: string, advantages: string[]) => string;
}

export const ONELAUNCH_TEMPLATE_SECTIONS: OneLaunchTemplateSection[] = [{ key: 'premium', label: 'Премиум' }];

// Shared instruction wrapper: fills unused advantage slots with an explicit "leave the original
// label" fallback (rather than an empty string reaching the model) so a user who types fewer
// advantages than the template has slots for still gets a coherent card instead of a blank icon.
function fillAdvantages(advantages: string[], slots: number): string[] {
  const filled = advantages.slice(0, slots);
  while (filled.length < slots) filled.push('(оставь оригинальную подпись макета для этого блока)');
  return filled;
}

export const ONELAUNCH_TEMPLATES: OneLaunchTemplate[] = [
  {
    id: 'premium-body',
    section: 'premium',
    name: 'Боди для малыша',
    image: '/onelaunch-templates/premium/01-body.png',
    aspectRatio: '3:4',
    advantageSlots: 3,
    buildPrompt: (name, advantages) => {
      const [a1, a2, a3] = fillAdvantages(advantages, 3);
      return (
        `Используй прикреплённый первый референс-макет как ТОЧНЫЙ дизайн карточки: тёплый ` +
        `бежевый фон, декоративный полукруг, сердечко-разделитель под заголовком, засушенные ` +
        `цветы справа снизу, три квадратных плашки со значками слева, пилюля "УНИСЕКС" с ` +
        `иконками фигур в правом верхнем углу — сохрани всё это без изменений, включая шрифты, ` +
        `цвета, размеры и расположение элементов.\n\n` +
        `Замени только три вещи:\n` +
        `1) Заголовок "БОДИ ДЛЯ МАЛЫША" → "${name}", тот же шрифт/кегль/место.\n` +
        `2) Товар на фото — вместо боди помести товар со второго прикреплённого фото ` +
        `(пользователя), сохранив ракурс, масштаб, тени и позицию на бежевом круге как в ` +
        `оригинале.\n` +
        `3) Подписи под тремя значками слева (сейчас "100% ХЛОПОК", "МЯГКИЕ ШВЫ", "РАЗМЕРЫ ` +
        `56-80") → "${a1}", "${a2}", "${a3}" соответственно, сами иконки значков не трогай.\n\n` +
        `Пилюлю "УНИСЕКС" и подзаголовок под заголовком не менять. Результат — тот же макет ` +
        `один в один, только с этими заменами.`
      );
    },
  },
  {
    id: 'premium-pajama',
    section: 'premium',
    name: 'Пижама детская',
    image: '/onelaunch-templates/premium/02-pajama.png',
    aspectRatio: '3:4',
    advantageSlots: 4,
    buildPrompt: (name, advantages) => {
      const [a1, a2, a3, a4] = fillAdvantages(advantages, 4);
      return (
        `Используй прикреплённый первый референс-макет как ТОЧНЫЙ дизайн карточки: голубой/` +
        `белый фон, крупные геометрические круги, диагональные полосы и точечный узор снизу ` +
        `слева, подчёркивание под заголовком, четыре плашки со значками слева — сохрани всё ` +
        `это без изменений, включая шрифты, цвета, размеры и расположение элементов.\n\n` +
        `Замени только три вещи:\n` +
        `1) Заголовок "ПИЖАМА ДЕТСКАЯ" → "${name}", тот же шрифт/кегль/место.\n` +
        `2) Товар на фото — вместо пижамы помести товар со второго прикреплённого фото ` +
        `(пользователя), сохранив композицию (сложен/разложен так же, как в оригинале, в том ` +
        `же месте кадра).\n` +
        `3) Подписи рядом с четырьмя значками (сейчас "дышащая ткань", "нежный принт", ` +
        `"комплект 2 предмета", "для мальчиков и девочек") → "${a1}", "${a2}", "${a3}", "${a4}" ` +
        `соответственно, сами иконки значков не трогай.\n\n` +
        `Результат — тот же макет один в один, только с этими заменами.`
      );
    },
  },
  {
    id: 'premium-hoodie',
    section: 'premium',
    name: 'Худи детское',
    image: '/onelaunch-templates/premium/03-hoodie.png',
    aspectRatio: '3:4',
    advantageSlots: 3,
    buildPrompt: (name, advantages) => {
      const [a1, a2, a3] = fillAdvantages(advantages, 3);
      return (
        `Используй прикреплённый первый референс-макет как ТОЧНЫЙ дизайн карточки: тёмный ` +
        `(почти чёрный) фон, золотые диагональные мраморные полосы справа, золотая типографика, ` +
        `три круглых золотых значка слева, пилюля с возрастным диапазоном справа снизу — сохрани ` +
        `всё это без изменений, включая шрифты, цвета, размеры и расположение элементов.\n\n` +
        `Замени только три вещи:\n` +
        `1) Заголовок "ХУДИ ДЕТСКОЕ" → "${name}", тот же белый/золотой стиль и место.\n` +
        `2) Товар на фото — вместо худи помести товар со второго прикреплённого фото ` +
        `(пользователя), в том же ракурсе по центру-справа на тёмном фоне.\n` +
        `3) Подписи под тремя значками слева (сейчас "ПЛОТНЫЙ ФУТЕР", "СВОБОДНЫЙ КРОЙ", ` +
        `"УНИВЕРСАЛЬНЫЙ ЦВЕТ") → "${a1}", "${a2}", "${a3}" соответственно, сами иконки значков ` +
        `не трогай.\n\n` +
        `Подзаголовок под названием, золотые полосы и пилюлю с возрастом не менять. Результат — ` +
        `тот же макет один в один, только с этими заменами.`
      );
    },
  },
  {
    id: 'premium-pyramid',
    section: 'premium',
    name: 'Деревянная пирамидка',
    image: '/onelaunch-templates/premium/04-pyramid.png',
    aspectRatio: '3:4',
    advantageSlots: 3,
    buildPrompt: (name, advantages) => {
      const [a1, a2, a3] = fillAdvantages(advantages, 3);
      return (
        `Используй прикреплённый первый референс-макет как ТОЧНЫЙ дизайн карточки: тёплый ` +
        `бежево-оливковый фон, дуговая форма справа, деревянная поверхность на переднем плане, ` +
        `веточка эвкалипта и керамическая посуда рядом с товаром, зелёная пилюля "Montessori" ` +
        `справа сверху, три круглых зелёных значка слева — сохрани всё это без изменений, ` +
        `включая шрифты, цвета, размеры и расположение элементов.\n\n` +
        `Замени только три вещи:\n` +
        `1) Заголовок "ДЕРЕВЯННАЯ ПИРАМИДКА" → "${name}", тот же элегантный шрифт и место.\n` +
        `2) Товар на фото — вместо пирамидки помести товар со второго прикреплённого фото ` +
        `(пользователя) на ту же деревянную поверхность, сохранив композицию и декор (веточка, ` +
        `посуда) как в оригинале.\n` +
        `3) Подписи под тремя значками слева (сейчас "натуральное дерево", "безопасные краски", ` +
        `"от 1 года") → "${a1}", "${a2}", "${a3}" соответственно, сами иконки значков не трогай.\n\n` +
        `Пилюлю "Montessori" не менять. Результат — тот же макет один в один, только с этими ` +
        `заменами.`
      );
    },
  },
  {
    id: 'premium-bunny',
    section: 'premium',
    name: 'Мягкий зайка',
    image: '/onelaunch-templates/premium/05-bunny.png',
    aspectRatio: '3:4',
    advantageSlots: 3,
    buildPrompt: (name, advantages) => {
      const [a1, a2, a3] = fillAdvantages(advantages, 3);
      return (
        `Используй прикреплённый первый референс-макет как ТОЧНЫЙ дизайн карточки: нежный ` +
        `розово-белый градиентный фон, тонкие розовые кольца вокруг фото, сердечки по бокам ` +
        `заголовка, круглая розовая пилюля "0+" слева снизу, три круглых розовых значка слева — ` +
        `сохрани всё это без изменений, включая шрифты, цвета, размеры и расположение элементов.\n\n` +
        `Замени только три вещи:\n` +
        `1) Заголовок "МЯГКИЙ ЗАЙКА" → "${name}", тот же розовый элегантный стиль и место, ` +
        `сердечки по бокам оставь.\n` +
        `2) Товар на фото — вместо игрушки-зайки помести товар со второго прикреплённого фото ` +
        `(пользователя), сохранив мягкое постельное окружение и композицию как в оригинале.\n` +
        `3) Подписи под тремя значками слева (сейчас "гипоаллергенный наполнитель", "нежный ` +
        `плюш", "идея для подарка") → "${a1}", "${a2}", "${a3}" соответственно, сами иконки ` +
        `значков не трогай.\n\n` +
        `Пилюлю "0+" не менять. Результат — тот же макет один в один, только с этими заменами.`
      );
    },
  },
];
