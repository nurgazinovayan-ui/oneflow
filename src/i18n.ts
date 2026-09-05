import { create } from 'zustand';

export type Language = 'ru' | 'en';

const LANGUAGE_STORAGE_KEY = 'oneflow-language';

function loadInitialLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: loadInitialLanguage(),
  setLanguage: (language) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Private-browsing/quota edge case — language just won't survive a reload.
    }
    set({ language });
  },
}));

// Covers the entire UI surface — shell chrome, modals, context menus, both chat panels, the
// web login gate, and every node card's own labels/buttons/placeholders/errors. The one
// deliberate exception: the actual prompt text the app constructs and sends to the AI models
// (e.g. AdaptNode's format-adaptation instructions, the assistant system prompts in
// electron/main.ts) stays as-is — that's content for the model, not UI the user reads.
export interface Translations {
  toolbar: {
    file: string;
    saveProject: string;
    saveProjectSuccess: string;
    saveProjectError: string;
    openProject: string;
    saveWorkspace: string;
    openWorkspace: string;
    dspTooltip: string;
    sendMessageTooltip: string;
    settingsTooltip: string;
    aboutTooltip: string;
    profileTooltip: string;
    newProjectTooltip: string;
    closeProjectTooltip: string;
    projectName: (n: number) => string;
    importedProjectName: string;
    templates: string;
    templatesBusinessSection: string;
    templatesMarketplacesSection: string;
  };
  modeSwitch: {
    nodesAndAdapt: string;
    quickGeneration: string;
    textWork: string;
    evaluation: string;
    oneLaunch: string;
    musicAudio: string;
    strategy: string;
  };
  nodeLabels: {
    prompt: string;
    image: string;
    imageGen: string;
    vector: string;
    videoGen: string;
    videoGenPro: string;
    adapt: string;
    aiAssistantTooltip: string;
    flokoName: string;
    flokoStatus: string;
    flokoChatLabel: string;
  };
  archive: {
    title: (count: number) => string;
    openFolder: string;
    empty: string;
  };
  budget: {
    tooltip: (spent: string, limit: string) => string;
  };
  settingsModal: {
    title: string;
    account: string;
    logout: string;
    apiToken: string;
    apiTokenHint: string;
    budgetLimit: string;
    budgetHint: string;
    close: string;
    save: string;
    saved: string;
  };
  aboutModal: {
    title: string;
    text: string;
    close: string;
  };
  profileModal: {
    title: string;
    loading: string;
    notLoggedIn: string;
    paymentNotConfigured: string;
    noSubscription: string;
    untilDate: (date: string) => string;
    sessionGenerations: (count: number) => string;
    periodLabel: string;
    totalLabel: (count: number, cost: string) => string;
    emptyPeriod: string;
    exportBtn: string;
    exportPreparing: string;
    exportSaved: string;
    close: string;
    preferencesTitle: string;
    languageLabel: string;
    themeLabel: string;
    themeDark: string;
    themeLight: string;
    statusLabels: Record<string, string>;
    categoryLabels: Record<string, string>;
    csvHeader: string;
    exportError: string;
    locale: string;
    legalSectionTitle: string;
  };
  adminModal: {
    title: string;
    hint: string;
    emailLabel: string;
    messageLabel: string;
    messagePlaceholder: string;
    close: string;
    send: string;
    sending: string;
    sent: (count: number) => string;
    genericError: string;
    onlineTitle: string;
    onlineLoading: string;
    onlineEmpty: string;
    lastSeenJustNow: string;
    lastSeenMinutesAgo: (n: number) => string;
    tabMessages: string;
    tabStats: string;
    broadcastLabel: string;
    recipientsLabel: string;
    addEmailPlaceholder: string;
    noRecipientsError: string;
    statsHint: string;
    statsLoading: string;
    statsEmpty: string;
    statsError: string;
    statsSummaryTitle: string;
    statsLogTitle: string;
    statsColumnEmail: string;
    statsColumnModel: string;
    statsColumnCategory: string;
    statsColumnCost: string;
    statsColumnWhen: string;
    statsGenerationsCount: (n: number) => string;
  };
  aiAssistant: {
    title: string;
    copyAllTooltip: string;
    copiedLabel: string;
    closeTooltip: string;
    emptyHint: string;
    copyTooltip: string;
    removeTooltip: string;
    inputPlaceholder: string;
    dropHint: string;
    addedNodes: (count: number) => string;
    failedNodes: string;
    documentLabel: (name: string) => string;
    imageAttachedLabel: (name: string) => string;
    transcriptUser: string;
    transcriptAssistant: string;
  };
  evaluation: {
    title: string;
    subtitle: string;
    uploadSectionLabel: string;
    platformLabel: string;
    platformAny: string;
    addImageTooltip: string;
    removeImageTooltip: string;
    maxImagesHint: string;
    evaluateBtn: string;
    evaluatingBtn: string;
    noImagesError: string;
    strengthsLabel: string;
    weaknessesLabel: string;
    verdictLabel: string;
    winnerBadge: string;
    scoreOutOf: string;
    noteTitle: string;
    noteHowLabel: string;
    noteHowItems: string[];
    noteAccuracyLabel: string;
    noteAccuracy: string;
    noteTipLabel: string;
    noteTip: string;
    loadingMessages: string[];
  };
  oneLaunch: {
    title: string;
    subtitle: string;
    step1Title: string;
    step2Title: string;
    step3Title: string;
    step4Title: string;
    step5Title: string;
    photoLabel: string;
    addPhotoTooltip: string;
    removePhotoTooltip: string;
    nameLabel: string;
    namePlaceholder: string;
    advantagesLabel: string;
    advantagesPlaceholder: string;
    improveBtn: string;
    improvingBtn: string;
    formatsLabel: string;
    formatSquare: string;
    formatStory: string;
    formatLandscape: string;
    paletteLabel: string;
    recommendedBadge: string;
    customPaletteLabel: string;
    customPaletteHint: string;
    launchBtn: string;
    launchingBtn: string;
    noPhotoError: string;
    noNameError: string;
    noFormatError: string;
    statusAnalyzingPhoto: string;
    statusGenerating: (format: string) => string;
    statusEvaluating: string;
    statusWritingCaptions: string;
    captionsTitle: string;
    downloadTooltip: string;
    templateNoneLabel: string;
    templateUniqueHint: string;
    templateFormatNote: string;
    templatePaletteNote: string;
    templateResultLabel: string;
    discountPlaceholder: string;
  };
  strategy: {
    title: string;
    headerSubtitle: string;
    months: string;
    tabOverview: string;
    tabMap: string;
    tabPlan: string;
    newStrategyBtn: string;
    onboardGoalStep: string;
    onboardContextStep: string;
    onboardOf: string;
    onboardBack: string;
    onboardContinue: string;
    onboardCreate: string;
    onboardGenerating: string;
    marketLabel: string;
    durationLabel: string;
    budgetLabel: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    photoLabel: string;
    scoreTitle: string;
    goalCardTitle: string;
    positioningCardTitle: string;
    offerCardTitle: string;
    audienceCardTitle: string;
    channelsCardTitle: string;
    risksCardTitle: string;
    opportunitiesCardTitle: string;
    contentMatrixTitle: string;
    funnelCardTitle: string;
    segments: string;
    openBtn: string;
    createBtn: string;
    generateBtn: string;
    planThisWeek: string;
    drawerPotential: string;
    drawerMainJob: string;
    drawerPainPoints: string;
    drawerOffer: string;
    drawerAllocation: string;
    createOfferBtn: string;
    createModalTitle: string;
    createModalFormat: string;
    createModalHint: string;
    createModalBtn: string;
    assistantTitle: string;
    assistantCollapse: string;
    assistantContext: string;
    assistantInsightLabel: string;
    assistantApply: string;
    assistantApplied: string;
    assistantExplain: string;
    assistantExplaining: string;
    assistantPlaceholder: string;
    scoreMetricAudience: string;
    scoreMetricPositioning: string;
    scoreMetricOffer: string;
    scoreMetricChannels: string;
    scoreMetricContent: string;
    scoreMetricRetention: string;
    scoreExcellent: string;
    scoreGood: string;
    scoreFair: string;
    scoreWeak: string;
    stageAwareness: string;
    stageConsideration: string;
    stageConversion: string;
    potentialLabel: string;
    segmentsUnit: string;
    budgetUnit: string;
    mapAudienceTitle: string;
    mapPositioningTitle: string;
    mapOfferTitle: string;
    assistantApplying: string;
    drawerTriggers: string;
    drawerObjections: string;
    drawerConfidence: string;
    drawerRationale: string;
    drawerForecast: string;
    forecastInsufficientData: string;
    forecastClicks: string;
    drawerValueProp: string;
    drawerReasonsToBelieve: string;
    drawerAngle: string;
    loadingAnalyzeProduct: string;
    loadingDefineAudience: string;
    loadingAnalyzeCompetitors: string;
    loadingPositioning: string;
    loadingChannels: string;
    loadingContentPlan: string;
    optionalHide: string;
    optionalShow: string;
    websiteLabel: string;
    competitorsLabel: string;
    knownAudienceLabel: string;
    scoreMetricFunnel: string;
    scoreMetricMeasurement: string;
    journeyDiscover: string;
    journeyInterest: string;
    journeyResearch: string;
    journeyTry: string;
    journeyBuy: string;
    journeyReturn: string;
    manualBudgetEditRationale: string;
    manualPositioningRationale: string;
    generateAlternativesBtn: string;
    setPrimaryBtn: string;
    manualOfferRationale: string;
    generatingOffers: string;
    normalizeBtn: string;
    fixBtn: string;
    dismissBtn: string;
    noActiveRisks: string;
    noActiveOpportunities: string;
    kpiCardTitle: string;
    journeyCardTitle: string;
    scenarioCompareBtn: string;
    sidebarNavGroupLabel: string;
    sidebarToolsGroupLabel: string;
    scenariosNavLabel: string;
    sidebarCollapseTooltip: string;
    sidebarExpandTooltip: string;
    planTypeGenerate: string;
    planTypeScore: string;
    planTypeCompare: string;
    planTypeManual: string;
    planTypeReview: string;
    planDoneBtn: string;
    planMarkDoneBtn: string;
    scenarioMain: string;
    scenarioAggressive: string;
    scenarioLean: string;
    scenarioCompareTitle: string;
    scenarioBudget: string;
    scenarioGrowth: string;
    scenarioCac: string;
    scenarioRisk: string;
    riskLow: string;
    riskMedium: string;
    riskHigh: string;
    scenarioDisclaimer: string;
    // v4 — Business Understanding confirmation (spec §6/§29)
    businessConfirmEyebrow: string;
    businessConfirmProductLabel: string;
    businessConfirmValueLabel: string;
    businessConfirmTodayLabel: string;
    businessConfirmRiskLabel: string;
    businessConfirmAllCorrectBtn: string;
    businessConfirmFixBtn: string;
    // v4 — pipeline loading stages (spec §58)
    loadingUnderstandBusiness: string;
    loadingSegments: string;
    loadingJtbd: string;
    loadingOffers: string;
    loadingCreative: string;
    loadingPlan: string;
    // v4 — Evidence & Confidence (spec §8-9/§55)
    confidenceHigh: string;
    confidenceMedium: string;
    confidenceLow: string;
    evidenceTypeFact: string;
    evidenceTypeResearch: string;
    evidenceTypeHypothesis: string;
    evidenceTypeUnknown: string;
    whyBtn: string;
    evidenceDrawerTitle: string;
    evidenceDrawerConfidenceLabel: string;
    evidenceDrawerMissingDataLabel: string;
    evidenceDrawerHowToVerifyLabel: string;
    evidenceDrawerEmpty: string;
    // v4 — Readiness (spec §36, replaces the raw score pill)
    readinessReadyTitle: string;
    readinessNeedsTitle: string;
    readinessNextStepLabel: string;
    // v4 — main tabs (spec §53)
    tabPlanV4: string;
    tabAnalysisV4: string;
    tabExperimentsV4: string;
    tabResultsV4: string;
    // v4 — "Ваш план" simple mode (spec §27-34)
    planBusinessTitle: string;
    planAudienceTitle: string;
    planMessageTitle: string;
    planOfferTitle: string;
    planChannelsTitle: string;
    planCreativeTitle: string;
    planActionTitle: string;
    planNextStepTitle: string;
    planWhyStrategyLink: string;
    planProfessionalLink: string;
    planNoDataYet: string;
    // v4 — Анализ (professional mode)
    analysisSegmentsTitle: string;
    analysisJtbdTitle: string;
    analysisPositioningTitle: string;
    analysisOffersTitle: string;
    analysisChannelsTitle: string;
    analysisCreativeTitle: string;
    analysisFunnelTitle: string;
    analysisEconomicsTitle: string;
    analysisHistoryTitle: string;
    // v4 — Эксперименты
    experimentsTitle: string;
    experimentsEmpty: string;
    experimentDesignBtn: string;
    experimentEnterResultBtn: string;
    experimentControlLabel: string;
    experimentVariantLabel: string;
    experimentConversionsLabel: string;
    experimentVolumeLabel: string;
    experimentSubmitResultBtn: string;
    experimentStatusPlanned: string;
    experimentStatusRunning: string;
    experimentStatusCompleted: string;
    experimentStatusStopped: string;
    experimentDecisionWinner: string;
    experimentDecisionLoser: string;
    experimentDecisionInconclusive: string;
    // v4 — Результаты
    resultsLearningsTitle: string;
    resultsProposalsTitle: string;
    resultsEmpty: string;
    proposalApplyBtn: string;
    proposalRejectBtn: string;
    proposalAppliedLabel: string;
    proposalRejectedLabel: string;
    proposalWhyLabel: string;
  };
  tools: {
    menuLabel: string;
    bgRemoverLabel: string;
    upscalerLabel: string;
    photoEditorLabel: string;
    bgRemoverTitle: string;
    upscalerTitle: string;
    photoEditorTitle: string;
    addImageTooltip: string;
    removeImageTooltip: string;
    noImageError: string;
    removeBgBtn: string;
    removingBgBtn: string;
    scaleLabel: string;
    upscaleBtn: string;
    upscalingBtn: string;
    downloadBtn: string;
    rotateLeftTooltip: string;
    rotateRightTooltip: string;
    flipHTooltip: string;
    flipVTooltip: string;
    brightnessLabel: string;
    contrastLabel: string;
    cropLabel: string;
    cropOriginal: string;
    cropSquare: string;
    resetBtn: string;
  };
  musicAudio: {
    title: string;
    subtitle: string;
    modeToggleMusic: string;
    modeToggleSpeech: string;
    musicPromptLabel: string;
    musicPromptPlaceholder: string;
    lyricsLabel: string;
    lyricsPlaceholder: string;
    genreLabel: string;
    formatLabel: string;
    phraseLabel: string;
    phrasePlaceholder: string;
    speechPromptLabel: string;
    speechPromptPlaceholder: string;
    voiceLabel: string;
    previewTooltip: string;
    languageLabel: string;
    generateBtn: string;
    generatingBtn: string;
    noPromptError: string;
    noPhraseError: string;
    loadingMessagesMusic: string[];
    loadingMessagesSpeech: string[];
    downloadTooltip: string;
  };
  assets: {
    title: string;
    buttonLabel: string;
    filterAll: string;
    filterPhoto: string;
    filterVideo: string;
    loadingHint: string;
    emptyHint: string;
    notConnectedHint: string;
    loadError: string;
    downloadTooltip: string;
    tileLoadError: string;
  };
  yandexDisk: {
    title: string;
    description: string;
    connectBtn: string;
    connectedLabel: string;
    disconnectBtn: string;
    codePlaceholder: string;
    submitBtn: string;
    submittingBtn: string;
    noCodeError: string;
  };
  reloadGuard: {
    title: string;
    reloadBtn: string;
    saveBtn: string;
    savingBtn: string;
    savedHint: string;
    notConnectedError: string;
    saveError: string;
  };
  textWork: {
    newDialog: string;
    dialogName: (n: number) => string;
    emptyDialogPreview: string;
    deleteDialogTooltip: string;
    emptyHint: string;
    inputPlaceholder: string;
    copyTooltip: string;
    copiedLabel: string;
    downloadDoc: string;
    downloadPres: string;
    preparingFile: string;
    fileError: string;
  };
  common: {
    close: string;
  };
  contextMenu: {
    addNode: string;
  };
  errorBoundary: {
    title: string;
    text: string;
    reload: string;
  };
  webAuth: {
    passwordLabel: string;
    loginBtn: string;
    checkingBtn: string;
    invalidCredentials: string;
    connectionError: string;
    loginTitle: string;
    registerTitle: string;
    registerToggleBtn: string;
    backToLoginBtn: string;
    repeatPasswordLabel: string;
    registerSubmitBtn: string;
    registeringBtn: string;
    fillAllFieldsError: string;
    passwordMismatchError: string;
    passwordTooShortError: string;
    registerSuccessToast: string;
    registerNeedsConfirmationToast: string;
    registerFailedError: string;
    demoModeLink: string;
    orDivider: string;
    googleBtn: string;
    emailLabel: string;
    loginSubtitle: string;
    registerSubtitle: string;
    keepSignedIn: string;
    resetPasswordLink: string;
    resetPasswordSentToast: string;
    resetPasswordError: string;
    resetPasswordNeedsEmailError: string;
    switchToRegisterText: string;
    switchToLoginText: string;
  };
  paymentModal: {
    topBarBtn: string;
    heading: string;
    subheading: string;
    balanceLabel: string;
    periodMonth: string;
    periodYear: string;
    tierFreeTitle: string;
    tierPopularTitle: string;
    tierMaxTitle: string;
    freeLabel: string;
    currentPlanBtn: string;
    selectBtn: string;
    recheckLink: string;
    checkingBtn: string;
    paymentNotFound: string;
    paymentInDevelopment: string;
    benefitOneflowAccess: string;
    benefitBudgetChoice: string;
    benefit30Models: string;
    benefitAiAssistant: string;
    benefitLlmModels: string;
    benefitVisualAdaptation: string;
    benefitOneLaunchAccess: string;
    benefitEvaluationAccess: string;
    benefitPrioritySupport: string;
  };
  legal: {
    privacyLink: string;
    termsLink: string;
    refundLink: string;
    helpLink: string;
  };
  // Rich icon+title+description dropdown content for the in-app top toolbar's
  // Файл/Шаблоны/Инструменты/О программе menus (ToolbarRichMenu.tsx).
  toolbarMenu: {
    saveProjectDesc: string;
    openProjectDesc: string;
    saveWorkspaceDesc: string;
    openWorkspaceDesc: string;
    templatesForBusinessGroup: string;
    templatesMarketplacesGroup: string;
    forBusinessDesc: string;
    marketplacesDesc: string;
    horecaDesc: string;
    autoDesc: string;
    apartmentDesc: string;
    furnitureDesc: string;
    electronicsDesc: string;
    bgRemoverDesc: string;
    upscalerDesc: string;
    photoEditorDesc: string;
    aboutMenuLabel: string;
    privacyDesc: string;
    termsDesc: string;
    refundDesc: string;
    helpDesc: string;
    subscriptionMenuLabel: string;
    subscriptionMenuDesc: string;
    settingsMenuDesc: string;
  };
  startScreen: {
    greeting: string;
    closeTooltip: string;
    emptyDoc: string;
    emptyDocHint: string;
    photoGen: string;
    photoGenHint: string;
    photoAdapt: string;
    photoAdaptHint: string;
    videoGen: string;
    videoGenHint: string;
    autoCreateLabel: string;
    autoCreatePlaceholder: string;
    autoCreateError: string;
    quickStartNav: string;
    businessNav: string;
    businessHoreca: string;
    businessHorecaHint: string;
    businessAuto: string;
    businessAutoHint: string;
    businessApartment: string;
    businessApartmentHint: string;
    businessFurniture: string;
    businessFurnitureHint: string;
    businessElectronics: string;
    businessElectronicsHint: string;
  };
  quickGen: {
    promptPlaceholder: string;
    photoTab: string;
    videoTab: string;
    attachStartEnd: string;
    attachRefImages: string;
    attachVideoRef: string;
    startFrameLabel: string;
    endFrameLabel: string;
    regenerate: string;
    download: string;
    durationSeconds: (n: number) => string;
    promptLabel: string;
  };
  errors: {
    imageLoadFailed: string;
    canvasUnavailable: string;
    apiKeyMissing: string;
    modelOverloaded: string;
    contentFlagged: string;
    notLoggedIn: string;
    generationError: string;
    sendFailed: string;
    userNotFound: string;
  };
  nodes: {
    common: {
      promptNoConnection: string;
      promptConnected: (text: string) => string;
      promptEmpty: string;
      model: string;
      aspectRatio: string;
      resolution: string;
      generate: string;
      generating: string;
      save: string;
      remove: string;
      emptyPromptError: string;
      promptPlaceholder: string;
      photoHandleTitle: string;
      connected: string;
      awaitingGeneration: string;
      notConnected: string;
    };
    prompt: {
      header: string;
      placeholder: string;
    };
    imageInput: {
      header: string;
      loadFromDisk: string;
      loading: string;
      orUrlLabel: string;
      attachHint: string;
    };
    imageGen: {
      header: string;
      variantCount: string;
      referencePhotos: (count: number, total: number) => string;
      photoLabel: (n: number) => string;
      saveFormat: string;
      generatingProgress: (done: number, total: number) => string;
    };
    videoGen: {
      header: string;
      promptHandleTitle: string;
      imageStatus: (status: string) => string;
      aspectDeterminedByImage: string;
      duration: (dur: number, min: number, max: number) => string;
      needPromptOrImageError: string;
    };
    videoGenPro: {
      header: string;
      modelLabel: string;
      promptPlaceholder: string;
      refImages: string;
      refVideos: string;
      refAudios: string;
      addRefTooltip: (label: string) => string;
      copyTagTooltip: string;
      insertTagTooltip: string;
    };
    vector: {
      header: string;
      saveSvg: string;
    };
    adapt: {
      header: string;
      urlLabelNoConn: string;
      urlPlaceholder: string;
      source: (status: string) => string;
      formats: string;
      removeFormatTooltip: string;
      addFormat: string;
      newFormatDefaultLabel: string;
      note: string;
      notePlaceholder: string;
      saveFormat: string;
      psdHint: string;
      perFormatHint: string;
      saveAll: string;
      savingAll: string;
      formatCaption: (label: string, w: number, h: number) => string;
      preparingPsd: string;
      regenerateTooltip: string;
      noInputImageError: string;
      addAtLeastOneFormatError: string;
      psdLayerBg: string;
      psdLayerElements: string;
    };
    modelMeta: {
      nanoBanana2Editing: string;
      qualityAuto: string;
      qualityLow: string;
      qualityMedium: string;
      qualityHigh: string;
      psdSaveFormat: string;
      yandexNetwork: string;
    };
  };
}

