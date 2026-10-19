import type { Language } from './i18n';

export type LegalDoc = 'privacy' | 'terms' | 'refund' | 'help';

// Edition of the Terms of Service + Privacy Policy that users accept (YYYYMMDD of their «updated» date). Must equal
// app_settings.legal_version (supabase/migrations/202610070001_legal_consent.sql): bump both whenever either text
// changes, and every account is asked to accept the new edition once at its next login.
export const LEGAL_VERSION = 20261020;

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

// Legal copy for ONEFLOW — written to reflect how the product actually works: the databases on our
// own server in Kazakhstan (Law of the RK No. 94-V on personal data), generations through
// OpenRouter/Replicate abroad (cross-border transfer, consented to with this Policy), the prepaid
// balance (payments paused until a new acquirer is connected), the optional Yandex Disk backup.
// Not a substitute for review by a lawyer before relying on it for real compliance.
export const LEGAL_CONTENT: Record<Language, Record<LegalDoc, LegalDocument>> = {
  ru: {
    privacy: {
      title: 'Политика конфиденциальности',
      updated: 'Последнее обновление: 20 октября 2026 г.',
      intro:
        'Настоящая Политика описывает, какие персональные данные собирает ONEFLOW (далее — ' +
        '«Сервис»), где они хранятся, кому передаются и какими правами вы располагаете. ' +
        'Политика составлена в соответствии с Законом Республики Казахстан «О персональных ' +
        'данных и их защите».',
      sections: [
        {
          heading: '1. Оператор и контакты',
          paragraphs: [
            'Собственник и оператор баз персональных данных Сервиса — {{ОПЕРАТОР}}.',
            'По всем вопросам обработки персональных данных пишите на ' +
              'nurgazinov.ayan@gmail.com.',
          ],
        },
        {
          heading: '2. Какие данные мы собираем',
          paragraphs: [
            'Данные аккаунта: адрес электронной почты, пароль (хранится только в виде ' +
              'криптографического хеша), даты регистрации и последней активности. При входе через ' +
              'Google — также имя и изображение профиля, которые передаёт Google.',
            'Данные о согласии: какую редакцию Условий и Политики вы приняли и когда, а также ' +
              'IP-адрес и сведения о браузере в момент принятия — чтобы подтвердить факт согласия.',
            'Данные об использовании: история генераций (модель, стоимость, время), баланс и его ' +
              'изменения. Для защиты от злоупотреблений мы сохраняем хеш IP-адреса, а не сам адрес.',
            'Ваш контент: промпты, загруженные и созданные файлы, сообщения в мессенджере Сервиса ' +
              'и обращения в поддержку.',
            'Данные интеграций: если вы подключаете Яндекс.Диск, мы храним токен доступа OAuth в ' +
              'зашифрованном виде — только для работы с вашей папкой на Диске.',
            'Платёжные данные: номера банковских карт Сервис не получает и не хранит — их вводят ' +
              'на стороне платёжного партнёра. Мы храним только сведения о поступившей оплате ' +
              '(сумма, дата), чтобы начислить баланс.',
            'Локальные данные: часть настроек интерфейса сохраняется в вашем браузере ' +
              '(localStorage) и не передаётся на наши серверы. Сторонние системы аналитики и ' +
              'рекламные трекеры Сервис не использует.',
          ],
        },
        {
          heading: '3. Зачем мы используем данные',
          paragraphs: [
            'Чтобы Сервис работал: генерации, баланс, история, проекты и мессенджер.',
            'Для входа в аккаунт и служебных писем: подтверждение адреса, восстановление пароля, ' +
              'уведомления о смене почты или пароля.',
            'Для поддержки: ответы на ваши обращения.',
            'Для безопасности: защита аккаунтов, предотвращение злоупотреблений и мошенничества.',
            'Мы не продаём персональные данные и не используем их для сторонней рекламы.',
          ],
        },
        {
          heading: '4. Где хранятся данные',
          paragraphs: [
            'Базы персональных данных Сервиса — аккаунты, история, баланс, файлы и сообщения — ' +
              'размещены на сервере в Республике Казахстан (облачный провайдер SmartCloud).',
            'Служебные письма отправляет почтовый сервер казахстанского хостинг-провайдера ' +
              'Megahost. Резервные копии базы данных шифруются и хранятся в объектном хранилище ' +
              'того же провайдера в Казахстане.',
            'Сайт и интерфейс Сервиса раздаются с того же сервера в Казахстане; журнал запросов ' +
              '(IP-адрес, сведения о браузере, время) хранится там же и нужен для защиты от атак и ' +
              'поиска ошибок.',
            'Доступ к данным ограничен: каждый пользователь видит только свои записи (Row Level ' +
              'Security), соединения шифруются (HTTPS).',
            'Данные хранятся, пока существует аккаунт. После удаления аккаунта мы удаляем ' +
              'связанные с ним данные, кроме сведений, которые обязаны хранить по закону (например, ' +
              'о платежах); из резервных копий они исчезают по мере их обновления — не позднее ' +
              'чем через 7 месяцев.',
          ],
        },
        {
          heading: '5. Передача данных, в том числе за пределы Казахстана',
          paragraphs: [
            'Генерации выполняют сторонние AI-модели за пределами Казахстана. Ваши промпты и ' +
              'прикреплённые к запросу файлы передаются OpenRouter (США), который направляет ' +
              'запрос разработчику выбранной вами модели, а для инструментов «Удалить фон» и ' +
              '«Апскейлер» — Replicate (США). Передаётся только содержимое запроса: email и другие ' +
              'данные аккаунта этим компаниям не передаются.',
            'Google (США) — если вы входите через аккаунт Google.',
            'Яндекс (Россия) — только если вы сами подключили Яндекс.Диск: файлы загружаются в ' +
              'вашу папку на Диске.',
            'GIPHY (США) — при поиске GIF в мессенджере: передаётся текст поискового запроса, а ' +
              'сами GIF ваш браузер загружает с серверов GIPHY.',
            'Платёжные партнёры — при оплате тарифа. Сейчас приём оплаты временно недоступен; ' +
              'ранее платежи принимал LemonSqueezy (США), и сведения о тех платежах хранятся у него.',
            'Принимая эту Политику, вы даёте согласие на трансграничную передачу перечисленных в ' +
              'этом разделе данных в объёме, необходимом для работы соответствующих функций. Без ' +
              'неё генерации, вход через Google, Яндекс.Диск и поиск GIF недоступны; остальные ' +
              'данные хранятся только в Казахстане.',
            'Иным лицам мы передаём данные только в случаях, предусмотренных законом.',
          ],
        },
        {
          heading: '6. Ваши права',
          paragraphs: [
            'Вы можете узнать, какие ваши данные мы храним, получить их копию, исправить их, ' +
              'отозвать согласие на обработку и удалить аккаунт — напишите на ' +
              'nurgazinov.ayan@gmail.com с адреса, привязанного к аккаунту.',
            'Доступ Сервиса к Яндекс.Диску можно отозвать в любой момент в настройках Яндекс ID; ' +
              'сохранённый токен мы удалим по вашему запросу.',
          ],
        },
        {
          heading: '7. Изменения политики',
          paragraphs: [
            'Мы можем обновлять эту Политику. При существенных изменениях мы попросим принять ' +
              'новую редакцию при следующем входе в Сервис.',
          ],
        },
      ],
    },
    terms: {
      title: 'Пользовательское соглашение',
      updated: 'Последнее обновление: 20 октября 2026 г.',
      intro:
        'Используя ONEFLOW (далее — «Сервис»), вы соглашаетесь с настоящими Условиями. Если вы ' +
        'не согласны с каким-либо пунктом — пожалуйста, не используйте Сервис.',
      sections: [
        {
          heading: '1. Описание сервиса',
          paragraphs: [
            'ONEFLOW — нод-редактор для генерации и адаптации рекламных фото, видео и аудио с ' +
              'помощью сторонних AI-моделей, а также набор инструментов для подготовки креативов ' +
              'под рекламные площадки (Kaspi, GDN, РСЯ/YAN, BYYD, Discovery и др.).',
            'Фактическую генерацию контента выполняют сторонние поставщики AI-моделей (через ' +
              'OpenRouter и Replicate) — Сервис выступает интерфейсом и не гарантирует бесперебойную ' +
              'доступность конкретных моделей, поскольку это зависит от третьих лиц.',
          ],
        },
        {
          heading: '2. Аккаунт',
          paragraphs: [
            'Для использования Сервиса необходима регистрация. Вы несёте ответственность за ' +
              'сохранность данных для входа и за все действия, совершённые под вашим аккаунтом.',
            'Один аккаунт предназначен для одного пользователя или организации; передача доступа ' +
              'третьим лицам без ведома Сервиса не допускается.',
          ],
        },
        {
          heading: '3. Тарифы и баланс',
          paragraphs: [
            'Баланс пополняется оплатой тарифа через платёжного партнёра, указанного на странице ' +
              'оплаты. На баланс зачисляется 85% от фактически оплаченной суммы (комиссия Сервиса и ' +
              'платёжного партнёра составляет 15%).',
            'Сейчас приём оплаты временно недоступен: мы подключаем новый способ оплаты и сообщим ' +
              'о нём в интерфейсе Сервиса. Ранее пополненный баланс сохраняется и расходуется как ' +
              'обычно.',
            'Баланс — это разовое пополнение: он не сгорает и не обнуляется в начале следующего ' +
              'месяца, а расходуется по мере использования Сервиса, пока не закончится.',
            'Стоимость каждой генерации списывается с баланса по фактической цене используемой ' +
              'модели в момент запроса. Если баланса недостаточно, запрос на генерацию будет ' +
              'отклонён — доплатите тариф, чтобы продолжить.',
            'Новый аккаунт без единой успешной оплаты имеет баланс $0 — бесплатный тариф даёт ' +
              'доступ к интерфейсу Сервиса, но не включает генерации за счёт Сервиса.',
          ],
        },
        {
          heading: '4. Допустимое использование',
          paragraphs: [
            'Запрещается использовать Сервис для создания незаконного контента, контента, ' +
              'нарушающего права третьих лиц (авторские права, товарные знаки, право на ' +
              'изображение), а также оскорбительного, дискриминационного или вводящего в ' +
              'заблуждение контента.',
            'Запрещены попытки автоматизированного обхода ограничений баланса, эксплуатации ' +
              'уязвимостей Сервиса или чрезмерной нагрузки на инфраструктуру.',
            'Мы оставляем за собой право приостановить или прекратить доступ к аккаунту при ' +
              'нарушении настоящих Условий.',
          ],
        },
        {
          heading: '5. Интеллектуальная собственность',
          paragraphs: [
            'Права на контент, созданный вами с помощью Сервиса, принадлежат вам в объёме, ' +
              'допускаемом условиями использования лежащих в основе AI-моделей третьих лиц.',
            'Сервис не гарантирует уникальность или отсутствие сходства сгенерированного контента ' +
              'с результатами, полученными другими пользователями тех же AI-моделей.',
          ],
        },
        {
          heading: '6. Ограничение ответственности',
          paragraphs: [
            'Сервис предоставляется «как есть». Мы не гарантируем, что сгенерированный контент ' +
              'будет полностью точным, пригодным для конкретной цели или свободным от ошибок.',
            'Мы не несём ответственности за перебои в работе сторонних поставщиков (OpenRouter, ' +
              'Replicate, Яндекс.Диск, платёжные партнёры и др.), находящиеся вне нашего контроля.',
          ],
        },
        {
          heading: '7. Изменение и прекращение работы Сервиса',
          paragraphs: [
            'Мы можем изменять функциональность Сервиса, тарифы и настоящие Условия. О ' +
              'существенных изменениях мы уведомим заранее через интерфейс Сервиса или по ' +
              'электронной почте.',
          ],
        },
        {
          heading: '8. Применимое право',
          paragraphs: ['К настоящим Условиям применяется законодательство Республики Казахстан.'],
        },
        {
          heading: '9. Контакты',
          paragraphs: ['По всем вопросам пишите на nurgazinov.ayan@gmail.com.'],
        },
      ],
    },
    refund: {
      title: 'Политика возврата средств',
      updated: 'Последнее обновление: 20 октября 2026 г.',
      intro:
        'Эта политика описывает, в каких случаях и в каком порядке возможен возврат средств за ' +
        'оплаченный тариф ONEFLOW.',
      sections: [
        {
          heading: '1. Общее правило',
          paragraphs: [
            'Оплата тарифа пополняет ваш баланс в Сервисе и является предоплатой за будущие ' +
              'генерации. Средства, уже списанные с баланса за выполненные генерации, возврату не ' +
              'подлежат — вы получили услугу, за которую заплатили.',
          ],
        },
        {
          heading: '2. Возврат неиспользованного остатка',
          paragraphs: [
            'Вы можете запросить возврат неизрасходованной части баланса в течение 14 дней с ' +
              'момента оплаты, написав в поддержку по адресу nurgazinov.ayan@gmail.com.',
            'К возврату принимается только та часть суммы, которая не была потрачена на ' +
              'генерации к моменту рассмотрения обращения.',
          ],
        },
        {
          heading: '3. Технические сбои',
          paragraphs: [
            'Если генерация завершилась ошибкой по вине Сервиса или используемой AI-модели, но ' +
              'баланс всё же был списан, соответствующая сумма возвращается на баланс. Если это не ' +
              'произошло автоматически — напишите в поддержку с деталями запроса (модель, время, ' +
              'сумма списания).',
          ],
        },
        {
          heading: '4. Способ возврата',
          paragraphs: [
            'Возврат производится тем же способом, которым была произведена оплата, через ' +
              'платёжного партнёра, принявшего платёж. По платежам, принятым через LemonSqueezy, ' +
              'возврат оформляется через LemonSqueezy. Срок зачисления зависит от вашего банка или ' +
              'платёжной системы.',
          ],
        },
        {
          heading: '5. Исключения',
          paragraphs: [
            'Возврат не производится, если аккаунт был заблокирован за нарушение Условий ' +
              'использования, либо если запрос на возврат подан позднее 14 дней с момента оплаты.',
          ],
        },
      ],
    },
    help: {
      title: 'Справка',
      updated: 'Последнее обновление: 1 сентября 2026 г.',
      intro:
        'Короткий гид по ONEFLOW. Если здесь нет ответа на ваш вопрос — напишите в поддержку ' +
        'через профиль внутри приложения после входа.',
      sections: [
        {
          heading: '1. Что такое ONEFLOW',
          paragraphs: [
            'ONEFLOW — конструктор рекламных фото и видео на нодах: собираете цепочку из промпта, ' +
              'генерации изображения/видео и адаптации под площадку (BYYD, Discovery, GDN, Kaspi, ' +
              'РСЯ), и получаете готовый материал без дизайнера.',
          ],
        },
        {
          heading: '2. С чего начать',
          paragraphs: [
            'После входа выберите шаблон под вашу нишу («Шаблоны» → нужная категория) или начните ' +
              'с пустого холста и добавьте первую ноду («Промпт» или «Фото») вручную.',
            'Баланс и лимит генераций видны в верхней панели приложения; пополнить — кнопкой ' +
              '«Оплатить тариф».',
          ],
        },
        {
          heading: '3. Сохранение и проекты',
          paragraphs: [
            '«Файл → Сохранить проект» сохраняет текущий холст в файл, «Открыть проект» — ' +
              'загружает его обратно. Каждая генерация также сохраняется в архив проекта ' +
              'автоматически.',
          ],
        },
        {
          heading: '4. Поддержка',
          paragraphs: [
            'Если что-то не работает или остались вопросы — напишите разработчику через раздел ' +
              '«Профиль» внутри приложения.',
          ],
        },
      ],
    },
  },
  en: {
    privacy: {
      title: 'Privacy Policy',
      updated: 'Last updated: October 20, 2026',
      intro:
        'This Privacy Policy explains what personal data ONEFLOW (the "Service") collects, where ' +
        'it is stored, who it is shared with, and what rights you have. It is written in ' +
        'accordance with the Law of the Republic of Kazakhstan "On Personal Data and Their ' +
        'Protection".',
      sections: [
        {
          heading: '1. Operator and contact',
          paragraphs: [
            'The owner and operator of the Service’s personal data databases is {{OPERATOR}}.',
            'For any questions about how we handle personal data, write to ' +
              'nurgazinov.ayan@gmail.com.',
          ],
        },
        {
          heading: '2. What we collect',
          paragraphs: [
            'Account data: your email address, your password (stored only as a cryptographic ' +
              'hash), sign-up and last-activity dates. If you sign in with Google, also the name ' +
              'and profile picture Google shares with us.',
            'Consent records: which edition of the Terms and this Policy you accepted and when, ' +
              'plus your IP address and browser details at that moment — to prove the consent.',
            'Usage data: your generation history (model, cost, time), your balance and its ' +
              'changes. To prevent abuse we store a hash of your IP address, not the address ' +
              'itself.',
            'Your content: prompts, uploaded and generated files, messages in the Service’s ' +
              'messenger, and support requests.',
            'Integration data: if you connect Yandex Disk, we store the OAuth access token ' +
              'encrypted — used only to work with your own Disk folder.',
            'Payment data: the Service never receives or stores card numbers — you enter them on ' +
              'the payment partner’s side. We only keep the record of a received payment ' +
              '(amount, date) to credit your balance.',
            'Local data: some interface preferences are stored in your browser (localStorage) and ' +
              'never sent to our servers. The Service uses no third-party analytics or advertising ' +
              'trackers.',
          ],
        },
        {
          heading: '3. Why we use it',
          paragraphs: [
            'To run the Service: generations, balance, history, projects, and the messenger.',
            'For sign-in and service emails: address confirmation, password recovery, notices ' +
              'about email or password changes.',
            'For support: replying to your requests.',
            'For security: protecting accounts and preventing abuse and fraud.',
            'We do not sell personal data or use it for third-party advertising.',
          ],
        },
        {
          heading: '4. Where data is stored',
          paragraphs: [
            'The Service’s personal data databases — accounts, history, balance, files, and ' +
              'messages — are hosted on a server in the Republic of Kazakhstan (cloud provider ' +
              'SmartCloud).',
            'Service emails are sent by the mail server of the Kazakhstan hosting provider ' +
              'Megahost. Database backups are encrypted and kept in the same provider’s object ' +
              'storage in Kazakhstan.',
            'The website and the Service interface are served from the same server in Kazakhstan; ' +
              'its request log (IP address, browser details, time) is kept there too and is used ' +
              'to fend off attacks and find errors.',
            'Access is restricted: every user can only see their own records (Row Level ' +
              'Security), and connections are encrypted (HTTPS).',
            'Data is kept for as long as your account exists. After you delete your account, we ' +
              'delete the associated data except what we are required to keep by law (e.g. payment ' +
              'records); it leaves our backups as they rotate — within 7 months at most.',
          ],
        },
        {
          heading: '5. Sharing, including outside Kazakhstan',
          paragraphs: [
            'Generations are run by third-party AI models outside Kazakhstan. Your prompts and the ' +
              'files attached to a request are sent to OpenRouter (USA), which routes the request ' +
              'to the developer of the model you chose, and, for the "Remove background" and ' +
              '"Upscaler" tools, to Replicate (USA). Only the request content is sent: your email ' +
              'and other account data are not shared with these companies.',
            'Google (USA) — if you sign in with a Google account.',
            'Yandex (Russia) — only if you connect Yandex Disk yourself: files are uploaded to ' +
              'your own Disk folder.',
            'GIPHY (USA) — when you search for GIFs in the messenger: the search text is sent, and ' +
              'your browser loads the GIFs from GIPHY’s servers.',
            'Payment partners — when you pay for a tariff. Payments are temporarily unavailable; ' +
              'earlier payments were accepted by LemonSqueezy (USA), which keeps the records of ' +
              'those payments.',
            'By accepting this Policy you consent to the cross-border transfer of the data listed ' +
              'in this section, to the extent needed for the corresponding features. Without it, ' +
              'generations, Google sign-in, Yandex Disk, and GIF search are unavailable; all other ' +
              'data stays in Kazakhstan.',
            'We share data with anyone else only where required by law.',
          ],
        },
        {
          heading: '6. Your rights',
          paragraphs: [
            'You can find out what data we hold about you, get a copy, correct it, withdraw your ' +
              'consent to processing, and delete your account — write to ' +
              'nurgazinov.ayan@gmail.com from the address linked to your account.',
            'You can revoke the Service’s access to Yandex Disk at any time in your Yandex ID ' +
              'settings; we will delete the stored token on request.',
          ],
        },
        {
          heading: '7. Changes to this policy',
          paragraphs: [
            'We may update this Policy. For material changes, we will ask you to accept the new ' +
              'edition the next time you sign in.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      updated: 'Last updated: October 20, 2026',
      intro:
        'By using ONEFLOW (the "Service") you agree to these Terms. If you disagree with any ' +
        'part of them, please do not use the Service.',
      sections: [
        {
          heading: '1. Description of the Service',
          paragraphs: [
            'ONEFLOW is a node-based editor for generating and adapting advertising photos, ' +
              'video, and audio using third-party AI models, plus tools for preparing creatives ' +
              'for ad platforms (Kaspi, GDN, YAN, BYYD, Discovery, and others).',
            'Actual content generation is performed by third-party AI model providers (through ' +
              'OpenRouter and Replicate) — the Service acts as an interface and does not guarantee ' +
              'uninterrupted availability of any specific model, since that depends on those third ' +
              'parties.',
          ],
        },
        {
          heading: '2. Account',
          paragraphs: [
            'Using the Service requires registration. You are responsible for keeping your login ' +
              'credentials safe and for all activity under your account.',
            'One account is intended for one user or organization; sharing access with third ' +
              'parties without the Service’s knowledge is not permitted.',
          ],
        },
        {
          heading: '3. Tariffs and balance',
          paragraphs: [
            'You top up your balance by paying for a tariff through the payment partner shown on ' +
              'the payment page. Your balance is credited with 85% of the amount actually charged ' +
              '(the Service and payment partner retain a 15% margin).',
            'Payments are temporarily unavailable: we are connecting a new payment method and will ' +
              'announce it in the Service interface. A balance you topped up earlier is kept and ' +
              'spent as usual.',
            'The balance is a one-time top-up: it never expires and never resets at the start of ' +
              'a new month — it is spent down as you use the Service until it runs out.',
            'The cost of each generation is deducted from your balance at the actual price of the ' +
              'model used at the time of the request. If your balance is insufficient, the ' +
              'generation request will be declined — top up your tariff to continue.',
            'A new account with no successful payment has a $0 balance — the free tier gives ' +
              'access to the Service’s interface but does not include any generations funded ' +
              'by the Service.',
          ],
        },
        {
          heading: '4. Acceptable use',
          paragraphs: [
            'You may not use the Service to create illegal content, content infringing third-' +
              'party rights (copyright, trademarks, right of publicity), or offensive, ' +
              'discriminatory, or misleading content.',
            'Automated attempts to bypass balance limits, exploit Service vulnerabilities, or ' +
              'place excessive load on the infrastructure are prohibited.',
            'We reserve the right to suspend or terminate account access for violations of these ' +
              'Terms.',
          ],
        },
        {
          heading: '5. Intellectual property',
          paragraphs: [
            'Rights to content you create with the Service belong to you, to the extent permitted ' +
              'by the terms of use of the underlying third-party AI models.',
            'The Service does not guarantee that generated content will be unique or free from ' +
              'similarity to output produced by other users of the same AI models.',
          ],
        },
        {
          heading: '6. Limitation of liability',
          paragraphs: [
            'The Service is provided "as is". We do not guarantee that generated content will be ' +
              'fully accurate, fit for a particular purpose, or error-free.',
            'We are not liable for outages of third-party providers (OpenRouter, Replicate, Yandex ' +
              'Disk, payment partners, etc.) that are outside our control.',
          ],
        },
        {
          heading: '7. Changes and termination',
          paragraphs: [
            'We may change the Service’s functionality, pricing, and these Terms. We will ' +
              'give advance notice of material changes through the Service interface or by email.',
          ],
        },
        {
          heading: '8. Governing law',
          paragraphs: ['These Terms are governed by the laws of the Republic of Kazakhstan.'],
        },
        {
          heading: '9. Contact',
          paragraphs: ['For any questions, write to nurgazinov.ayan@gmail.com.'],
        },
      ],
    },
    refund: {
      title: 'Refund Policy',
      updated: 'Last updated: October 20, 2026',
      intro:
        'This policy describes when and how you can get a refund for a paid ONEFLOW tariff.',
      sections: [
        {
          heading: '1. General rule',
          paragraphs: [
            'Paying for a tariff tops up your Service balance and is a prepayment for future ' +
              'generations. Funds already deducted from your balance for completed generations ' +
              'are non-refundable — you received the service you paid for.',
          ],
        },
        {
          heading: '2. Refund of an unused balance',
          paragraphs: [
            'You can request a refund of the unspent portion of your balance within 14 days of ' +
              'payment by writing to support at nurgazinov.ayan@gmail.com.',
            'Only the portion of the amount not yet spent on generations at the time your request ' +
              'is reviewed is eligible for a refund.',
          ],
        },
        {
          heading: '3. Technical failures',
          paragraphs: [
            'If a generation fails due to a fault of the Service or the AI model used, but your ' +
              'balance was still deducted, that amount is credited back to your balance. If this ' +
              'doesn’t happen automatically, contact support with the request details (model, ' +
              'time, amount deducted).',
          ],
        },
        {
          heading: '4. Refund method',
          paragraphs: [
            'Refunds go back to the method you paid with, through the payment partner that ' +
              'accepted the payment. Payments accepted through LemonSqueezy are refunded through ' +
              'LemonSqueezy. The time to receive the funds depends on your bank or payment ' +
              'provider.',
          ],
        },
        {
          heading: '5. Exceptions',
          paragraphs: [
            'No refund is given if the account was suspended for violating the Terms of Service, ' +
              'or if the refund request is submitted more than 14 days after payment.',
          ],
        },
      ],
    },
    help: {
      title: 'Help',
      updated: 'Last updated: September 1, 2026',
      intro:
        'A short guide to ONEFLOW. If you can’t find what you need here, contact support from ' +
        'your profile inside the app once you’re signed in.',
      sections: [
        {
          heading: '1. What ONEFLOW is',
          paragraphs: [
            'ONEFLOW is a node-based ad creative builder: chain a prompt, image/video generation, ' +
              'and platform adaptation (BYYD, Discovery, GDN, Kaspi, Yandex Ads) into a finished ' +
              'asset without a designer.',
          ],
        },
        {
          heading: '2. Getting started',
          paragraphs: [
            'After signing in, pick a template for your niche ("Templates" → the right category) ' +
              'or start from a blank canvas and add your first node ("Prompt" or "Photo") manually.',
            'Your balance and generation limit are shown in the top bar; top up with the "Upgrade" ' +
              'button.',
          ],
        },
        {
          heading: '3. Saving and projects',
          paragraphs: [
            '"File → Save project" saves the current canvas to a file, "Open project" loads it ' +
              'back. Every generation is also saved to the project archive automatically.',
          ],
        },
        {
          heading: '4. Support',
          paragraphs: [
            "If something isn't working or you have questions, message the developer from the " +
              '"Profile" section inside the app.',
          ],
        },
      ],
    },
  },
};