export const ru: Translations = {
  toolbar: {
    file: 'Файл',
    saveProject: 'Сохранить проект',
    saveProjectSuccess: 'Проект сохранён на Яндекс Диск',
    saveProjectError: 'Не удалось сохранить проект.',
    openProject: 'Открыть проект',
    saveWorkspace: 'Сохранить рабочую область',
    openWorkspace: 'Открыть рабочую область',
    dspTooltip: 'Открыть DSP',
    sendMessageTooltip: 'Отправить сообщение пользователю',
    settingsTooltip: 'Настройки / API-ключ',
    aboutTooltip: 'О программе',
    profileTooltip: 'Личный кабинет',
    newProjectTooltip: 'Новый проект',
    closeProjectTooltip: 'Закрыть проект',
    projectName: (n) => `Проект ${n}`,
    importedProjectName: 'Импортированный проект',
    templates: 'Шаблоны',
    templatesBusinessSection: 'Для бизнеса',
    templatesMarketplacesSection: 'Маркетплейсы',
  },
  modeSwitch: {
    nodesAndAdapt: 'Ноды и адаптация',
    quickGeneration: 'Генерация',
    textWork: 'Работа с текстом',
    evaluation: 'Оценка',
    oneLaunch: 'One Launch',
    musicAudio: 'Музыка и аудио',
    strategy: 'Стратегия',
  },
  nodeLabels: {
    prompt: 'Текстовый промпт',
    image: 'Изображение',
    imageGen: 'Генерация фото',
    vector: 'Вектор',
    videoGen: 'Генерация видео',
    videoGenPro: 'Генерация видео PRO',
    adapt: 'Адаптация',
    aiAssistantTooltip: 'ИИ ассистент',
    flokoName: 'Floko',
    flokoStatus: 'Ваш помощник',
    flokoChatLabel: 'Чат',
  },
  archive: {
    title: (count) => `Архив проекта (${count})`,
    openFolder: 'Открыть папку',
    empty:
      'Здесь будут появляться все сгенерированные фото, видео и адаптации — они автоматически сохраняются на диск.',
  },
  budget: {
    tooltip: (spent, limit) => `Потрачено в этом месяце (оценка): ${spent} из ${limit}`,
  },
  settingsModal: {
    title: 'Настройки',
    account: 'Аккаунт',
    logout: 'Выйти',
    apiToken: 'Replicate API Token',
    apiTokenHint:
      'Токен хранится только локально на этом компьютере и используется для запросов к Replicate API. Получить токен можно на странице replicate.com/account/api-tokens.',
    budgetLimit: 'Лимит бюджета в месяц, $',
    budgetHint:
      'Replicate не даёт API для реального расхода бюджета в долларах на конкретный запрос, поэтому прогресс-бар вверху программы считает примерную стоимость по опубликованным ценам Replicate на каждую модель (фото, видео, вектор, адаптация) за текущий месяц относительно этого лимита. Точная сумма может немного отличаться от реального счёта Replicate.',
    close: 'Закрыть',
    save: 'Сохранить',
    saved: 'Сохранено',
  },
  aboutModal: {
    title: 'О программе',
    text: 'Программу с любовью сделал - арт директор Нургазинов Аян',
    close: 'Закрыть',
  },
  profileModal: {
    title: 'Личный кабинет',
    loading: 'Загрузка...',
    notLoggedIn: 'Не выполнен вход',
    paymentNotConfigured: 'Оплата не настроена',
    noSubscription: 'Нет подписки',
    untilDate: (date) => `до ${date}`,
    sessionGenerations: (count) => `Генераций за сессию: ${count}`,
    periodLabel: 'Генерации за период',
    totalLabel: (count, cost) => `Всего генераций: ${count} · Стоимость: ${cost}`,
    emptyPeriod: 'Генераций за этот период нет',
    exportBtn: 'Выгрузить CSV',
    exportPreparing: 'Готовим файл...',
    exportSaved: 'Сохранено',
    close: 'Закрыть',
    preferencesTitle: 'Язык и тема',
    languageLabel: 'Язык интерфейса',
    themeLabel: 'Тема',
    themeDark: 'Тёмная',
    themeLight: 'Светлая',
    statusLabels: {
      active: 'Активна',
      on_trial: 'Пробный период',
      paused: 'Приостановлена',
      past_due: 'Просрочен платёж',
      unpaid: 'Не оплачена',
      cancelled: 'Отменена',
      expired: 'Истекла',
    },
    categoryLabels: {
      image: 'Фото',
      video: 'Видео',
      adapt: 'Адаптация',
      vector: 'Вектор',
    },
    csvHeader: 'Дата,Время,Модель,Категория,Стоимость USD',
    exportError: 'Не удалось сохранить файл',
    locale: 'ru-RU',
    legalSectionTitle: 'Документы',
  },
  adminModal: {
    title: 'Админ-панель',
    hint: 'Сообщение всплывёт снизу экрана у пользователя, пока он работает в программе.',
    emailLabel: 'Email пользователя',
    messageLabel: 'Сообщение',
    messagePlaceholder: 'Текст сообщения...',
    close: 'Закрыть',
    send: 'Отправить',
    sending: 'Отправка...',
    sent: (count) => `Отправлено ${count === 1 ? 'получателю' : 'получателям'} (${count}) ✓`,
    genericError: 'Не удалось отправить сообщение.',
    onlineTitle: 'Сейчас в сети',
    onlineLoading: 'Загрузка...',
    onlineEmpty: 'Сейчас никто не в сети.',
    lastSeenJustNow: 'только что',
    lastSeenMinutesAgo: (n) => `${n} мин назад`,
    tabMessages: 'Сообщения',
    tabStats: 'Статистика',
    broadcastLabel: 'Отправить всем пользователям',
    recipientsLabel: 'Получатели',
    addEmailPlaceholder: 'Добавить email и нажать Enter',
    noRecipientsError: 'Выберите получателей или включите рассылку всем.',
    statsHint: 'Генерации пользователей с почтой @mechta.kz',
    statsLoading: 'Загрузка...',
    statsEmpty: 'Пока нет ни одной генерации от пользователей @mechta.kz.',
    statsError: 'Не удалось загрузить статистику.',
    statsSummaryTitle: 'По пользователям',
    statsLogTitle: 'Все генерации',
    statsColumnEmail: 'Email',
    statsColumnModel: 'Модель',
    statsColumnCategory: 'Тип',
    statsColumnCost: 'Стоимость',
    statsColumnWhen: 'Когда',
    statsGenerationsCount: (n) => `${n} ${n === 1 ? 'генерация' : n < 5 ? 'генерации' : 'генераций'}`,
  },
  aiAssistant: {
    title: 'Floko',
    copyAllTooltip: 'Скопировать всю переписку',
    copiedLabel: 'Скопировано',
    closeTooltip: 'Закрыть',
    emptyHint: 'Задайте вопрос — например, помощь с промптом или идеей. Можно перетащить сюда фото или документ.',
    copyTooltip: 'Скопировать',
    removeTooltip: 'Удалить',
    inputPlaceholder: 'Сообщение...',
    dropHint: 'Отпустите, чтобы прикрепить файл',
    addedNodes: (count) => `\n\n✅ Добавил на холст ${count} нод.`,
    failedNodes: '\n\n⚠️ Не удалось построить ноды из этого ответа.',
    documentLabel: (name) => `[Документ: ${name}]`,
    imageAttachedLabel: (name) => `[Прикреплено фото: ${name}]`,
    transcriptUser: 'Вы',
    transcriptAssistant: 'Ассистент',
  },
  evaluation: {
    title: 'Оценка креатива',
    subtitle: 'Загрузите 1-3 варианта картинки и получите оценку визуальной силы каждого.',
    uploadSectionLabel: 'Варианты креатива',
    platformLabel: 'Площадка',
    platformAny: 'Любая',
    addImageTooltip: 'Добавить вариант',
    removeImageTooltip: 'Убрать',
    maxImagesHint: 'Максимум 3 варианта',
    evaluateBtn: 'Оценить',
    evaluatingBtn: 'Оцениваю...',
    noImagesError: 'Загрузите хотя бы одну картинку.',
    strengthsLabel: 'Сильные стороны',
    weaknessesLabel: 'Что улучшить',
    verdictLabel: 'Вывод',
    winnerBadge: 'Сильнее остальных',
    scoreOutOf: '/10',
    noteTitle: 'Как это работает',
    noteHowLabel: 'Что оценивается',
    noteHowItems: [
      'контраст объекта и фона',
      'куда сразу падает взгляд',
      'читаемость текста в уменьшенном виде',
      'заметность кнопки/CTA',
      'эмоциональный крючок',
      'визуальный шум',
    ],
    noteAccuracyLabel: 'Точность',
    noteAccuracy:
      'Оценка отражает экспертную визуальную методологию, а не статистическое измерение CTR — ' +
      'для расчёта точного процента кликабельности нужны реальные данные показов и переходов по ' +
      'конкретной площадке. Шкала 1-10 — профессиональное сравнительное заключение, которое ' +
      'помогает выявить более сильный вариант ещё до запуска кампании.',
    noteTipLabel: 'Совет',
    noteTip: 'Сравнение 2-3 вариантов между собой надёжнее, чем одна отдельная оценка.',
    loadingMessages: [
      'Оцениваю контраст...',
      'Проверяю читабельность...',
      'Ищу эмоциональный крючок...',
      'Смотрю на CTA...',
      'Проверяю визуальный шум...',
    ],
  },
  oneLaunch: {
    title: 'ONE LAUNCH',
    subtitle: 'Фото товара → готовая рекламная кампания: карточки под форматы и тексты постов.',
    step1Title: 'Шаг 1. Фото товара',
    step2Title: 'Шаг 2. Название и преимущества',
    step3Title: 'Шаг 3. Стиль макета',
    step4Title: 'Шаг 4. Форматы',
    step5Title: 'Шаг 5. Цветовая гамма',
    photoLabel: 'Фото товара',
    addPhotoTooltip: 'Загрузить фото',
    removePhotoTooltip: 'Убрать',
    nameLabel: 'Название товара',
    namePlaceholder: 'Например: Беспроводные наушники X200',
    advantagesLabel: 'Преимущества',
    advantagesPlaceholder: 'По одному преимуществу на строку',
    improveBtn: 'Улучшить с ИИ',
    improvingBtn: 'Улучшаю...',
    formatsLabel: 'Форматы',
    formatSquare: 'Квадрат 1:1',
    formatStory: 'Сторис/пост 9:16',
    formatLandscape: 'Альбомный 3:2',
    paletteLabel: 'Цветовая гамма',
    recommendedBadge: 'Рекомендует ИИ',
    customPaletteLabel: 'Своя палитра',
    customPaletteHint: 'Выберите цвет — остальные тона подберём сами',
    launchBtn: 'Запустить',
    launchingBtn: 'Запускаю...',
    noPhotoError: 'Загрузите фото товара.',
    noNameError: 'Укажите название товара.',
    noFormatError: 'Выберите хотя бы один формат.',
    statusAnalyzingPhoto: 'Анализирую фото...',
    statusGenerating: (format) => `Генерирую: ${format}...`,
    statusEvaluating: 'Оцениваю результаты...',
    statusWritingCaptions: 'Пишу тексты для постов...',
    captionsTitle: 'Тексты для Instagram',
    downloadTooltip: 'Скачать',
    templateNoneLabel: 'Уникальный дизайн',
    templateUniqueHint: 'Система проанализирует товар и данные и создаст карточку с уникальным дизайном',
    templateFormatNote: 'Формат уже задан выбранным шаблоном.',
    templatePaletteNote: 'Цветовая гамма уже задана выбранным шаблоном.',
    templateResultLabel: 'Карточка по шаблону',
    discountPlaceholder: 'Скидка (например -20%), необязательно',
  },
  strategy: {
    title: 'Стратегия',
    headerSubtitle: 'Маркетинговая стратегия для ONEFLOW',
    months: 'мес.',
    tabOverview: 'Обзор',
    tabMap: 'Карта',
    tabPlan: 'План',
    newStrategyBtn: 'Новая стратегия',
    onboardGoalStep: 'Какой результат вы хотите получить?',
    onboardContextStep: 'Расскажите о продукте',
    onboardOf: 'из',
    onboardBack: 'Назад',
    onboardContinue: 'Продолжить',
    onboardCreate: 'Создать стратегию',
    onboardGenerating: 'Создаём стратегию...',
    marketLabel: 'Рынок',
    durationLabel: 'Срок, мес.',
    budgetLabel: 'Бюджет, ₸',
    descriptionLabel: 'Опишите продукт или бизнес',
    descriptionPlaceholder: 'Что вы продаёте, кому и в чём отличие от конкурентов',
    photoLabel: 'Фото товара (необязательно)',
    scoreTitle: 'Оценка стратегии',
    goalCardTitle: 'Цель',
    positioningCardTitle: 'Позиционирование',
    offerCardTitle: 'Оффер',
    audienceCardTitle: 'Аудитория',
    channelsCardTitle: 'Каналы',
    risksCardTitle: 'Риски',
    opportunitiesCardTitle: 'Возможности',
    contentMatrixTitle: 'Контент-матрица',
    funnelCardTitle: 'Воронка',
    segments: 'сегмента',
    openBtn: 'Открыть',
    createBtn: 'Создать',
    generateBtn: 'Создать',
    planThisWeek: 'На этой неделе',
    drawerPotential: 'Потенциал',
    drawerMainJob: 'Главная задача',
    drawerPainPoints: 'Боли',
    drawerOffer: 'Рекомендуемый оффер',
    drawerAllocation: 'Доля бюджета',
    createOfferBtn: 'Создать оффер',
    createModalTitle: 'Создать из стратегии',
    createModalFormat: 'Формат',
    createModalHint: 'ONEFLOW создаст workflow генерации на основе этого контекста и откроет его в холсте нод.',
    createModalBtn: 'Создать workflow',
    assistantTitle: 'ONEFLOW Assistant',
    assistantCollapse: 'Свернуть',
    assistantContext: 'Контекст стратегии',
    assistantInsightLabel: 'AI-инсайт',
    assistantApply: 'Применить',
    assistantApplied: 'Применено',
    assistantExplain: 'Объяснить',
    assistantExplaining: 'Объясняю...',
    assistantPlaceholder: 'Спросите о стратегии...',
    scoreMetricAudience: 'Аудитория',
    scoreMetricPositioning: 'Позиционирование',
    scoreMetricOffer: 'Оффер',
    scoreMetricChannels: 'Каналы',
    scoreMetricContent: 'Контент',
    scoreMetricRetention: 'Удержание',
    scoreExcellent: 'Отлично',
    scoreGood: 'Хорошо',
    scoreFair: 'Средне',
    scoreWeak: 'Слабо',
    stageAwareness: 'Осведомлённость',
    stageConsideration: 'Рассмотрение',
    stageConversion: 'Конверсия',
    potentialLabel: 'потенциал',
    segmentsUnit: 'сегмента',
    budgetUnit: 'бюджета',
    mapAudienceTitle: 'Аудитория',
    mapPositioningTitle: 'Позиционирование',
    mapOfferTitle: 'Оффер',
    assistantApplying: 'Применяю...',
    drawerTriggers: 'Триггеры покупки',
    drawerObjections: 'Возражения',
    drawerConfidence: 'Уверенность AI',
    drawerRationale: 'Обоснование',
    drawerForecast: 'Прогноз',
    forecastInsufficientData: 'Недостаточно данных',
    forecastClicks: 'кликов (оценка)',
    drawerValueProp: 'Ценностное предложение',
    drawerReasonsToBelieve: 'Почему стоит верить',
    drawerAngle: 'Угол подачи',
    loadingAnalyzeProduct: 'Анализ продукта',
    loadingDefineAudience: 'Определение аудитории',
    loadingAnalyzeCompetitors: 'Анализ конкурентов',
    loadingPositioning: 'Формирование позиционирования',
    loadingChannels: 'Выбор каналов',
    loadingContentPlan: 'Контент-план',
    optionalHide: 'Скрыть дополнительные поля',
    optionalShow: 'Дополнительно (необязательно)',
    websiteLabel: 'Сайт (необязательно)',
    competitorsLabel: 'Конкуренты (необязательно)',
    knownAudienceLabel: 'Известная аудитория (необязательно)',
    scoreMetricFunnel: 'Воронка',
    scoreMetricMeasurement: 'Измеримость',
    journeyDiscover: 'Узнаёт',
    journeyInterest: 'Интересуется',
    journeyResearch: 'Изучает',
    journeyTry: 'Пробует',
    journeyBuy: 'Покупает',
    journeyReturn: 'Возвращается',
    manualBudgetEditRationale: 'Ручная правка бюджета пользователем',
    manualPositioningRationale: 'Смена позиционирования пользователем',
    generateAlternativesBtn: 'Сгенерировать альтернативы',
    setPrimaryBtn: 'Сделать основным',
    manualOfferRationale: 'Смена основного оффера пользователем',
    generatingOffers: 'Генерируем альтернативы...',
    normalizeBtn: 'Нормализовать',
    fixBtn: 'Как исправить',
    dismissBtn: 'Скрыть',
    noActiveRisks: 'Активных рисков нет',
    noActiveOpportunities: 'Активных возможностей нет',
    kpiCardTitle: 'KPI',
    journeyCardTitle: 'Путь клиента',
    scenarioCompareBtn: 'Сравнить сценарии',
    sidebarNavGroupLabel: 'Навигация',
    sidebarToolsGroupLabel: 'Инструменты',
    scenariosNavLabel: 'Сценарии',
    sidebarCollapseTooltip: 'Свернуть меню',
    sidebarExpandTooltip: 'Развернуть меню',
    planTypeGenerate: 'Генерация',
    planTypeScore: 'Оценка',
    planTypeCompare: 'Сравнение',
    planTypeManual: 'Вручную',
    planTypeReview: 'Обзор',
    planDoneBtn: 'Готово',
    planMarkDoneBtn: 'Отметить готовым',
    scenarioMain: 'Основной',
    scenarioAggressive: 'Агрессивный рост',
    scenarioLean: 'Экономный',
    scenarioCompareTitle: 'Сравнение сценариев',
    scenarioBudget: 'Бюджет',
    scenarioGrowth: 'Рост',
    scenarioCac: 'CAC',
    scenarioRisk: 'Риск',
    riskLow: 'Низкий',
    riskMedium: 'Средний',
    riskHigh: 'Высокий',
    scenarioDisclaimer: 'Оценка на основе текущей воронки и бюджета, не гарантированный прогноз.',
    businessConfirmEyebrow: 'Вот как ONEFLOW понял ваш бизнес',
    businessConfirmProductLabel: 'Вы продаёте',
    businessConfirmValueLabel: 'Клиент получает',
    businessConfirmTodayLabel: 'Сегодня он решает задачу',
    businessConfirmRiskLabel: 'Главный риск покупки',
    businessConfirmAllCorrectBtn: 'Всё верно',
    businessConfirmFixBtn: 'Исправить',
    loadingUnderstandBusiness: 'Поняли продукт',
    loadingSegments: 'Определяем аудитории',
    loadingJtbd: 'Формируем задачи клиента',
    loadingOffers: 'Формируем офферы',
    loadingCreative: 'Готовим креативные гипотезы',
    loadingPlan: 'Готовим первый план тестов',
    confidenceHigh: 'Высокая уверенность',
    confidenceMedium: 'Средняя уверенность',
    confidenceLow: 'Низкая уверенность',
    evidenceTypeFact: 'Факт',
    evidenceTypeResearch: 'Исследование',
    evidenceTypeHypothesis: 'Гипотеза',
    evidenceTypeUnknown: 'Недостаточно данных',
    whyBtn: 'Почему так?',
    evidenceDrawerTitle: 'Основания вывода',
    evidenceDrawerConfidenceLabel: 'Уверенность',
    evidenceDrawerMissingDataLabel: 'Каких данных не хватает',
    evidenceDrawerHowToVerifyLabel: 'Как проверить',
    evidenceDrawerEmpty: 'Пока нет данных — это модельная гипотеза.',
    readinessReadyTitle: 'Готово к тесту',
    readinessNeedsTitle: 'Нужно подключить',
    readinessNextStepLabel: 'Следующий шаг',
    tabPlanV4: 'Ваш план',
    tabAnalysisV4: 'Анализ',
    tabExperimentsV4: 'Эксперименты',
    tabResultsV4: 'Результаты',
    planBusinessTitle: 'Ваш бизнес',
    planAudienceTitle: 'Кому продавать',
    planMessageTitle: 'Что говорить',
    planOfferTitle: 'Что предложить',
    planChannelsTitle: 'Где продвигаться',
    planCreativeTitle: 'Что создавать',
    planActionTitle: 'Что делать',
    planNextStepTitle: 'Главный следующий шаг',
    planWhyStrategyLink: 'Почему такая стратегия?',
    planProfessionalLink: 'Профессиональный анализ →',
    planNoDataYet: 'Пока нет данных для этого блока.',
    analysisSegmentsTitle: 'Сегментация',
    analysisJtbdTitle: 'Jobs To Be Done',
    analysisPositioningTitle: 'Позиционирование',
    analysisOffersTitle: 'Офферы',
    analysisChannelsTitle: 'Каналы',
    analysisCreativeTitle: 'Креативные гипотезы',
    analysisFunnelTitle: 'Воронка',
    analysisEconomicsTitle: 'Unit-экономика',
    analysisHistoryTitle: 'История изменений',
    experimentsTitle: 'Реестр экспериментов',
    experimentsEmpty: 'Пока нет запланированных экспериментов.',
    experimentDesignBtn: 'Спроектировать эксперимент',
    experimentEnterResultBtn: 'Внести результат',
    experimentControlLabel: 'Контроль',
    experimentVariantLabel: 'Вариант',
    experimentConversionsLabel: 'Конверсии',
    experimentVolumeLabel: 'Объём (N)',
    experimentSubmitResultBtn: 'Посчитать результат',
    experimentStatusPlanned: 'Запланирован',
    experimentStatusRunning: 'Идёт',
    experimentStatusCompleted: 'Завершён',
    experimentStatusStopped: 'Остановлен',
    experimentDecisionWinner: 'Победитель',
    experimentDecisionLoser: 'Проигравший',
    experimentDecisionInconclusive: 'Неубедительно',
    resultsLearningsTitle: 'Что мы узнали',
    resultsProposalsTitle: 'Предложения по изменению стратегии',
    resultsEmpty: 'Пока нет результатов — сначала завершите эксперимент.',
    proposalApplyBtn: 'Применить',
    proposalRejectBtn: 'Оставить как есть',
    proposalAppliedLabel: 'Применено',
    proposalRejectedLabel: 'Отклонено',
    proposalWhyLabel: 'Почему',
  },
  tools: {
    menuLabel: 'Инструменты',
    bgRemoverLabel: 'Удалить фон',
    upscalerLabel: 'Апскейлер',
    photoEditorLabel: 'Фоторедактор',
    bgRemoverTitle: 'Удаление фона',
    upscalerTitle: 'Апскейлер',
    photoEditorTitle: 'Фоторедактор',
    addImageTooltip: 'Загрузить фото',
    removeImageTooltip: 'Убрать',
    noImageError: 'Загрузите изображение.',
    removeBgBtn: 'Удалить фон',
    removingBgBtn: 'Удаляю фон...',
    scaleLabel: 'Масштаб',
    upscaleBtn: 'Увеличить',
    upscalingBtn: 'Увеличиваю...',
    downloadBtn: 'Скачать',
    rotateLeftTooltip: 'Повернуть влево',
    rotateRightTooltip: 'Повернуть вправо',
    flipHTooltip: 'Отразить по горизонтали',
    flipVTooltip: 'Отразить по вертикали',
    brightnessLabel: 'Яркость',
    contrastLabel: 'Контраст',
    cropLabel: 'Обрезка',
    cropOriginal: 'Оригинал',
    cropSquare: 'Квадрат',
    resetBtn: 'Сбросить',
  },
  musicAudio: {
    title: 'Музыка и аудио',
    subtitle: 'Сгенерируйте музыкальный трек по описанию и словам песни или озвучьте фразу голосом на выбор.',
    modeToggleMusic: 'Музыка',
    modeToggleSpeech: 'Речь',
    musicPromptLabel: 'Промпт (стиль, настроение)',
    musicPromptPlaceholder: 'Например: энергичный поп-рок с яркими гитарами',
    lyricsLabel: 'Слова песни',
    lyricsPlaceholder: 'Введите текст песни',
    genreLabel: 'Жанр',
    formatLabel: 'Формат аудио',
    phraseLabel: 'Фраза',
    phrasePlaceholder: 'Что озвучить',
    speechPromptLabel: 'Промпт (тон, манера)',
    speechPromptPlaceholder: 'Например: скажи бодро и уверенно',
    voiceLabel: 'Голос',
    previewTooltip: 'Прослушать голос',
    languageLabel: 'Язык',
    generateBtn: 'Сгенерировать',
    generatingBtn: 'Генерирую...',
    noPromptError: 'Введите промпт.',
    noPhraseError: 'Введите фразу.',
    loadingMessagesMusic: [
      'Настраиваю звучание...',
      'Свожу инструментал...',
      'Подбираю тембр...',
      'Финализирую трек...',
    ],
    loadingMessagesSpeech: [
      'Подбираю интонацию...',
      'Настраиваю голос...',
      'Синхронизирую произношение...',
      'Финализирую запись...',
    ],
    downloadTooltip: 'Скачать',
  },
  assets: {
    title: 'Ассеты',
    buttonLabel: 'Ассеты',
    filterAll: 'Все',
    filterPhoto: 'Фото',
    filterVideo: 'Видео',
    loadingHint: 'Загружаю материалы...',
    emptyHint: 'Пока пусто — здесь появятся фото и видео, сохранённые на Яндекс Диск.',
    notConnectedHint: 'Подключите Яндекс Диск в настройках, чтобы видеть свои материалы здесь.',
    loadError: 'Не удалось загрузить материалы.',
    downloadTooltip: 'Скачать',
    tileLoadError: 'Не удалось загрузить',
  },
  yandexDisk: {
    title: 'Яндекс Диск',
    description: 'Подключите свой Яндекс Диск — каждая генерация будет автоматически сохраняться туда, в папку ONEFLOW.',
    connectBtn: 'Подключить',
    connectedLabel: 'Подключено',
    disconnectBtn: 'Отключить',
    codePlaceholder: 'Вставьте код из окна авторизации',
    submitBtn: 'Подтвердить',
    submittingBtn: 'Подключаю...',
    noCodeError: 'Вставьте код.',
  },
  reloadGuard: {
    title: 'При перезагрузке пропадёт проект. Сохранить его?',
    reloadBtn: 'Перезагрузить',
    saveBtn: 'Сохранить',
    savingBtn: 'Сохраняю...',
    savedHint: 'Проект сохранён на Яндекс Диск',
    notConnectedError: 'Яндекс Диск не подключён — подключите его в Личном кабинете.',
    saveError: 'Не удалось сохранить проект.',
  },
  textWork: {
    newDialog: 'Новый диалог',
    dialogName: (n) => `Диалог ${n}`,
    emptyDialogPreview: 'Пустой диалог',
    deleteDialogTooltip: 'Удалить диалог',
    emptyHint:
      'Задайте вопрос — помощь с текстом для рекламы: заголовки, описания, редактура, перевод, идеи для кампаний. Можно также попросить подготовить документ или презентацию — например «сделай бриф для клиента» или «собери презентацию по кампании» — файл .docx/.pptx можно будет сразу скачать.',
    inputPlaceholder: 'Сообщение...',
    copyTooltip: 'Скопировать',
    copiedLabel: 'Скопировано',
    downloadDoc: 'Скачать документ (.docx)',
    downloadPres: 'Скачать презентацию (.pptx)',
    preparingFile: 'Готовим файл...',
    fileError: 'Не удалось создать файл.',
  },
  common: {
    close: 'Закрыть',
  },
  contextMenu: {
    addNode: 'Добавить узел',
  },
  errorBoundary: {
    title: 'Что-то пошло не так',
    text: 'Произошла непредвиденная ошибка интерфейса. Можно попробовать перезагрузить окно — несохранённая генерация в текущем узле может быть потеряна.',
    reload: 'Перезагрузить',
  },
  webAuth: {
    passwordLabel: 'Пароль',
    loginBtn: 'Войти',
    checkingBtn: 'Проверка...',
    invalidCredentials: 'Неверный логин или пароль.',
    connectionError: 'Не удалось связаться с сервером авторизации.',
    loginTitle: 'Вход',
    registerTitle: 'Регистрация в ONEFLOW',
    registerToggleBtn: 'Регистрация',
    backToLoginBtn: 'Назад ко входу',
    repeatPasswordLabel: 'Повтор пароля',
    registerSubmitBtn: 'Зарегистрироваться',
    registeringBtn: 'Регистрация...',
    fillAllFieldsError: 'Заполните все поля.',
    passwordMismatchError: 'Пароли не совпадают.',
    passwordTooShortError: 'Пароль должен быть не короче 6 символов.',
    registerSuccessToast: 'Регистрация прошла успешно, можете войти под своим паролем.',
    registerNeedsConfirmationToast:
      'Регистрация почти завершена — подтвердите email по ссылке из письма, затем сможете войти.',
    registerFailedError: 'Не удалось зарегистрироваться',
    demoModeLink: 'Демо режим',
    orDivider: 'или',
    googleBtn: 'Войти через Google',
    emailLabel: 'Email',
    loginSubtitle: 'Войдите в аккаунт и продолжите работу',
    registerSubtitle: 'Создайте аккаунт, чтобы начать работу в ONEFLOW',
    keepSignedIn: 'Не выходить из аккаунта',
    resetPasswordLink: 'Забыли пароль?',
    resetPasswordSentToast: 'Письмо для сброса пароля отправлено на почту.',
    resetPasswordError: 'Не удалось отправить письмо для сброса пароля.',
    resetPasswordNeedsEmailError: 'Сначала введите email.',
    switchToRegisterText: 'Новый пользователь ONEFLOW?',
    switchToLoginText: 'Уже есть аккаунт?',
  },
  paymentModal: {
    topBarBtn: 'Тариф',
    heading: 'Виды тарифов',
    subheading: 'Остаток бюджета не сгорает в следующем месяце',
    balanceLabel: 'Ваш баланс:',
    periodMonth: 'В месяц',
    periodYear: 'В год',
    tierFreeTitle: 'Бесплатный тариф',
    tierPopularTitle: 'Популярный тариф',
    tierMaxTitle: 'Максимальный тариф',
    freeLabel: 'Бесплатно',
    currentPlanBtn: 'Текущий тариф',
    selectBtn: 'Оформить',
    recheckLink: 'Уже оплатили? Проверить',
    checkingBtn: 'Проверка...',
    paymentNotFound: 'Оплата пока не найдена, попробуйте ещё раз через минуту.',
    paymentInDevelopment: 'Процесс оплаты в разработке',
    benefitOneflowAccess: 'Доступ к ONEFLOW',
    benefitBudgetChoice: 'Выбор бюджета по желанию',
    benefit30Models: '30+ самых актуальных нейросетей',
    benefitAiAssistant: 'ИИ-ассистент',
    benefitLlmModels: 'LLM модели',
    benefitVisualAdaptation: 'Адаптация вижуалов',
    benefitOneLaunchAccess: 'Доступ к One Launch',
    benefitEvaluationAccess: 'Доступ к инструменту оценка',
    benefitPrioritySupport: 'Приоритетная поддержка',
  },
  legal: {
    privacyLink: 'Политика конфиденциальности',
    termsLink: 'Условия использования',
    refundLink: 'Политика возврата',
    helpLink: 'Справка',
  },
  toolbarMenu: {
    saveProjectDesc: 'Сохранить текущий холст в файл проекта',
    openProjectDesc: 'Загрузить ранее сохранённый проект',
    saveWorkspaceDesc: 'Сохранить все проекты и вкладки разом',
    openWorkspaceDesc: 'Загрузить ранее сохранённую рабочую область',
    templatesForBusinessGroup: 'Для бизнеса',
    templatesMarketplacesGroup: 'Маркетплейсы',
    forBusinessDesc: 'Готовые сценарии под нишу вашего бизнеса',
    marketplacesDesc: 'Шаблоны карточек под маркетплейсы',
    horecaDesc: 'Фото блюд и интерьера для ресторанов и кафе',
    autoDesc: 'Профессиональные фото автомобилей из одного снимка',
    apartmentDesc: 'Каталожные фото квартир и интерьеров',
    furnitureDesc: 'Студийные фото мебели для каталога',
    electronicsDesc: 'Премиальные фото техники и электроники',
    bgRemoverDesc: 'Убрать фон с фото за один клик',
    upscalerDesc: 'Повысить разрешение изображения без потери качества',
    photoEditorDesc: 'Быстрое редактирование фото прямо в браузере',
    aboutMenuLabel: 'О программе',
    privacyDesc: 'Как ONEFLOW собирает и использует ваши данные',
    termsDesc: 'Правила использования сервиса',
    refundDesc: 'Условия возврата средств',
    helpDesc: 'Как начать работу и куда обратиться за поддержкой',
    subscriptionMenuLabel: 'Моя подписка',
    subscriptionMenuDesc: 'Статус вашей подписки',
    settingsMenuDesc: 'Язык, статистика, Яндекс.Диск',
  },
  startScreen: {
    greeting: 'Начнем генерить?',
    closeTooltip: 'Закрыть',
    emptyDoc: 'Пустой документ',
    emptyDocHint: 'Начать с чистого холста',
    photoGen: 'Генерация фото',
    photoGenHint: 'Промпт → готовое изображение',
    photoAdapt: 'Адаптация фото',
    photoAdaptHint: 'Подогнать фото под нужный формат',
    videoGen: 'Генерация видео',
    videoGenHint: 'Промпт → готовое видео',
    autoCreateLabel: 'Авто создание нод с ИИ ассистентом',
    autoCreatePlaceholder:
      'Опишите, что нужно сделать — ИИ ассистент сам создаст и соединит подходящие ноды на холсте',
    autoCreateError: 'Не удалось создать ноды. Попробуйте ещё раз.',
    quickStartNav: 'Быстрый старт',
    businessNav: 'Для бизнеса',
    businessHoreca: 'HoReCa',
    businessHorecaHint: 'Фото блюд на белом фоне',
    businessAuto: 'Авто',
    businessAutoHint: 'Профессиональное авто-фото',
    businessApartment: 'Квартира',
    businessApartmentHint: 'Интерьер в стиле журнала',
    businessFurniture: 'Мебель',
    businessFurnitureHint: 'Товар на белом фоне',
    businessElectronics: 'Техника и электроника',
    businessElectronicsHint: 'Товар в стиле каталога',
  },
  quickGen: {
    promptPlaceholder: 'Опишите, что нужно сгенерировать...',
    photoTab: 'Фото',
    videoTab: 'Видео',
    attachStartEnd: 'Начальный & Конечный кадр',
    attachRefImages: 'Референс изображения',
    attachVideoRef: 'Видео референс',
    startFrameLabel: 'Начальный кадр',
    endFrameLabel: 'Конечный кадр',
    regenerate: 'Перегенерировать',
    download: 'Скачать',
    durationSeconds: (n) => `${n} сек`,
    promptLabel: 'Промпт',
  },
  errors: {
    imageLoadFailed: 'Не удалось загрузить изображение',
    canvasUnavailable: 'Canvas 2D недоступен',
    apiKeyMissing: 'Не задан API-ключ Replicate. Откройте «Настройки / API-ключ» и вставьте токен.',
    modelOverloaded:
      'Модель сейчас перегружена — Replicate временно не справляется с наплывом запросов ' +
      '(особенно часто у Nano Banana Pro/2). Программа уже пробовала повторить запрос ' +
      'автоматически — попробуйте нажать «Сгенерировать» ещё раз через минуту-две, или ' +
      'выберите другую модель.',
    contentFlagged:
      'Модель отказалась выполнять запрос: система безопасности Replicate посчитала входное ' +
      'фото или текст промпта потенциально чувствительным содержимым. Это ограничение самой ' +
      'нейросети, а не ошибка программы — попробуйте другое фото или переформулируйте промпт.',
    notLoggedIn: 'Не выполнен вход.',
    generationError: 'Ошибка генерации.',
    sendFailed: 'Не удалось отправить.',
    userNotFound: 'Пользователь с таким email не найден.',
  },
  nodes: {
    common: {
      promptNoConnection: 'Промпт (нет подключения)',
      promptConnected: (text) => `Промпт: ${text}`,
      promptEmpty: '(пусто)',
      model: 'Модель',
      aspectRatio: 'Соотношение сторон',
      resolution: 'Разрешение',
      generate: 'Сгенерировать',
      generating: 'Генерация...',
      save: 'Сохранить',
      remove: 'Удалить',
      emptyPromptError: 'Пустой промпт',
      promptPlaceholder: 'Введите промпт вручную или подключите узел «Текстовый промпт»',
      photoHandleTitle: 'Фото',
      connected: 'подключено',
      awaitingGeneration: 'ожидание генерации',
      notConnected: 'не подключено',
    },
    prompt: {
      header: 'Текстовый промпт',
      placeholder: 'Опишите, что нужно сгенерировать...',
    },
    imageInput: {
      header: 'Изображение',
      loadFromDisk: 'Загрузить с диска',
      loading: 'Загрузка...',
      orUrlLabel: 'Или URL изображения',
      attachHint: 'Вложите своё изображение',
    },
    imageGen: {
      header: 'Генерация фото',
      variantCount: 'Количество вариантов',
      referencePhotos: (count, total) => `Референс-фото (${count}/${total})`,
      photoLabel: (n) => `фото ${n}`,
      saveFormat: 'Формат при сохранении',
      generatingProgress: (done, total) => `Генерация ${done}/${total}...`,
    },
    videoGen: {
      header: 'Генерация видео',
      promptHandleTitle: 'Промпт',
      imageStatus: (status) => `Изображение: ${status}`,
      aspectDeterminedByImage: 'Определяется входным изображением',
      duration: (dur, min, max) => `Длительность: ${dur} сек (${min}–${max})`,
      needPromptOrImageError: 'Нужен промпт или входное изображение',
    },
    videoGenPro: {
      header: 'Генерация видео PRO',
      modelLabel: 'Модель: Seedance 2.5 (ByteDance)',
      promptPlaceholder: 'Опишите видео. Вставляйте теги @Image1, @Video1, @Audio1 из референсов ниже',
      refImages: 'Референс-фото',
      refVideos: 'Референс-видео',
      refAudios: 'Референс-аудио',
      addRefTooltip: (label) => `Добавить ${label.toLowerCase()}`,
      copyTagTooltip: 'Скопировать тег (промпт подключён снаружи)',
      insertTagTooltip: 'Вставить тег в промпт',
    },
    vector: {
      header: 'Вектор',
      saveSvg: 'Сохранить SVG',
    },
    adapt: {
      header: 'Адаптация',
      urlLabelNoConn: 'URL изображения (нет подключения)',
      urlPlaceholder: 'https://... или подключите узел с фото',
      source: (status) => `Источник: ${status}`,
      formats: 'Форматы',
      removeFormatTooltip: 'Удалить формат',
      addFormat: 'Добавить формат',
      newFormatDefaultLabel: 'Новый формат',
      note: 'Примечание для адаптации (необязательно)',
      notePlaceholder: 'Например: сохрани логотип в левом верхнем углу, увеличь заголовок',
      saveFormat: 'Формат при сохранении',
      psdHint:
        'PSD: отдельным запросом строится чистый «Фон» (без текста, лого и элементов), а ' +
        'разница с итоговым изображением вырезается в прозрачный слой «Текст, лого и ' +
        'элементы» поверх него. Вырезание приблизительное (по разнице пикселей) — края могут ' +
        'быть не идеально чистыми.',
      perFormatHint: 'Адаптация — отдельный запрос на каждый формат',
      saveAll: 'Сохранить все',
      savingAll: 'Сохраняем все...',
      formatCaption: (label, w, h) => `${label} (${w}×${h})`,
      preparingPsd: 'Готовим PSD...',
      regenerateTooltip: 'Перегенерировать этот вариант',
      noInputImageError: 'Нет входного изображения',
      addAtLeastOneFormatError: 'Добавьте хотя бы один формат',
      psdLayerBg: 'Фон',
      psdLayerElements: 'Текст, лого и элементы',
    },
    modelMeta: {
      nanoBanana2Editing: 'Nano Banana 2 (Google, редактирование)',
      qualityAuto: 'Авто',
      qualityLow: 'Низкое',
      qualityMedium: 'Среднее',
      qualityHigh: 'Высокое',
      psdSaveFormat: 'PSD (Photoshop, 2 слоя)',
      yandexNetwork: 'РСЯ',
    },
  },
};

export const en: Translations = {
  toolbar: {
    file: 'File',
    saveProject: 'Save project',
    saveProjectSuccess: 'Project saved to Yandex Disk',
    saveProjectError: 'Could not save the project.',
    openProject: 'Open project',
    saveWorkspace: 'Save workspace',
    openWorkspace: 'Open workspace',
    dspTooltip: 'Open DSP',
    sendMessageTooltip: 'Send a message to a user',
    settingsTooltip: 'Settings / API key',
    aboutTooltip: 'About',
    profileTooltip: 'Account',
    newProjectTooltip: 'New project',
    closeProjectTooltip: 'Close project',
    projectName: (n) => `Project ${n}`,
    importedProjectName: 'Imported project',
    templates: 'Templates',
    templatesBusinessSection: 'For business',
    templatesMarketplacesSection: 'Marketplaces',
  },
  modeSwitch: {
    nodesAndAdapt: 'Nodes & adaptation',
    quickGeneration: 'Generation',
    textWork: 'Text work',
    evaluation: 'Evaluation',
    oneLaunch: 'One Launch',
    musicAudio: 'Music & audio',
    strategy: 'Strategy',
  },
  nodeLabels: {
    prompt: 'Text prompt',
    image: 'Image',
    imageGen: 'Image generation',
    vector: 'Vector',
    videoGen: 'Video generation',
    videoGenPro: 'Video generation PRO',
    adapt: 'Adapt',
    flokoName: 'Floko',
    flokoStatus: 'Your assistant',
    flokoChatLabel: 'Chat',
    aiAssistantTooltip: 'AI assistant',
  },
  archive: {
    title: (count) => `Project archive (${count})`,
    openFolder: 'Open folder',
    empty: 'Every generated photo, video and adaptation will show up here — they save to disk automatically.',
  },
  budget: {
    tooltip: (spent, limit) => `Spent this month (estimate): ${spent} of ${limit}`,
  },
  settingsModal: {
    title: 'Settings',
    account: 'Account',
    logout: 'Log out',
    apiToken: 'Replicate API Token',
    apiTokenHint:
      'The token is stored only locally on this computer and used for Replicate API requests. Get a token at replicate.com/account/api-tokens.',
    budgetLimit: 'Monthly budget limit, $',
    budgetHint:
      "Replicate has no API for the real dollar cost of a specific request, so the progress bar at the top estimates spend from Replicate's published per-model prices (photo, video, vector, adapt) for the current month against this limit. The exact amount may differ slightly from your real Replicate bill.",
    close: 'Close',
    save: 'Save',
    saved: 'Saved',
  },
  aboutModal: {
    title: 'About',
    text: 'Made with love by art director Ayan Nurgazinov',
    close: 'Close',
  },
  profileModal: {
    title: 'Account',
    loading: 'Loading...',
    notLoggedIn: 'Not signed in',
    paymentNotConfigured: 'Billing not configured',
    noSubscription: 'No subscription',
    untilDate: (date) => `until ${date}`,
    sessionGenerations: (count) => `Generations this session: ${count}`,
    periodLabel: 'Generations for period',
    totalLabel: (count, cost) => `Total generations: ${count} · Cost: ${cost}`,
    emptyPeriod: 'No generations in this period',
    exportBtn: 'Export CSV',
    exportPreparing: 'Preparing file...',
    exportSaved: 'Saved',
    close: 'Close',
    preferencesTitle: 'Language and theme',
    languageLabel: 'Interface language',
    themeLabel: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    statusLabels: {
      active: 'Active',
      on_trial: 'Trial',
      paused: 'Paused',
      past_due: 'Past due',
      unpaid: 'Unpaid',
      cancelled: 'Cancelled',
      expired: 'Expired',
    },
    categoryLabels: {
      image: 'Photo',
      video: 'Video',
      adapt: 'Adapt',
      vector: 'Vector',
    },
    csvHeader: 'Date,Time,Model,Category,Cost USD',
    exportError: 'Could not save the file',
    locale: 'en-US',
    legalSectionTitle: 'Documents',
  },
  adminModal: {
    title: 'Admin panel',
    hint: "The message will pop up from the bottom of a user's screen while they use the app.",
    emailLabel: "User's email",
    messageLabel: 'Message',
    messagePlaceholder: 'Message text...',
    close: 'Close',
    send: 'Send',
    sending: 'Sending...',
    sent: (count) => `Sent to ${count} recipient${count === 1 ? '' : 's'} ✓`,
    genericError: 'Could not send the message.',
    onlineTitle: 'Online now',
    onlineLoading: 'Loading...',
    onlineEmpty: 'No one is online right now.',
    lastSeenJustNow: 'just now',
    lastSeenMinutesAgo: (n) => `${n} min ago`,
    tabMessages: 'Messages',
    tabStats: 'Statistics',
    broadcastLabel: 'Send to everyone',
    recipientsLabel: 'Recipients',
    addEmailPlaceholder: 'Add an email and press Enter',
    noRecipientsError: 'Select recipients or enable send-to-everyone.',
    statsHint: 'Generations by users with an @mechta.kz email',
    statsLoading: 'Loading...',
    statsEmpty: 'No generations from @mechta.kz users yet.',
    statsError: 'Could not load statistics.',
    statsSummaryTitle: 'By user',
    statsLogTitle: 'All generations',
    statsColumnEmail: 'Email',
    statsColumnModel: 'Model',
    statsColumnCategory: 'Type',
    statsColumnCost: 'Cost',
    statsColumnWhen: 'When',
    statsGenerationsCount: (n) => `${n} generation${n === 1 ? '' : 's'}`,
  },
  aiAssistant: {
    title: 'Floko',
    copyAllTooltip: 'Copy the whole conversation',
    copiedLabel: 'Copied',
    closeTooltip: 'Close',
    emptyHint: 'Ask a question — e.g. help with a prompt or an idea. You can drag a photo or a document here.',
    copyTooltip: 'Copy',
    removeTooltip: 'Remove',
    inputPlaceholder: 'Message...',
    dropHint: 'Drop to attach the file',
    addedNodes: (count) => `\n\n✅ Added ${count} node(s) to the canvas.`,
    failedNodes: "\n\n⚠️ Couldn't build nodes from this reply.",
    documentLabel: (name) => `[Document: ${name}]`,
    imageAttachedLabel: (name) => `[Photo attached: ${name}]`,
    transcriptUser: 'You',
    transcriptAssistant: 'Assistant',
  },
  evaluation: {
    title: 'Creative evaluation',
    subtitle: 'Upload 1-3 variants of an image and get a visual-strength score for each.',
    uploadSectionLabel: 'Creative variants',
    platformLabel: 'Platform',
    platformAny: 'Any',
    addImageTooltip: 'Add variant',
    removeImageTooltip: 'Remove',
    maxImagesHint: 'Up to 3 variants',
    evaluateBtn: 'Evaluate',
    evaluatingBtn: 'Evaluating...',
    noImagesError: 'Upload at least one image.',
    strengthsLabel: 'Strengths',
    weaknessesLabel: 'To improve',
    verdictLabel: 'Verdict',
    winnerBadge: 'Strongest of the set',
    scoreOutOf: '/10',
    noteTitle: 'How this works',
    noteHowLabel: 'What gets evaluated',
    noteHowItems: [
      'contrast between subject and background',
      'where the eye lands first',
      'text readability at a shrunk-down size',
      'how visible the CTA/button is',
      'the emotional hook',
      'visual clutter',
    ],
    noteAccuracyLabel: 'Accuracy',
    noteAccuracy:
      'The score reflects an expert visual methodology, not a statistical CTR measurement — a ' +
      'precise click-through percentage requires real impression and click data for the ' +
      'specific platform. The 1-10 scale is a professional comparative judgment that helps ' +
      'identify the stronger variant before a campaign launches.',
    noteTipLabel: 'Tip',
    noteTip: "Comparing 2-3 variants against each other is more reliable than a single standalone score.",
    loadingMessages: [
      'Evaluating contrast...',
      'Checking readability...',
      'Looking for the emotional hook...',
      'Checking the CTA...',
      'Checking visual clutter...',
    ],
  },
  oneLaunch: {
    title: 'ONE LAUNCH',
    subtitle: 'Product photo → a full ad campaign: per-format cards and post copy.',
    step1Title: 'Step 1. Product photo',
    step2Title: 'Step 2. Name and advantages',
    step3Title: 'Step 3. Layout style',
    step4Title: 'Step 4. Formats',
    step5Title: 'Step 5. Color palette',
    photoLabel: 'Product photo',
    addPhotoTooltip: 'Upload a photo',
    removePhotoTooltip: 'Remove',
    nameLabel: 'Product name',
    namePlaceholder: 'e.g. Wireless Headphones X200',
    advantagesLabel: 'Advantages',
    advantagesPlaceholder: 'One advantage per line',
    improveBtn: 'Improve with AI',
    improvingBtn: 'Improving...',
    formatsLabel: 'Formats',
    formatSquare: 'Square 1:1',
    formatStory: 'Story/post 9:16',
    formatLandscape: 'Landscape 3:2',
    paletteLabel: 'Color palette',
    recommendedBadge: 'AI recommended',
    customPaletteLabel: 'Custom palette',
    customPaletteHint: "Pick one color — we'll derive the rest",
    launchBtn: 'Launch',
    launchingBtn: 'Launching...',
    noPhotoError: 'Upload a product photo.',
    noNameError: 'Enter a product name.',
    noFormatError: 'Select at least one format.',
    statusAnalyzingPhoto: 'Analyzing the photo...',
    statusGenerating: (format) => `Generating: ${format}...`,
    statusEvaluating: 'Evaluating results...',
    statusWritingCaptions: 'Writing post copy...',
    captionsTitle: 'Instagram post copy',
    downloadTooltip: 'Download',
    templateNoneLabel: 'Unique design',
    templateUniqueHint: 'The system will analyze the product and your input and create a uniquely designed card',
    templateFormatNote: 'Format is already set by the chosen template.',
    templatePaletteNote: 'Color palette is already set by the chosen template.',
    templateResultLabel: 'Template card',
    discountPlaceholder: 'Discount (e.g. -20%), optional',
  },
  strategy: {
    title: 'Strategy',
    headerSubtitle: 'Marketing strategy for ONEFLOW',
    months: 'mo.',
    tabOverview: 'Overview',
    tabMap: 'Map',
    tabPlan: 'Plan',
    newStrategyBtn: 'New strategy',
    onboardGoalStep: 'What result do you want?',
    onboardContextStep: 'Tell us about the product',
    onboardOf: 'of',
    onboardBack: 'Back',
    onboardContinue: 'Continue',
    onboardCreate: 'Create strategy',
    onboardGenerating: 'Building strategy...',
    marketLabel: 'Market',
    durationLabel: 'Duration, months',
    budgetLabel: 'Budget',
    descriptionLabel: 'Describe the product or business',
    descriptionPlaceholder: 'What you sell, to whom, and what sets it apart from competitors',
    photoLabel: 'Product photo (optional)',
    scoreTitle: 'Strategy Score',
    goalCardTitle: 'Goal',
    positioningCardTitle: 'Positioning',
    offerCardTitle: 'Offer',
    audienceCardTitle: 'Audience',
    channelsCardTitle: 'Channels',
    risksCardTitle: 'Risks',
    opportunitiesCardTitle: 'Opportunities',
    contentMatrixTitle: 'Content Matrix',
    funnelCardTitle: 'Funnel',
    segments: 'segments',
    openBtn: 'Open',
    createBtn: 'Create',
    generateBtn: 'Generate',
    planThisWeek: 'This Week',
    drawerPotential: 'Potential',
    drawerMainJob: 'Main Job',
    drawerPainPoints: 'Pain Points',
    drawerOffer: 'Recommended offer',
    drawerAllocation: 'Budget share',
    createOfferBtn: 'Create Offer',
    createModalTitle: 'Create from Strategy',
    createModalFormat: 'Format',
    createModalHint: 'ONEFLOW will create a generation workflow from this context and open it on the node canvas.',
    createModalBtn: 'Create Workflow',
    assistantTitle: 'ONEFLOW Assistant',
    assistantCollapse: 'Collapse',
    assistantContext: 'Strategy context',
    assistantInsightLabel: 'AI Insight',
    assistantApply: 'Apply',
    assistantApplied: 'Applied',
    assistantExplain: 'Explain',
    assistantExplaining: 'Explaining...',
    assistantPlaceholder: 'Ask about the strategy...',
    scoreMetricAudience: 'Audience',
    scoreMetricPositioning: 'Positioning',
    scoreMetricOffer: 'Offer',
    scoreMetricChannels: 'Channels',
    scoreMetricContent: 'Content',
    scoreMetricRetention: 'Retention',
    scoreExcellent: 'Excellent',
    scoreGood: 'Good',
    scoreFair: 'Fair',
    scoreWeak: 'Weak',
    stageAwareness: 'Awareness',
    stageConsideration: 'Consideration',
    stageConversion: 'Conversion',
    potentialLabel: 'potential',
    segmentsUnit: 'segments',
    budgetUnit: 'budget',
    mapAudienceTitle: 'Audience',
    mapPositioningTitle: 'Positioning',
    mapOfferTitle: 'Offer',
    assistantApplying: 'Applying...',
    drawerTriggers: 'Purchase triggers',
    drawerObjections: 'Objections',
    drawerConfidence: 'AI confidence',
    drawerRationale: 'Rationale',
    drawerForecast: 'Forecast',
    forecastInsufficientData: 'Insufficient data',
    forecastClicks: 'clicks (estimate)',
    drawerValueProp: 'Value proposition',
    drawerReasonsToBelieve: 'Reasons to believe',
    drawerAngle: 'Angle',
    loadingAnalyzeProduct: 'Analyzing product',
    loadingDefineAudience: 'Defining audience',
    loadingAnalyzeCompetitors: 'Analyzing competitors',
    loadingPositioning: 'Building positioning',
    loadingChannels: 'Choosing channels',
    loadingContentPlan: 'Content plan',
    optionalHide: 'Hide optional fields',
    optionalShow: 'Optional',
    websiteLabel: 'Website (optional)',
    competitorsLabel: 'Competitors (optional)',
    knownAudienceLabel: 'Known audience (optional)',
    scoreMetricFunnel: 'Funnel',
    scoreMetricMeasurement: 'Measurement',
    journeyDiscover: 'Discover',
    journeyInterest: 'Interest',
    journeyResearch: 'Research',
    journeyTry: 'Try',
    journeyBuy: 'Buy',
    journeyReturn: 'Return',
    manualBudgetEditRationale: 'Manual budget edit by user',
    manualPositioningRationale: 'Positioning switched by user',
    generateAlternativesBtn: 'Generate alternatives',
    setPrimaryBtn: 'Set primary',
    manualOfferRationale: 'Primary offer switched by user',
    generatingOffers: 'Generating alternatives...',
    normalizeBtn: 'Normalize',
    fixBtn: 'How to fix',
    dismissBtn: 'Dismiss',
    noActiveRisks: 'No active risks',
    noActiveOpportunities: 'No active opportunities',
    kpiCardTitle: 'KPI',
    journeyCardTitle: 'Customer Journey',
    scenarioCompareBtn: 'Compare scenarios',
    sidebarNavGroupLabel: 'Navigation',
    sidebarToolsGroupLabel: 'Tools',
    scenariosNavLabel: 'Scenarios',
    sidebarCollapseTooltip: 'Collapse menu',
    sidebarExpandTooltip: 'Expand menu',
    planTypeGenerate: 'Generate',
    planTypeScore: 'Score',
    planTypeCompare: 'Compare',
    planTypeManual: 'Manual',
    planTypeReview: 'Review',
    planDoneBtn: 'Done',
    planMarkDoneBtn: 'Mark done',
    scenarioMain: 'Main',
    scenarioAggressive: 'Aggressive Growth',
    scenarioLean: 'Lean',
    scenarioCompareTitle: 'Compare scenarios',
    scenarioBudget: 'Budget',
    scenarioGrowth: 'Growth',
    scenarioCac: 'CAC',
    scenarioRisk: 'Risk',
    riskLow: 'Low',
    riskMedium: 'Medium',
    riskHigh: 'High',
    scenarioDisclaimer: 'Estimate based on the current funnel and budget, not a guaranteed forecast.',
    businessConfirmEyebrow: "Here's how ONEFLOW understood your business",
    businessConfirmProductLabel: 'You sell',
    businessConfirmValueLabel: 'The customer gets',
    businessConfirmTodayLabel: 'Today they solve this via',
    businessConfirmRiskLabel: 'Main purchase risk',
    businessConfirmAllCorrectBtn: 'All correct',
    businessConfirmFixBtn: 'Fix',
    loadingUnderstandBusiness: 'Understood the product',
    loadingSegments: 'Defining audiences',
    loadingJtbd: "Mapping customers' jobs",
    loadingOffers: 'Shaping offers',
    loadingCreative: 'Preparing creative hypotheses',
    loadingPlan: 'Preparing the first test plan',
    confidenceHigh: 'High confidence',
    confidenceMedium: 'Medium confidence',
    confidenceLow: 'Low confidence',
    evidenceTypeFact: 'Fact',
    evidenceTypeResearch: 'Research',
    evidenceTypeHypothesis: 'Hypothesis',
    evidenceTypeUnknown: 'Not enough data',
    whyBtn: 'Why?',
    evidenceDrawerTitle: 'Basis for this conclusion',
    evidenceDrawerConfidenceLabel: 'Confidence',
    evidenceDrawerMissingDataLabel: 'What data is missing',
    evidenceDrawerHowToVerifyLabel: 'How to verify',
    evidenceDrawerEmpty: 'No data yet — this is a model hypothesis.',
    readinessReadyTitle: 'Ready to test',
    readinessNeedsTitle: 'Needs to connect',
    readinessNextStepLabel: 'Next step',
    tabPlanV4: 'Your plan',
    tabAnalysisV4: 'Analysis',
    tabExperimentsV4: 'Experiments',
    tabResultsV4: 'Results',
    planBusinessTitle: 'Your business',
    planAudienceTitle: 'Who to sell to',
    planMessageTitle: 'What to say',
    planOfferTitle: 'What to offer',
    planChannelsTitle: 'Where to promote',
    planCreativeTitle: 'What to create',
    planActionTitle: 'What to do',
    planNextStepTitle: 'Main next step',
    planWhyStrategyLink: 'Why this strategy?',
    planProfessionalLink: 'Professional analysis →',
    planNoDataYet: 'No data for this block yet.',
    analysisSegmentsTitle: 'Segmentation',
    analysisJtbdTitle: 'Jobs To Be Done',
    analysisPositioningTitle: 'Positioning',
    analysisOffersTitle: 'Offers',
    analysisChannelsTitle: 'Channels',
    analysisCreativeTitle: 'Creative hypotheses',
    analysisFunnelTitle: 'Funnel',
    analysisEconomicsTitle: 'Unit economics',
    analysisHistoryTitle: 'Change history',
    experimentsTitle: 'Experiment registry',
    experimentsEmpty: 'No experiments planned yet.',
    experimentDesignBtn: 'Design an experiment',
    experimentEnterResultBtn: 'Enter result',
    experimentControlLabel: 'Control',
    experimentVariantLabel: 'Variant',
    experimentConversionsLabel: 'Conversions',
    experimentVolumeLabel: 'Volume (N)',
    experimentSubmitResultBtn: 'Compute result',
    experimentStatusPlanned: 'Planned',
    experimentStatusRunning: 'Running',
    experimentStatusCompleted: 'Completed',
    experimentStatusStopped: 'Stopped',
    experimentDecisionWinner: 'Winner',
    experimentDecisionLoser: 'Loser',
    experimentDecisionInconclusive: 'Inconclusive',
    resultsLearningsTitle: 'What we learned',
    resultsProposalsTitle: 'Strategy change proposals',
    resultsEmpty: 'No results yet — finish an experiment first.',
    proposalApplyBtn: 'Apply',
    proposalRejectBtn: 'Leave as is',
    proposalAppliedLabel: 'Applied',
    proposalRejectedLabel: 'Rejected',
    proposalWhyLabel: 'Why',
  },
  tools: {
    menuLabel: 'Tools',
    bgRemoverLabel: 'Remove background',
    upscalerLabel: 'Upscaler',
    photoEditorLabel: 'Photo editor',
    bgRemoverTitle: 'Background removal',
    upscalerTitle: 'Upscaler',
    photoEditorTitle: 'Photo editor',
    addImageTooltip: 'Upload a photo',
    removeImageTooltip: 'Remove',
    noImageError: 'Upload an image.',
    removeBgBtn: 'Remove background',
    removingBgBtn: 'Removing background...',
    scaleLabel: 'Scale',
    upscaleBtn: 'Upscale',
    upscalingBtn: 'Upscaling...',
    downloadBtn: 'Download',
    rotateLeftTooltip: 'Rotate left',
    rotateRightTooltip: 'Rotate right',
    flipHTooltip: 'Flip horizontal',
    flipVTooltip: 'Flip vertical',
    brightnessLabel: 'Brightness',
    contrastLabel: 'Contrast',
    cropLabel: 'Crop',
    cropOriginal: 'Original',
    cropSquare: 'Square',
    resetBtn: 'Reset',
  },
  musicAudio: {
    title: 'Music & audio',
    subtitle: 'Generate a music track from a style prompt and lyrics, or speak a phrase in a chosen voice.',
    modeToggleMusic: 'Music',
    modeToggleSpeech: 'Speech',
    musicPromptLabel: 'Prompt (style, mood)',
    musicPromptPlaceholder: 'e.g. energetic pop-rock with bright guitars',
    lyricsLabel: 'Lyrics',
    lyricsPlaceholder: 'Enter the song lyrics',
    genreLabel: 'Genre',
    formatLabel: 'Audio format',
    phraseLabel: 'Phrase',
    phrasePlaceholder: 'What to say',
    speechPromptLabel: 'Prompt (tone, delivery)',
    speechPromptPlaceholder: 'e.g. say it cheerfully and confidently',
    voiceLabel: 'Voice',
    previewTooltip: 'Preview voice',
    languageLabel: 'Language',
    generateBtn: 'Generate',
    generatingBtn: 'Generating...',
    noPromptError: 'Enter a prompt.',
    noPhraseError: 'Enter a phrase.',
    loadingMessagesMusic: [
      'Tuning the sound...',
      'Mixing the instrumental...',
      'Picking the tone...',
      'Finalizing the track...',
    ],
    loadingMessagesSpeech: [
      'Picking the intonation...',
      'Tuning the voice...',
      'Syncing pronunciation...',
      'Finalizing the recording...',
    ],
    downloadTooltip: 'Download',
  },
  assets: {
    title: 'Assets',
    buttonLabel: 'Assets',
    filterAll: 'All',
    filterPhoto: 'Photos',
    filterVideo: 'Videos',
    loadingHint: 'Loading assets...',
    emptyHint: 'Nothing here yet — photos and videos saved to Yandex Disk will show up here.',
    notConnectedHint: 'Connect Yandex Disk in settings to see your files here.',
    loadError: 'Failed to load assets.',
    downloadTooltip: 'Download',
    tileLoadError: 'Failed to load',
  },
  yandexDisk: {
    title: 'Yandex Disk',
    description: 'Connect your Yandex Disk — every generation will be automatically saved there, in an ONEFLOW folder.',
    connectBtn: 'Connect',
    connectedLabel: 'Connected',
    disconnectBtn: 'Disconnect',
    codePlaceholder: 'Paste the code from the authorization window',
    submitBtn: 'Confirm',
    submittingBtn: 'Connecting...',
    noCodeError: 'Paste the code.',
  },
  reloadGuard: {
    title: 'Reloading will lose the project. Save it first?',
    reloadBtn: 'Reload',
    saveBtn: 'Save',
    savingBtn: 'Saving...',
    savedHint: 'Project saved to Yandex Disk',
    notConnectedError: 'Yandex Disk isn’t connected — connect it from your account.',
    saveError: 'Could not save the project.',
  },
  textWork: {
    newDialog: 'New dialog',
    dialogName: (n) => `Dialog ${n}`,
    emptyDialogPreview: 'Empty dialog',
    deleteDialogTooltip: 'Delete dialog',
    emptyHint:
      'Ask a question — help with ad copy: headlines, descriptions, editing, translation, campaign ideas. You can also ask for a document or presentation — e.g. "draft a client brief" or "put together a campaign deck" — a .docx/.pptx file will be ready to download right away.',
    inputPlaceholder: 'Message...',
    copyTooltip: 'Copy',
    copiedLabel: 'Copied',
    downloadDoc: 'Download document (.docx)',
    downloadPres: 'Download presentation (.pptx)',
    preparingFile: 'Preparing file...',
    fileError: 'Could not create the file.',
  },
  common: {
    close: 'Close',
  },
  contextMenu: {
    addNode: 'Add node',
  },
  errorBoundary: {
    title: 'Something went wrong',
    text: 'An unexpected interface error occurred. Try reloading the window — an unsaved generation in the current node may be lost.',
    reload: 'Reload',
  },
  webAuth: {
    passwordLabel: 'Password',
    loginBtn: 'Log in',
    checkingBtn: 'Checking...',
    invalidCredentials: 'Incorrect login or password.',
    connectionError: 'Could not reach the authorization server.',
    loginTitle: 'Log in',
    registerTitle: 'Register for ONEFLOW',
    registerToggleBtn: 'Register',
    backToLoginBtn: 'Back to login',
    repeatPasswordLabel: 'Repeat password',
    registerSubmitBtn: 'Register',
    registeringBtn: 'Registering...',
    fillAllFieldsError: 'Fill in all fields.',
    passwordMismatchError: 'Passwords do not match.',
    passwordTooShortError: 'Password must be at least 6 characters.',
    registerSuccessToast: 'Registration successful — you can now log in with your password.',
    registerNeedsConfirmationToast:
      'Registration is almost done — confirm your email via the link we sent you, then you can log in.',
    registerFailedError: 'Could not register',
    demoModeLink: 'Demo mode',
    orDivider: 'or',
    googleBtn: 'Continue with Google',
    emailLabel: 'Email',
    loginSubtitle: 'Access your account and continue your work',
    registerSubtitle: 'Create an account to get started with ONEFLOW',
    keepSignedIn: 'Keep me signed in',
    resetPasswordLink: 'Forgot password?',
    resetPasswordSentToast: 'Password reset email sent.',
    resetPasswordError: 'Could not send the password reset email.',
    resetPasswordNeedsEmailError: 'Enter your email first.',
    switchToRegisterText: 'New to ONEFLOW?',
    switchToLoginText: 'Already have an account?',
  },
  paymentModal: {
    topBarBtn: 'Plan',
    heading: 'Plan types',
    subheading: "Unused budget doesn't expire the next month",
    balanceLabel: 'Your balance:',
    periodMonth: 'Monthly',
    periodYear: 'Yearly',
    tierFreeTitle: 'Free plan',
    tierPopularTitle: 'Popular plan',
    tierMaxTitle: 'Maximum plan',
    freeLabel: 'Free',
    currentPlanBtn: 'Current plan',
    selectBtn: 'Subscribe',
    recheckLink: 'Already paid? Check',
    checkingBtn: 'Checking...',
    paymentNotFound: 'Payment not found yet — please try again in a minute.',
    paymentInDevelopment: 'Payment processing is under development',
    benefitOneflowAccess: 'Access to ONEFLOW',
    benefitBudgetChoice: 'Choose your own budget',
    benefit30Models: '30+ of the most up-to-date AI models',
    benefitAiAssistant: 'AI assistant',
    benefitLlmModels: 'LLM models',
    benefitVisualAdaptation: 'Visual adaptation',
    benefitOneLaunchAccess: 'Access to One Launch',
    benefitEvaluationAccess: 'Access to the evaluation tool',
    benefitPrioritySupport: 'Priority support',
  },
  legal: {
    privacyLink: 'Privacy Policy',
    termsLink: 'Terms of Service',
    refundLink: 'Refund Policy',
    helpLink: 'Help',
  },
  toolbarMenu: {
    saveProjectDesc: 'Save the current canvas to a project file',
    openProjectDesc: 'Load a previously saved project',
    saveWorkspaceDesc: 'Save all projects and tabs at once',
    openWorkspaceDesc: 'Load a previously saved workspace',
    templatesForBusinessGroup: 'For business',
    templatesMarketplacesGroup: 'Marketplaces',
    forBusinessDesc: 'Ready-made scenarios for your business niche',
    marketplacesDesc: 'Product card templates for marketplaces',
    horecaDesc: 'Food and interior photos for restaurants and cafes',
    autoDesc: 'Professional car photos from a single snapshot',
    apartmentDesc: 'Catalog-quality apartment and interior photos',
    furnitureDesc: 'Studio furniture photos for a catalog',
    electronicsDesc: 'Premium photos of devices and electronics',
    bgRemoverDesc: 'Remove the background from a photo in one click',
    upscalerDesc: 'Increase image resolution without losing quality',
    photoEditorDesc: 'Quick photo editing right in the browser',
    aboutMenuLabel: 'About',
    privacyDesc: 'How ONEFLOW collects and uses your data',
    termsDesc: 'Rules for using the service',
    refundDesc: 'Refund conditions',
    helpDesc: 'How to get started and where to get support',
    subscriptionMenuLabel: 'My subscription',
    subscriptionMenuDesc: 'Your subscription status',
    settingsMenuDesc: 'Language, stats, Yandex Disk',
  },
  startScreen: {
    greeting: "Let's start generating?",
    closeTooltip: 'Close',
    emptyDoc: 'Blank document',
    emptyDocHint: 'Start from a clean canvas',
    photoGen: 'Photo generation',
    photoGenHint: 'Prompt → a finished image',
    photoAdapt: 'Photo adaptation',
    photoAdaptHint: 'Resize a photo to fit a format',
    videoGen: 'Video generation',
    videoGenHint: 'Prompt → a finished video',
    autoCreateLabel: 'Auto-create nodes with AI assistant',
    autoCreatePlaceholder:
      'Describe what you need — the AI assistant will create and connect the right nodes on the canvas',
    autoCreateError: "Couldn't create the nodes. Please try again.",
    quickStartNav: 'Quick start',
    businessNav: 'For business',
    businessHoreca: 'HoReCa',
    businessHorecaHint: 'Food photo on a white background',
    businessAuto: 'Auto',
    businessAutoHint: 'Professional automotive photo',
    businessApartment: 'Apartment',
    businessApartmentHint: 'Magazine-style interior',
    businessFurniture: 'Furniture',
    businessFurnitureHint: 'Product on a white background',
    businessElectronics: 'Electronics',
    businessElectronicsHint: 'Catalog-style product shot',
  },
  quickGen: {
    promptPlaceholder: 'Describe what to generate...',
    photoTab: 'Photo',
    videoTab: 'Video',
    attachStartEnd: 'Start & end frame',
    attachRefImages: 'Reference images',
    attachVideoRef: 'Video reference',
    startFrameLabel: 'Start frame',
    endFrameLabel: 'End frame',
    regenerate: 'Regenerate',
    download: 'Download',
    durationSeconds: (n) => `${n}s`,
    promptLabel: 'Prompt',
  },
  errors: {
    imageLoadFailed: 'Could not load the image',
    canvasUnavailable: 'Canvas 2D is unavailable',
    apiKeyMissing: 'No Replicate API key set. Open "Settings / API key" and paste your token.',
    modelOverloaded:
      "The model is currently overloaded — Replicate is temporarily struggling with request " +
      "volume (especially common for Nano Banana Pro/2). The app already tried retrying " +
      'automatically — try clicking "Generate" again in a minute or two, or pick a different ' +
      'model.',
    contentFlagged:
      "The model declined the request: Replicate's safety system flagged the input photo or " +
      "prompt text as potentially sensitive. This is the model's own restriction, not an app " +
      'error — try a different photo or rephrase the prompt.',
    notLoggedIn: 'Not signed in.',
    generationError: 'Generation error.',
    sendFailed: 'Could not send.',
    userNotFound: 'No user found with that email.',
  },
  nodes: {
    common: {
      promptNoConnection: 'Prompt (not connected)',
      promptConnected: (text) => `Prompt: ${text}`,
      promptEmpty: '(empty)',
      model: 'Model',
      aspectRatio: 'Aspect ratio',
      resolution: 'Resolution',
      generate: 'Generate',
      generating: 'Generating...',
      save: 'Save',
      remove: 'Remove',
      emptyPromptError: 'Empty prompt',
      promptPlaceholder: 'Enter a prompt manually or connect a "Text prompt" node',
      photoHandleTitle: 'Photo',
      connected: 'connected',
      awaitingGeneration: 'awaiting generation',
      notConnected: 'not connected',
    },
    prompt: {
      header: 'Text prompt',
      placeholder: 'Describe what to generate...',
    },
    imageInput: {
      header: 'Image',
      loadFromDisk: 'Load from disk',
      loading: 'Loading...',
      orUrlLabel: 'Or image URL',
      attachHint: 'Attach your image',
    },
    imageGen: {
      header: 'Image generation',
      variantCount: 'Variant count',
      referencePhotos: (count, total) => `Reference photos (${count}/${total})`,
      photoLabel: (n) => `photo ${n}`,
      saveFormat: 'Save format',
      generatingProgress: (done, total) => `Generating ${done}/${total}...`,
    },
    videoGen: {
      header: 'Video generation',
      promptHandleTitle: 'Prompt',
      imageStatus: (status) => `Image: ${status}`,
      aspectDeterminedByImage: 'Determined by the input image',
      duration: (dur, min, max) => `Duration: ${dur} sec (${min}–${max})`,
      needPromptOrImageError: 'A prompt or an input image is required',
    },
    videoGenPro: {
      header: 'Video generation PRO',
      modelLabel: 'Model: Seedance 2.5 (ByteDance)',
      promptPlaceholder: 'Describe the video. Insert @Image1, @Video1, @Audio1 tags from the references below',
      refImages: 'Reference photos',
      refVideos: 'Reference videos',
      refAudios: 'Reference audio',
      addRefTooltip: (label) => `Add ${label.toLowerCase()}`,
      copyTagTooltip: 'Copy tag (prompt is connected externally)',
      insertTagTooltip: 'Insert tag into prompt',
    },
    vector: {
      header: 'Vector',
      saveSvg: 'Save SVG',
    },
    adapt: {
      header: 'Adapt',
      urlLabelNoConn: 'Image URL (not connected)',
      urlPlaceholder: 'https://... or connect a photo node',
      source: (status) => `Source: ${status}`,
      formats: 'Formats',
      removeFormatTooltip: 'Remove format',
      addFormat: 'Add format',
      newFormatDefaultLabel: 'New format',
      note: 'Adaptation note (optional)',
      notePlaceholder: 'E.g.: keep the logo in the top-left corner, enlarge the headline',
      saveFormat: 'Save format',
      psdHint:
        'PSD: a separate request builds a clean "Background" (no text, logo or elements), and ' +
        'the difference from the final image is cut into a transparent "Text, logo and ' +
        'elements" layer on top of it. The cut is approximate (based on pixel difference) — ' +
        'edges may not be perfectly clean.',
      perFormatHint: 'Adaptation — a separate request per format',
      saveAll: 'Save all',
      savingAll: 'Saving all...',
      formatCaption: (label, w, h) => `${label} (${w}×${h})`,
      preparingPsd: 'Preparing PSD...',
      regenerateTooltip: 'Regenerate this variant',
      noInputImageError: 'No input image',
      addAtLeastOneFormatError: 'Add at least one format',
      psdLayerBg: 'Background',
      psdLayerElements: 'Text, logo and elements',
    },
    modelMeta: {
      nanoBanana2Editing: 'Nano Banana 2 (Google, editing)',
      qualityAuto: 'Auto',
      qualityLow: 'Low',
      qualityMedium: 'Medium',
      qualityHigh: 'High',
      psdSaveFormat: 'PSD (Photoshop, 2 layers)',
      yandexNetwork: 'YAN',
    },
  },
};

export function useT(): Translations {
  const language = useLanguageStore((s) => s.language);
  return language === 'en' ? en : ru;
}
