import { trendsRu, trendsEn } from './trends/strings';
import { messengerRu, messengerEn } from './messenger/strings';
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
  trends: typeof trendsRu;
  messenger: typeof messengerRu;
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
    subscriptionButtonLabel: string;
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
    motionEngine: string;
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
  credits: {
    count: (n: number) => string;
    onBalance: string;
    tooltip: (count: string, expiry: string) => string;
    expires: (count: string, date: string) => string;
    unlimited: string;
    topUp: string;
    title: string;
    subtitle: string;
    youGet: string;
    perUsd: (n: number) => string;
    bonus: (pct: number) => string;
    approx: string;
    images: string;
    videos: string;
    music: string;
    balanceNow: (count: string) => string;
    validity: string;
    pay: string;
    payNotReady: string;
    close: string;
  };
  // ConsentModal: terms + privacy acceptance before sign-up, before payment, and once after login
  // for accounts that haven't accepted the current version yet
  legalConsent: {
    title: string;
    leadRegister: string;
    leadPayment: string;
    leadGoogle: string;
    leadRequired: string;
    termsTab: string;
    privacyTab: string;
    acceptTerms: string;
    acceptPrivacy: string;
    refundNote: string;
    refundLink: string;
    accept: string;
    accepting: string;
    cancel: string;
    logout: string;
    mustAccept: string;
    saveError: string;
    outdated: string;
    required: string;
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
    attachTooltip: string;
    attachError: string;
    documentLabel: (name: string) => string;
    imageAttachedLabel: (name: string, index: number) => string;
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
  motion: {
    materials: string;
    addMaterials: string;
    addMore: string;
    materialsHint: string;
    removeAsset: string;
    maxAssets: (n: number) => string;
    brief: string;
    briefPlaceholder: string;
    duration: string;
    seconds: (n: number) => string;
    aspect: string;
    makeBoard: string;
    moreVariant: string;
    generating: (time: string) => string;
    costHint: string;
    errorNoInput: string;
    variantN: (n: number) => string;
    deleteVariant: string;
    meta: (scenes: number, duration: number, aspect: string) => string;
    sceneN: (n: number) => string;
    layoutLabels: Record<string, string>;
    cameraLabels: Record<string, string>;
    transitionLabels: Record<string, string>;
    renderAspect: string;
    quality: string;
    fps: string;
    notSupported: string;
    composedFor: (aspect: string) => string;
    rendering: (pct: number) => string;
    cancel: string;
    download: string;
    webmNote: string;
    styleAuto: string;
    suggestStyles: string;
    moreStyles: string;
    suggestingStyles: (time: string) => string;
    paceLabels: Record<string, string>;
    fontLabels: Record<string, string>;
    fxLabels: Record<string, string>;
    colBrief: string;
    colBoards: string;
    colRender: string;
    colDone: string;
    styleLabel: string;
    styleAutoShort: string;
    scenesDur: (scenes: number, duration: number) => string;
    inQueue: (n: number) => string;
    open: string;
    toRender: string;
    addVariant: string;
    emptyBoards: string;
    emptyDone: string;
    renderSettings: string;
    willRender: (w: number, h: number, fps: number) => string;
    queued: string;
    remove: string;
    dropHere: string;
    doneHint: string;
    close: string;
    previewAt: (aspect: string) => string;
    renderThis: (label: string) => string;
    customSize: string;
    width: string;
    height: string;
    customHint: (min: number, max: number) => string;
    reference: string;
    refAdd: string;
    refAddHint: string;
    refAnalyzing: (pct: number) => string;
    refSummary: (shots: number, duration: number, pace: string) => string;
    refImages: (n: number) => string;
    refHint: string;
    refWithStyle: (style: string) => string;
    likeReference: string;
    likeReferenceHint: string;
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
    newChat: string;
    search: string;
    searchPlaceholder: string;
    noResults: string;
    localHistory: string;
    projects: string;
    createProjectTitle: string;
    projectNamePlaceholder: string;
    namePlaceholder: string;
    noProject: string;
    pinnedSection: string;
    todaySection: string;
    yesterdaySection: string;
    earlierSection: string;
    archiveSection: string;
    emptyProject: string;
    greeting: string;
    subtitle: string;
    inputPlaceholder: string;
    toolsTooltip: string;
    sendTooltip: string;
    attachTooltip: string;
    copyTooltip: string;
    copiedLabel: string;
    editTooltip: string;
    editHelp: string;
    regenerateTooltip: string;
    goodResponseTooltip: string;
    badResponseTooltip: string;
    shareTooltip: string;
    shareHelp: string;
    exportMd: string;
    exportJson: string;
    exportAnswerMd: string;
    exportAs: string;
    exportWord: string;
    exportExcel: string;
    exportPpt: string;
    moreTooltip: string;
    renameLabel: string;
    removeLabel: string;
    cancelLabel: string;
    saveLabel: string;
    createLabel: string;
    closeLabel: string;
    collapseSidebarTooltip: string;
    expandSidebarTooltip: string;
    profileLabel: string;
    planLabel: string;
    moveToProject: string;
    unpinLabel: string;
    pinLabel: string;
    restoreLabel: string;
    archiveAction: string;
    deleteChatTitle: string;
    deleteProjectTitle: string;
    deleteChatHelp: string;
    deleteProjectHelp: string;
    loadingLabel: string;
    loadingHistory: string;
    storageError: string;
    loadError: string;
    retryLabel: string;
    downloadDoc: string;
    downloadPres: string;
    preparingFile: string;
    docCardDocument: string;
    docCardPresentation: string;
    docCardSpreadsheet: string;
    docCardShow: string;
    docCardHide: string;
    docCardDownload: string;
    docCardOtherFormat: string;
    fileError: string;
    legacyOfficeError: string;
    officeReadError: string;
    promptLimit: string;
    writeQuick: string;
    imagesQuick: string;
    newsQuick: string;
    videoQuick: string;
    deepSearchLabel: string;
    academicLabel: string;
    developerLabel: string;
    unavailableWebSearch: string;
    modelHelp: string;
    writePrompt: string;
    researchPrompt: string;
    codePrompt: string;
    docPrompt: string;
    quickPromptsLabel: string;
    quickPrompts: { label: string; prompt: string }[];
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
    advantages: { title: string; description: string; benefit: string; image: string; imageAlt: string }[];
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
    tierFreeDesc: string;
    tierPopularDesc: string;
    tierMaxDesc: string;
    tierFreeIncludes: string;
    tierPopularIncludes: string;
    tierMaxIncludes: string;
    popularBadge: string;
    yearlySaveBadge: string;
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
  consent: {
    title: string;
    text: string;
    policyLink: string;
    accept: string;
    decline: string;
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
    recentNew: string;
    recentNav: string;
    recentHint: string;
    recentNodes: (count: number) => string;
    recentJustNow: string;
    recentMinutes: (n: number) => string;
    recentHours: (n: number) => string;
    recentDays: (n: number) => string;
    recentDelete: string;
    recentDeleteConfirm: string;
    autosaveQuotaError: string;
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
  /** Empty states, hints and helper copy added in the UX pass. */
  /** Home screen (web), side menu and header search. */
  home: {
    navLabel: string;
    greetingMorning: string;
    greetingDay: string;
    greetingEvening: string;
    greetingNight: string;
    greetingAccentMorning: string;
    greetingAccentDay: string;
    greetingAccentEvening: string;
    greetingAccentNight: string;
    resume: (mode: string) => string;
    resumeBtn: string;
    budgetLeft: string;
    planLabel: string;
    badgeNew: string;
    badgeBeta: string;
    more: string;
    prevSlide: string;
    nextSlide: string;
    slideN: (n: number) => string;
    video: string;
    slides: { tag: string; title: string; text: string }[];
    searchPlaceholder: string;
    searchEmpty: string;
    assets: string;
    profile: string;
    modeDescriptions: {
      canvas: string;
      generate: string;
      text: string;
      trends: string;
      evaluate: string;
      onelaunch: string;
      musicaudio: string;
      motion: string;
      strategy: string;
    };
  };
  ux: {
    attachReference: string;
    tryExample: string;
    genIntroTitle: string;
    genIntroText: string;
    imageExamples: string[];
    videoExamples: string[];
    musicEmptyTitle: string;
    speechEmptyTitle: string;
    musicExamples: string[];
    evalDropTitle: string;
    evalDropHint: string;
    evalNeedImage: string;
    unlocksAfter: (step: number) => string;
    productPhotoCta: string;
    launchNeedPhoto: string;
    launchNeedName: string;
    launchNeedSetup: string;
    goalDesc: { sales: string; leads: string; awareness: string };
    pickGoal: string;
    canvasEmptyTitle: string;
    canvasEmptyText: string;
    launchEmptyTitle: string;
    launchEmptyText: string;
    optional: string;
    formatLabel: string;
    resultsTitle: string;
    genRefHintImage: string;
    genRefHintVideo: string;
    genNeedPrompt: string;
    genResultsHint: string;
    genSteps: string[];
    variantN: (n: number) => string;
    stepDone: string;
    replace: string;
    productPhotoHint: string;
    postN: (n: number) => string;
    campaignTitle: string;
    strategyEmptyTitle: string;
    strategyEmptyText: string;
    strategySections: string[];
    motionEmptyTitle: string;
    motionEmptyText: string;
    motionSteps: string[];
  };
  errors: {
    imageLoadFailed: string;
    canvasUnavailable: string;
    apiKeyMissing: string;
    modelOverloaded: string;
    contentFlagged: string;
    notLoggedIn: string;
    generationError: string;
    insufficientBalance: string;
    sendFailed: string;
    userNotFound: string;
    // server spend guard (supabase/migrations/202610010001_generation_guard.sql)
    quotaExceeded: string;
    tooManyJobs: string;
    emailNotConfirmed: string;
    jobTooExpensive: string;
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
      runPipeline: string;
      pipelineHint: string;
      pipelineImageStage: string;
      pipelineVideoStage: string;
      pipelineOneImageError: string;
      pipelineImagePromptError: string;
      pipelineImageFailed: string;
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
  trends: trendsRu,
  messenger: messengerRu,
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
    subscriptionButtonLabel: 'Подписка',
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
    textWork: 'Copywrite engine',
    evaluation: 'Creative Predictor',
    oneLaunch: 'One Launch',
    musicAudio: 'Музыка и аудио',
    motionEngine: 'Motion Engine',
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
  credits: {
    count: (n) => {
      const a = Math.abs(n) % 100;
      const b = a % 10;
      const w = a > 10 && a < 20 ? 'кредитов' : b === 1 ? 'кредит' : b >= 2 && b <= 4 ? 'кредита' : 'кредитов';
      return `${n.toLocaleString('ru-RU')} ${w}`;
    },
    onBalance: 'на балансе',
    tooltip: (count, expiry) => `На балансе: ${count}${expiry ? ` · ${expiry}` : ''}. Нажмите, чтобы пополнить`,
    expires: (count, date) => `${count} сгорят ${date}`,
    unlimited: 'Без ограничений',
    topUp: 'Пополнить',
    title: 'Пополнение баланса',
    subtitle: 'Выберите сумму — кредиты зачислятся на баланс. Чем больше сумма, тем выгоднее.',
    youGet: 'Вы получите',
    perUsd: (n) => `${n} кредитов за $1`,
    bonus: (pct) => `+${pct}% бонус`,
    approx: 'Этого хватит примерно на',
    images: 'картинок · Nano Banana 2, 1K',
    videos: 'видео 5 с · Kling 3.0, 720p',
    music: 'треков · Lyria 3 Pro',
    balanceNow: (count) => `Сейчас на балансе: ${count}`,
    validity: 'Кредиты действуют 12 месяцев с момента пополнения',
    pay: 'Перейти к оплате',
    payNotReady: 'Оплата скоро будет подключена — пополнить баланс можно будет прямо здесь.',
    close: 'Закрыть',
  },
  legalConsent: {
    title: 'Соглашение с условиями',
    leadRegister: 'Чтобы зарегистрироваться, прочитайте и примите Пользовательское соглашение и Политику конфиденциальности.',
    leadPayment: 'Перед оплатой прочитайте и примите Пользовательское соглашение и Политику конфиденциальности.',
    leadGoogle: 'Чтобы войти или зарегистрироваться через Google, прочитайте и примите Пользовательское соглашение и Политику конфиденциальности.',
    leadRequired: 'Чтобы продолжить работу в ONEFLOW, прочитайте и примите актуальные Пользовательское соглашение и Политику конфиденциальности.',
    termsTab: 'Пользовательское соглашение',
    privacyTab: 'Политика конфиденциальности',
    acceptTerms: 'Я прочитал(а) и принимаю Пользовательское соглашение',
    acceptPrivacy: 'Я ознакомлен(а) с Политикой конфиденциальности и даю согласие на обработку персональных данных',
    refundNote: 'Условия возврата средств —',
    refundLink: 'Политика возврата',
    accept: 'Принять и продолжить',
    accepting: 'Сохраняем…',
    cancel: 'Отмена',
    logout: 'Выйти',
    mustAccept: 'Отметьте оба пункта, чтобы продолжить.',
    saveError: 'Не удалось сохранить согласие. Проверьте соединение и попробуйте ещё раз.',
    outdated: 'Документы обновились — обновите страницу и примите новую редакцию.',
    required: 'Без согласия с документами регистрация и оплата недоступны.',
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
      motion: 'Motion Engine',
      evaluate: 'Creative Predictor',
      text: 'Тексты',
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
    emptyHint:
      'Задайте вопрос — например, помощь с промптом или идеей. Прикрепите фото скрепкой, и я смогу поставить его нодой на холст.',
    copyTooltip: 'Скопировать',
    removeTooltip: 'Удалить',
    inputPlaceholder: 'Сообщение...',
    dropHint: 'Отпустите, чтобы прикрепить файл',
    addedNodes: (count) => `\n\n✅ Добавил на холст ${count} нод.`,
    failedNodes: '\n\n⚠️ Не удалось построить ноды из этого ответа.',
    attachTooltip: 'Прикрепить фото или документ',
    attachError: 'До 4 файлов, каждый до 4 МБ.',
    documentLabel: (name) => `[Документ: ${name}]`,
    imageAttachedLabel: (name, index) => `[Фото ${index}: ${name}]`,
    transcriptUser: 'Вы',
    transcriptAssistant: 'Ассистент',
  },
  evaluation: {
    title: 'Creative Predictor',
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
  motion: {
    materials: 'Материалы',
    addMaterials: 'Фото или видео',
    addMore: 'Добавить',
    materialsHint: 'До 8 файлов. Можно перетащить сюда.',
    removeAsset: 'Убрать',
    maxAssets: (n) => `Можно добавить не больше ${n} материалов.`,
    brief: 'Задача и тексты',
    briefPlaceholder: 'Что рекламируем, для кого, какие тексты и призыв должны быть в ролике. Например: «Кофейня Bean, новое сезонное меню, скидка 20% до конца месяца, призыв — заходите в гости»',
    duration: 'Длительность',
    seconds: (n) => `${n} с`,
    aspect: 'Формат кадра',
    makeBoard: 'Сделать раскадровку',
    moreVariant: 'Ещё вариант',
    generating: (time) => `ONEFLOW делает раскадровку… ${time}`,
    costHint: 'Раскадровка ≈ $0.05–0.20 за вариант. Рендер видео бесплатный — идёт прямо в браузере.',
    errorNoInput: 'Добавьте материалы или опишите задачу.',
    variantN: (n) => `Вариант ${n}`,
    deleteVariant: 'Удалить вариант',
    meta: (scenes, duration, aspect) => `${scenes} сцен · ${duration} с · сделано под ${aspect}`,
    sceneN: (n) => `Сцена ${n}`,
    layoutLabels: {
      full: 'На весь кадр',
      'split-left': 'Разделение',
      'split-right': 'Разделение',
      'center-card': 'Карточка',
      grid: 'Сетка',
      'text-only': 'Текст',
      'caption-bottom': 'Подпись снизу',
    },
    cameraLabels: {
      static: 'Статика',
      'zoom-in': 'Наезд',
      'zoom-out': 'Отъезд',
      'pan-left': 'Панорама влево',
      'pan-right': 'Панорама вправо',
      'pan-up': 'Панорама вверх',
      'pan-down': 'Панорама вниз',
      drift: 'Дрейф',
    },
    transitionLabels: { cut: 'Склейка', fade: 'Растворение', slide: 'Сдвиг', zoom: 'Зум', wipe: 'Шторка', glitch: 'Глитч', flash: 'Вспышка', blur: 'Размытие', 'push-up': 'Сдвиг вверх' },
    renderAspect: 'Формат видео',
    quality: 'Разрешение',
    fps: 'Кадров в секунду',
    notSupported: 'Этот браузер не может закодировать видео такого размера',
    composedFor: (aspect) => `Раскадровка придумана под ${aspect} — в другом формате сцены перестроятся автоматически, проверьте кадры выше.`,
    rendering: (pct) => `Рендер… ${pct}%`,
    cancel: 'Остановить',
    download: 'Скачать',
    webmNote: 'Браузер не умеет MP4, поэтому видео сохранено в WebM. Для MP4 откройте ONEFLOW в Chrome или Edge.',
    styleAuto: 'Авто — стиль подберёт ONEFLOW',
    suggestStyles: 'Предложи стили',
    moreStyles: 'Ещё стили',
    suggestingStyles: (time) => `ONEFLOW подбирает стили… ${time}`,
    paceLabels: { calm: 'Спокойный темп', medium: 'Средний темп', fast: 'Быстрый темп' },
    fontLabels: { sans: 'Гротеск', display: 'Жирный гротеск', serif: 'Антиква', mono: 'Моноширинный' },
    fxLabels: { grain: 'Зерно', glow: 'Свечение', vignette: 'Виньетка', letterbox: 'Кинополосы', duotone: 'Дуотон' },
    colBrief: 'Бриф',
    colBoards: 'Раскадровки',
    colRender: 'Рендер',
    colDone: 'Готово',
    styleLabel: 'Стиль видео',
    styleAutoShort: 'Авто',
    scenesDur: (scenes, duration) => `${scenes} сцен · ${duration} с`,
    inQueue: (n) => `в рендере: ${n}`,
    open: 'Открыть',
    toRender: 'В рендер',
    addVariant: 'Ещё вариант',
    emptyBoards: 'Здесь появятся раскадровки. Заполните бриф слева и нажмите «Сделать раскадровку».',
    emptyDone: 'Здесь появятся готовые видео с кнопкой «Скачать».',
    renderSettings: 'Настройки рендера',
    willRender: (w, h, fps) => `Получится MP4 ${w}×${h}, ${fps} кадров в секунду. Рендер бесплатный.`,
    queued: 'В очереди',
    remove: 'Убрать',
    dropHere: 'Перетащите раскадровку сюда или нажмите «В рендер» на карточке',
    doneHint: 'Готовые видео хранятся до перезагрузки страницы — скачайте нужные.',
    close: 'Закрыть',
    previewAt: (aspect) => `Кадры в формате ${aspect} — так будет в видео`,
    renderThis: (label) => `В рендер · ${label}`,
    customSize: 'Свой размер',
    width: 'Ширина',
    height: 'Высота',
    customHint: (min, max) => `Любой размер от ${min} до ${max} px по стороне, округляем до чётного. Сцены перестроятся под эти пропорции.`,
    reference: 'Референс',
    refAdd: 'Загрузить референс',
    refAddHint: 'Видео или до 4 картинок, на которые ролик должен быть похож',
    refAnalyzing: (pct) => `Разбираю референс… ${pct}%`,
    refSummary: (shots, duration, pace) => {
      const m10 = shots % 10;
      const m100 = shots % 100;
      const word = m10 === 1 && m100 !== 11 ? 'сцена' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'сцены' : 'сцен';
      return `${shots} ${word} · ${duration.toFixed(1)} с · ${pace.toLowerCase()}`;
    },
    refImages: (n) => `${n} ${n === 1 ? 'картинка' : n < 5 ? 'картинки' : 'картинок'} — повторим цвета и подачу`,
    refHint: 'Повторим ритм склеек, цвета, раскладку, движение и переходы — с вашими материалами и текстами. Сам референс в ролик не попадёт.',
    refWithStyle: (style) => `Выбран стиль «${style}»: внешний вид возьмём из него, от референса — ритм и структуру сцен.`,
    likeReference: 'Как в референсе',
    likeReferenceHint: 'Цвета, шрифт и эффекты — по референсу',
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
    newChat: 'Новый чат',
    search: 'Поиск',
    searchPlaceholder: 'Поиск по названиям и сообщениям',
    noResults: 'Ничего не найдено',
    localHistory: 'История на этом устройстве',
    projects: 'Проекты',
    createProjectTitle: 'Новый проект',
    projectNamePlaceholder: 'Введите название проекта',
    namePlaceholder: 'Название',
    noProject: 'Без проекта',
    pinnedSection: 'Закреплённые',
    todaySection: 'Сегодня',
    yesterdaySection: 'Вчера',
    earlierSection: 'Ранее',
    archiveSection: 'Архив',
    emptyProject: 'Пока нет чатов',
    greeting: 'Привет! Чем могу помочь?',
    subtitle:
      'Ваш ИИ-ассистент для текстов, идей и документов — от первого наброска до готового результата.',
    inputPlaceholder: 'Спросите о чём угодно...',
    toolsTooltip: 'Инструменты',
    sendTooltip: 'Отправить',
    attachTooltip: 'Прикрепить файл',
    copyTooltip: 'Скопировать',
    copiedLabel: 'Скопировано',
    editTooltip: 'Редактировать',
    editHelp: 'После отправки этой версии последующие сообщения будут заменены новым ответом.',
    regenerateTooltip: 'Повторить ответ',
    goodResponseTooltip: 'Хороший ответ',
    badResponseTooltip: 'Плохой ответ',
    shareTooltip: 'Поделиться',
    shareHelp: 'Скопируйте текст или скачайте переписку для отправки. Публичная ссылка не создаётся.',
    exportMd: 'Скачать переписку (.md)',
    exportJson: 'Скачать резервную копию (.json)',
    exportAnswerMd: 'Скачать ответ (.md)',
    exportAs: 'Скачать как',
    exportWord: 'Word (.docx)',
    exportExcel: 'Excel (.xlsx)',
    exportPpt: 'PowerPoint (.pptx)',
    moreTooltip: 'Действия с чатом',
    renameLabel: 'Переименовать',
    removeLabel: 'Удалить',
    cancelLabel: 'Отмена',
    saveLabel: 'Сохранить',
    createLabel: 'Создать проект',
    closeLabel: 'Закрыть',
    collapseSidebarTooltip: 'Свернуть боковую панель',
    expandSidebarTooltip: 'Открыть боковую панель',
    profileLabel: 'Профиль',
    planLabel: 'Подписка',
    moveToProject: 'Переместить в проект',
    unpinLabel: 'Открепить',
    pinLabel: 'Закрепить',
    restoreLabel: 'Вернуть из архива',
    archiveAction: 'Архивировать',
    deleteChatTitle: 'Удалить этот чат?',
    deleteProjectTitle: 'Удалить проект?',
    deleteChatHelp: 'Сообщения и вложения этого чата будут удалены с этого устройства.',
    deleteProjectHelp: 'Чаты сохранятся в общей истории.',
    loadingLabel: 'ONEFLOW готовит ответ...',
    loadingHistory: 'Загружаем историю...',
    storageError: 'Не удалось сохранить историю на этом устройстве. Скачайте резервную копию.',
    loadError: 'Не удалось прочитать историю. Сохранённые данные не перезаписаны.',
    retryLabel: 'Повторить запрос',
    downloadDoc: 'Скачать документ (.docx)',
    downloadPres: 'Скачать презентацию (.pptx)',
    preparingFile: 'Готовим файл...',
    docCardDocument: 'Документ Word',
    docCardPresentation: 'Презентация PowerPoint',
    docCardSpreadsheet: 'Таблица Excel',
    docCardShow: 'Показать',
    docCardHide: 'Свернуть',
    docCardDownload: 'Скачать',
    docCardOtherFormat: 'Другой формат',
    fileError:
      'До 4 файлов: PNG, JPG, WebP, TXT, MD, CSV, JSON, DOCX, XLSX, PPTX; до 4 МБ каждый, текст — до 30 000 символов.',
    legacyOfficeError: 'Старый формат Office. Пересохраните файл как .docx, .xlsx или .pptx.',
    officeReadError: 'Не удалось прочитать файл — возможно, он повреждён или защищён паролем.',
    promptLimit: 'Запрос слишком длинный: максимум 30 000 символов.',
    writeQuick: 'Написать текст',
    imagesQuick: 'Создать изображение',
    newsQuick: 'Последние новости',
    videoQuick: 'Создать видео',
    deepSearchLabel: 'Поиск в интернете',
    academicLabel: 'Исследования',
    developerLabel: 'Код',
    unavailableWebSearch:
      'Веб-поиск ещё не подключён в ONEFLOW. Можно прикрепить текст источников для анализа.',
    modelHelp: 'Сейчас в ONEFLOW подключена одна модель. Другие появятся после подключения на сервере.',
    writePrompt: 'Помоги написать текст. Сначала уточни продукт, аудиторию, площадку и цель.',
    researchPrompt:
      'Помоги проанализировать материалы. Я прикреплю источники. Отделяй факты от предположений и ссылайся на приложенные материалы.',
    codePrompt: 'Помоги с кодом. Сначала уточни задачу, язык и ожидаемый результат.',
    docPrompt: 'Подготовь документ. Сначала уточни тему, цель, аудиторию и желаемую структуру.',
    quickPromptsLabel: 'Быстрые подсказки',
    quickPrompts: [
      {
        label: 'Заголовки объявления',
        prompt: 'Напиши 5 вариантов цепляющего заголовка для рекламного объявления о ',
      },
      {
        label: 'Сделать убедительнее',
        prompt: 'Перепиши следующий текст, сделав его более убедительным и продающим:\n\n',
      },
      {
        label: 'Под соцсети',
        prompt:
          'Адаптируй этот текст под формат поста в Instagram/Telegram — коротко, с эмодзи и призывом к действию:\n\n',
      },
      {
        label: 'SEO-описание',
        prompt: 'Напиши SEO-оптимизированное описание товара для карточки на маркетплейсе: ',
      },
      {
        label: 'Контент-план',
        prompt:
          'Составь контент-план на месяц для соцсетей бренда: укажи темы, форматы и частоту постов. Ниша: ',
      },
      {
        label: 'Проверить текст',
        prompt: 'Проверь этот текст на грамотность, стиль и тон, предложи правки:\n\n',
      },
    ],
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
    registerTitle: 'Регистрация',
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
    advantages: [
      {
        title: 'Всё для контента — здесь',
        description: 'Изображения, видео, тексты и аудио в одном рабочем пространстве.',
        benefit: 'Меньше переключений между сервисами.',
        image: 'step-01.webp',
        imageAlt: 'Единое пространство для фото, видео, текста и аудио',
      },
      {
        title: 'Соедините шаги в процесс',
        description: 'Собирайте генерацию и обработку в цепочки из связанных блоков.',
        benefit: 'Удобно повторять знакомые задачи.',
        image: 'step-02.webp',
        imageAlt: 'Цепочка нод: исходник, генерация и результат',
      },
      {
        title: 'Один визуал. Нужные форматы.',
        description: 'Адаптируйте изображение для постов, сторис и рекламных баннеров.',
        benefit: 'Меньше ручной подготовки макетов.',
        image: 'step-03.webp',
        imageAlt: 'Один товар в квадратном, вертикальном и горизонтальном форматах',
      },
      {
        title: 'От идеи к понятному плану',
        description: 'Находите идеи в TRENDS, пишите тексты и собирайте стратегию.',
        benefit: 'Понятнее, что создавать и зачем.',
        image: 'step-04.webp',
        imageAlt: 'План кампании: аудитория, сообщение и каналы',
      },
      {
        title: 'Сравните перед запуском',
        description: 'Creative Predictor поможет сравнить визуалы и найти слабые места.',
        benefit: 'Больше оснований для выбора креатива.',
        image: 'step-05.png',
        imageAlt: 'Сравнение двух креативов по читаемости и композиции',
      },
      {
        title: 'Начните с фото товара',
        description: 'Загрузите фото в One Launch и создайте карточки и рекламные креативы.',
        benefit: 'Один исходник для разных материалов.',
        image: 'step-06.webp',
        imageAlt: 'Фото товара превращается в карточку и рекламный баннер',
      },
      {
        title: 'Ваш бюджет не сгорает',
        description: 'Неиспользованный бюджет переносится на следующий месяц и остаётся доступным для генераций.',
        benefit: 'Создавайте в своём темпе.',
        image: 'step-08.webp',
        imageAlt: 'Остаток бюджета переходит на следующий месяц',
      },
      {
        title: 'Генерация дешевле до 25%',
        description: 'Вы не переплачиваете посредникам — больше бюджета остаётся на генерации.',
        benefit: 'Больше возможностей за тот же бюджет.',
        image: 'step-07.webp',
        imageAlt: 'До 25% экономии на генерации через ONEFLOW',
      },
    ],
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
    tierFreeDesc: 'Чтобы попробовать ONEFLOW и понять, подходит ли он вам',
    tierPopularDesc: 'Оптимальный вариант для регулярной работы с генерацией',
    tierMaxDesc: 'Для команд, которым нужен доступ без ограничений',
    tierFreeIncludes: 'Бесплатный тариф включает:',
    tierPopularIncludes: 'Всё из бесплатного тарифа, плюс:',
    tierMaxIncludes: 'Всё из популярного тарифа, плюс:',
    popularBadge: 'Популярный',
    yearlySaveBadge: 'Экономия 20%',
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
  consent: {
    title: 'Аналитика',
    text: 'Мы используем аналитику, чтобы понимать, какими функциями пользуются и что ломается. До вашего согласия на устройстве ничего не сохраняется.',
    policyLink: 'Политика конфиденциальности',
    accept: 'Принять',
    decline: 'Отклонить',
  },
  legal: {
    privacyLink: 'Политика конфиденциальности',
    termsLink: 'Пользовательское соглашение',
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
    recentNew: 'Новый проект',
    recentNav: 'Недавние',
    recentHint: 'Проекты сохраняются сами — открывайте и продолжайте с того же места.',
    recentNodes: (count) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'нода' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'ноды' : 'нод'}`,
    recentJustNow: 'только что',
    recentMinutes: (n) => `${n} мин назад`,
    recentHours: (n) => `${n} ч назад`,
    recentDays: (n) => (n <= 1 ? 'вчера' : `${n} дн назад`),
    recentDelete: 'Удалить проект',
    recentDeleteConfirm: 'Удалить?',
    autosaveQuotaError: 'Не хватает места для автосохранения — удалите ненужные проекты в «Недавних».',
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
  home: {
    navLabel: 'Главная',
    greetingMorning: 'Доброе утро! Кофе есть —',
    greetingDay: 'Добрый день! Самое время',
    greetingEvening: 'Добрый вечер! Пара креативов',
    greetingNight: 'Не спится? Тогда',
    greetingAccentMorning: 'идеи тоже будут',
    greetingAccentDay: 'что-нибудь запустить',
    greetingAccentEvening: 'перед сном?',
    greetingAccentNight: 'творим в тишине',
    resume: (mode) => `С возвращением. В прошлый раз вы работали в «${mode}» — продолжим?`,
    resumeBtn: 'Продолжить',
    budgetLeft: 'осталось в бюджете',
    planLabel: 'тариф',
    badgeNew: 'Новое',
    badgeBeta: 'Beta',
    more: 'Подробнее',
    prevSlide: 'Предыдущий слайд',
    nextSlide: 'Следующий слайд',
    slideN: (n) => `Слайд ${n}`,
    video: 'Видео',
    slides: [
      { tag: 'Новое · Motion Engine', title: 'Ролик из ваших фото за пару минут', text: 'Загрузите фото товара и бриф — ONEFLOW предложит раскадровки, а вы выберете лучшую и отправите в рендер.' },
      { tag: 'One Launch', title: 'Одно фото — целая кампания', text: 'Карточки под все форматы и тексты постов из одной фотографии товара.' },
      { tag: 'Creative Predictor', title: 'Узнайте, какой креатив сильнее — до запуска', text: 'Загрузите до 3 вариантов и получите оценку и советы, что улучшить.' },
    ],
    searchPlaceholder: 'Поиск по режимам',
    searchEmpty: 'Ничего не нашлось',
    assets: 'Ассеты',
    profile: 'Профиль',
    modeDescriptions: {
      canvas: 'Собирайте цепочки из нод и адаптируйте креатив под все форматы',
      generate: 'Фото и видео по описанию — лучшие модели в одном окне',
      text: 'Тексты для постов, баннеров и карточек в стиле бренда',
      trends: 'Свежие тренды соцсетей и идеи, как применить их к бренду',
      evaluate: 'Оценит до 3 креативов до запуска и подскажет, что улучшить',
      onelaunch: 'Фото товара → готовая кампания: карточки под форматы и тексты',
      musicaudio: 'Трек по описанию или озвучка фразы голосом на выбор',
      motion: 'Видео-ролик из ваших фото: бриф → раскадровки → рендер',
      strategy: 'Маркетинговая стратегия под вашу цель: продажи, заявки, охват',
    },
  },
  ux: {
    attachReference: 'Референс',
    tryExample: 'Например:',
    genIntroTitle: 'Что создадим?',
    genIntroText: 'Опишите картинку или видео словами — выберите модель, формат и нажмите «Сгенерировать».',
    imageExamples: [
      'Флакон духов на мокром чёрном камне, студийный свет',
      'Кофе с собой на подоконнике, утреннее солнце, плёнка',
      'Кроссовки в воздухе на пастельном фоне, 3D',
    ],
    videoExamples: [
      'Медленный облёт банки газировки в каплях воды',
      'Пар над чашкой кофе, макро, мягкий свет',
      'Смартфон вращается на подиуме, неоновая подсветка',
    ],
    musicEmptyTitle: 'Здесь появится трек',
    speechEmptyTitle: 'Здесь появится озвучка',
    musicExamples: ['Энергичный поп-рок для рекламы кроссовок', 'Спокойный lo-fi для кофейни', 'Эпичный оркестр для трейлера'],
    evalDropTitle: 'Перетащите до 3 вариантов креатива',
    evalDropHint: 'или нажмите, чтобы выбрать файлы · PNG, JPG',
    evalNeedImage: 'Добавьте хотя бы один вариант, чтобы получить оценку',
    unlocksAfter: (step) => `Откроется после шага ${step}`,
    productPhotoCta: 'Загрузите фото товара',
    launchNeedPhoto: 'Чтобы запустить, загрузите фото товара (шаг 1)',
    launchNeedName: 'Осталось указать название товара (шаг 2)',
    launchNeedSetup: 'Выберите форматы и цветовую гамму (шаги 4–5)',
    goalDesc: {
      sales: 'Покупки и выручка: оффер, цена, путь до оплаты',
      leads: 'Заявки и контакты: формы, звонки, сообщения',
      awareness: 'Охват и запоминаемость бренда',
    },
    pickGoal: 'Выберите цель, чтобы продолжить',
    canvasEmptyTitle: 'Холст пока пуст',
    canvasEmptyText: 'Добавьте ноду на панели слева или начните с готовой схемы:',
    launchEmptyTitle: 'Здесь появится ваша кампания',
    launchEmptyText: 'Пройдите 5 шагов слева — получите карточки под выбранные форматы и тексты постов.',
    optional: 'необязательно',
    formatLabel: 'Формат',
    resultsTitle: 'Результаты',
    genRefHintImage: 'Фото-референс: товар, стиль или композиция — модель будет на него опираться.',
    genRefHintVideo: 'Для видео: начальный и конечный кадр, референс-изображения или видео-референс.',
    genNeedPrompt: 'Напишите промпт, чтобы начать',
    genResultsHint: 'нажмите на карточку — промпт, модель, «Перегенерировать», «Скачать»',
    genSteps: [
      'Опишите идею: товар, фон, настроение, текст на картинке',
      'Выберите модель, формат и качество — или оставьте как есть',
      'Нажмите «Сгенерировать» — готовые варианты появятся здесь',
    ],
    variantN: (n) => `Вариант ${n}`,
    stepDone: 'готово',
    replace: 'Заменить',
    productPhotoHint: 'PNG или JPG, лучше на однотонном фоне',
    postN: (n) => `Пост ${n}`,
    campaignTitle: 'Готовая кампания',
    strategyEmptyTitle: 'Здесь появится ваш план',
    strategyEmptyText:
      'Ответьте на 2 вопроса — ONEFLOW разберёт бизнес и соберёт маркетинговую стратегию: аудитория, оффер, сообщение, каналы и креативы. Потом её можно одной кнопкой превратить в схему в нодах.',
    strategySections: ['Ваш бизнес', 'Кому продавать', 'Что предложить', 'Что говорить', 'Где продвигаться', 'Что создавать'],
    motionEmptyTitle: 'Здесь появятся раскадровки',
    motionEmptyText: 'Заполните бриф слева и нажмите «Сделать раскадровку» — ONEFLOW предложит варианты ролика. Лучший отправьте в рендер.',
    motionSteps: [
      'Загрузите фото товара и опишите задачу',
      'Получите раскадровки — откройте и посмотрите превью',
      'Перетащите лучшую в «Рендер» и скачайте MP4',
    ],
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
    insufficientBalance:
      'Недостаточно средств на балансе для этой генерации. Пополните баланс, чтобы продолжить.',
    sendFailed: 'Не удалось отправить.',
    userNotFound: 'Пользователь с таким email не найден.',
    quotaExceeded: 'Недостаточно кредитов. Пополните баланс, чтобы продолжить.',
    tooManyJobs: 'Слишком много генераций одновременно — дождитесь завершения текущих.',
    emailNotConfirmed: 'Подтвердите email по ссылке из письма, чтобы пользоваться генерацией.',
    jobTooExpensive: 'Этот запрос слишком дорогой для одной генерации — уменьшите длительность или разрешение.',
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
      runPipeline: 'Запустить пайплайн',
      pipelineHint: 'Сгенерировать фото и сразу сделать из него видео',
      pipelineImageStage: 'Шаг 1 из 2: генерирую фото...',
      pipelineVideoStage: 'Шаг 2 из 2: генерирую видео...',
      pipelineOneImageError:
        'В ноде «Генерация фото» должно быть только одно фото — поставьте количество вариантов 1 и запустите снова.',
      pipelineImagePromptError: 'У ноды «Генерация фото» пустой промпт — заполните его перед запуском пайплайна.',
      pipelineImageFailed: 'Фото не сгенерировалось — пайплайн остановлен, видео не запускалось.',
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
  trends: trendsEn,
  messenger: messengerEn,
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
    subscriptionButtonLabel: 'Subscription',
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
    textWork: 'Copywrite engine',
    evaluation: 'Creative Predictor',
    oneLaunch: 'One Launch',
    musicAudio: 'Music & audio',
    motionEngine: 'Motion Engine',
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
  credits: {
    count: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`,
    onBalance: 'on balance',
    tooltip: (count, expiry) => `Balance: ${count}${expiry ? ` · ${expiry}` : ''}. Click to top up`,
    expires: (count, date) => `${count} expire on ${date}`,
    unlimited: 'Unlimited',
    topUp: 'Top up',
    title: 'Top up your balance',
    subtitle: 'Pick an amount — the credits go straight to your balance. The bigger the top-up, the better the rate.',
    youGet: 'You get',
    perUsd: (n) => `${n} credits per $1`,
    bonus: (pct) => `+${pct}% bonus`,
    approx: 'That is roughly',
    images: 'images · Nano Banana 2, 1K',
    videos: '5-second videos · Kling 3.0, 720p',
    music: 'music tracks · Lyria 3 Pro',
    balanceNow: (count) => `Current balance: ${count}`,
    validity: 'Credits stay valid for 12 months from the top-up',
    pay: 'Continue to payment',
    payNotReady: 'Payments are being connected — you will be able to top up right here soon.',
    close: 'Close',
  },
  legalConsent: {
    title: 'Terms and privacy',
    leadRegister: 'To sign up, please read and accept the Terms of Service and the Privacy Policy.',
    leadPayment: 'Before paying, please read and accept the Terms of Service and the Privacy Policy.',
    leadGoogle: 'To sign in or sign up with Google, please read and accept the Terms of Service and the Privacy Policy.',
    leadRequired: 'To keep using ONEFLOW, please read and accept the current Terms of Service and Privacy Policy.',
    termsTab: 'Terms of Service',
    privacyTab: 'Privacy Policy',
    acceptTerms: 'I have read and accept the Terms of Service',
    acceptPrivacy: 'I have read the Privacy Policy and consent to the processing of my personal data',
    refundNote: 'Refund terms —',
    refundLink: 'Refund Policy',
    accept: 'Accept and continue',
    accepting: 'Saving…',
    cancel: 'Cancel',
    logout: 'Log out',
    mustAccept: 'Tick both boxes to continue.',
    saveError: 'Couldn’t save your consent. Check your connection and try again.',
    outdated: 'The documents have been updated — reload the page and accept the new version.',
    required: 'Sign-up and payment aren’t available without accepting the documents.',
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
      motion: 'Motion Engine',
      evaluate: 'Creative Predictor',
      text: 'Text',
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
    emptyHint:
      'Ask a question — e.g. help with a prompt or an idea. Attach a photo with the paperclip and I can drop it onto the canvas as a node.',
    copyTooltip: 'Copy',
    removeTooltip: 'Remove',
    inputPlaceholder: 'Message...',
    dropHint: 'Drop to attach the file',
    addedNodes: (count) => `\n\n✅ Added ${count} node(s) to the canvas.`,
    failedNodes: "\n\n⚠️ Couldn't build nodes from this reply.",
    attachTooltip: 'Attach a photo or a document',
    attachError: 'Up to 4 files, 4 MB each.',
    documentLabel: (name) => `[Document: ${name}]`,
    imageAttachedLabel: (name, index) => `[Photo ${index}: ${name}]`,
    transcriptUser: 'You',
    transcriptAssistant: 'Assistant',
  },
  evaluation: {
    title: 'Creative Predictor',
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
  motion: {
    materials: 'Materials',
    addMaterials: 'Photo or video',
    addMore: 'Add',
    materialsHint: 'Up to 8 files. You can drop them here.',
    removeAsset: 'Remove',
    maxAssets: (n) => `You can add up to ${n} materials.`,
    brief: 'Brief and copy',
    briefPlaceholder: 'What you promote, for whom, which copy and call to action the video needs. E.g. “Bean coffee shop, new seasonal menu, 20% off until the end of the month, come visit us”',
    duration: 'Duration',
    seconds: (n) => `${n}s`,
    aspect: 'Frame',
    makeBoard: 'Create storyboard',
    moreVariant: 'Another variant',
    generating: (time) => `ONEFLOW is storyboarding… ${time}`,
    costHint: 'A storyboard costs ≈ $0.05–0.20 per variant. Video rendering is free — it runs in your browser.',
    errorNoInput: 'Add materials or describe the task.',
    variantN: (n) => `Variant ${n}`,
    deleteVariant: 'Delete variant',
    meta: (scenes, duration, aspect) => `${scenes} scenes · ${duration}s · composed for ${aspect}`,
    sceneN: (n) => `Scene ${n}`,
    layoutLabels: {
      full: 'Full frame',
      'split-left': 'Split',
      'split-right': 'Split',
      'center-card': 'Card',
      grid: 'Grid',
      'text-only': 'Text',
      'caption-bottom': 'Bottom caption',
    },
    cameraLabels: {
      static: 'Static',
      'zoom-in': 'Push in',
      'zoom-out': 'Pull out',
      'pan-left': 'Pan left',
      'pan-right': 'Pan right',
      'pan-up': 'Pan up',
      'pan-down': 'Pan down',
      drift: 'Drift',
    },
    transitionLabels: { cut: 'Cut', fade: 'Dissolve', slide: 'Slide', zoom: 'Zoom', wipe: 'Wipe', glitch: 'Glitch', flash: 'Flash', blur: 'Blur', 'push-up': 'Push up' },
    renderAspect: 'Video frame',
    quality: 'Resolution',
    fps: 'Frames per second',
    notSupported: 'This browser can’t encode video this large',
    composedFor: (aspect) => `The storyboard was composed for ${aspect} — in another frame the scenes re-flow automatically; check the frames above.`,
    rendering: (pct) => `Rendering… ${pct}%`,
    cancel: 'Stop',
    download: 'Download',
    webmNote: 'This browser can’t encode MP4, so the video was saved as WebM. Open ONEFLOW in Chrome or Edge for MP4.',
    styleAuto: 'Auto — ONEFLOW picks the style',
    suggestStyles: 'Suggest styles',
    moreStyles: 'More styles',
    suggestingStyles: (time) => `ONEFLOW is picking styles… ${time}`,
    paceLabels: { calm: 'Calm pace', medium: 'Medium pace', fast: 'Fast pace' },
    fontLabels: { sans: 'Grotesque', display: 'Bold grotesque', serif: 'Serif', mono: 'Monospace' },
    fxLabels: { grain: 'Grain', glow: 'Glow', vignette: 'Vignette', letterbox: 'Letterbox', duotone: 'Duotone' },
    colBrief: 'Brief',
    colBoards: 'Storyboards',
    colRender: 'Render',
    colDone: 'Done',
    styleLabel: 'Video style',
    styleAutoShort: 'Auto',
    scenesDur: (scenes, duration) => `${scenes} scenes · ${duration}s`,
    inQueue: (n) => `rendering: ${n}`,
    open: 'Open',
    toRender: 'Render',
    addVariant: 'Another variant',
    emptyBoards: 'Storyboards appear here. Fill in the brief on the left and press “Create storyboard”.',
    emptyDone: 'Finished videos appear here with a “Download” button.',
    renderSettings: 'Render settings',
    willRender: (w, h, fps) => `You’ll get an MP4 ${w}×${h} at ${fps} fps. Rendering is free.`,
    queued: 'Queued',
    remove: 'Remove',
    dropHere: 'Drag a storyboard here or press “Render” on its card',
    doneHint: 'Finished videos are kept until the page reloads — download the ones you need.',
    close: 'Close',
    previewAt: (aspect) => `Frames in ${aspect} — as they’ll look in the video`,
    renderThis: (label) => `Render · ${label}`,
    customSize: 'Custom size',
    width: 'Width',
    height: 'Height',
    customHint: (min, max) => `Any size from ${min} to ${max} px per side, rounded to even. Scenes re-flow to these proportions.`,
    reference: 'Reference',
    refAdd: 'Upload a reference',
    refAddHint: 'A video or up to 4 images the clip should look like',
    refAnalyzing: (pct) => `Analysing the reference… ${pct}%`,
    refSummary: (shots, duration, pace) => `${shots} shot${shots === 1 ? '' : 's'} · ${duration.toFixed(1)}s · ${pace.toLowerCase()}`,
    refImages: (n) => `${n} image${n === 1 ? '' : 's'} — we’ll mirror the colours and feel`,
    refHint: 'We mirror the cut rhythm, colours, layout, motion and transitions — with your materials and copy. The reference itself never goes into the video.',
    refWithStyle: (style) => `Style “${style}” is selected: the look comes from it, the rhythm and scene structure from the reference.`,
    likeReference: 'Like the reference',
    likeReferenceHint: 'Colours, type and effects follow the reference',
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
    newChat: 'New chat',
    search: 'Search',
    searchPlaceholder: 'Search titles and messages',
    noResults: 'No conversations found',
    localHistory: 'History on this device',
    projects: 'Projects',
    createProjectTitle: 'Create new project',
    projectNamePlaceholder: 'Enter project name',
    namePlaceholder: 'Name',
    noProject: 'No project',
    pinnedSection: 'Pinned',
    todaySection: 'Today',
    yesterdaySection: 'Yesterday',
    earlierSection: 'Earlier',
    archiveSection: 'Archive',
    emptyProject: 'No conversations yet',
    greeting: 'Hey, how can I assist?',
    subtitle: 'Your AI assistant for writing, ideas and documents — from the first draft to a finished result.',
    inputPlaceholder: 'Ask me anything...',
    toolsTooltip: 'Tools',
    sendTooltip: 'Send',
    attachTooltip: 'Attach a file',
    copyTooltip: 'Copy',
    copiedLabel: 'Copied',
    editTooltip: 'Edit',
    editHelp: 'Sending this revision replaces the messages that follow with a new response.',
    regenerateTooltip: 'Regenerate',
    goodResponseTooltip: 'Good response',
    badResponseTooltip: 'Bad response',
    shareTooltip: 'Share',
    shareHelp: 'Copy or download this conversation to send it. No public link is created.',
    exportMd: 'Download conversation (.md)',
    exportJson: 'Download backup (.json)',
    exportAnswerMd: 'Download answer (.md)',
    exportAs: 'Download as',
    exportWord: 'Word (.docx)',
    exportExcel: 'Excel (.xlsx)',
    exportPpt: 'PowerPoint (.pptx)',
    moreTooltip: 'Chat actions',
    renameLabel: 'Rename',
    removeLabel: 'Delete',
    cancelLabel: 'Cancel',
    saveLabel: 'Save',
    createLabel: 'Create Project',
    closeLabel: 'Close',
    collapseSidebarTooltip: 'Collapse sidebar',
    expandSidebarTooltip: 'Open sidebar',
    profileLabel: 'Profile',
    planLabel: 'Subscription',
    moveToProject: 'Move to project',
    unpinLabel: 'Unpin',
    pinLabel: 'Pin',
    restoreLabel: 'Restore from archive',
    archiveAction: 'Archive conversation',
    deleteChatTitle: 'Delete this conversation?',
    deleteProjectTitle: 'Delete this project?',
    deleteChatHelp: 'Messages and attachments in this chat will be removed from this device.',
    deleteProjectHelp: 'Conversations will stay in your history.',
    loadingLabel: 'ONEFLOW is preparing a response...',
    loadingHistory: 'Loading history...',
    storageError: 'Could not save history on this device. Download a backup.',
    loadError: 'Could not read history. Saved data has not been overwritten.',
    retryLabel: 'Retry request',
    downloadDoc: 'Download document (.docx)',
    downloadPres: 'Download presentation (.pptx)',
    preparingFile: 'Preparing file...',
    docCardDocument: 'Word document',
    docCardPresentation: 'PowerPoint deck',
    docCardSpreadsheet: 'Excel spreadsheet',
    docCardShow: 'Show',
    docCardHide: 'Collapse',
    docCardDownload: 'Download',
    docCardOtherFormat: 'Other format',
    fileError:
      'Up to 4 files: PNG, JPG, WebP, TXT, MD, CSV, JSON, DOCX, XLSX, PPTX; 4 MB each, text up to 30,000 characters.',
    legacyOfficeError: 'Legacy Office format. Re-save the file as .docx, .xlsx or .pptx.',
    officeReadError: 'Could not read the file — it may be damaged or password-protected.',
    promptLimit: 'Your message is too long: maximum 30,000 characters.',
    writeQuick: 'Write a Text',
    imagesQuick: 'Create Images',
    newsQuick: 'Latest News',
    videoQuick: 'Generate Video',
    deepSearchLabel: 'Web Search',
    academicLabel: 'Academic',
    developerLabel: 'Developer',
    unavailableWebSearch: 'Web search is not connected in ONEFLOW yet. Attach source text for analysis.',
    modelHelp: 'ONEFLOW currently has one connected model. More models require server integration.',
    writePrompt: 'Help me write a text. First ask about the product, audience, channel and goal.',
    researchPrompt:
      'Help me analyze materials. I will attach sources. Separate facts from assumptions and cite the attached materials.',
    codePrompt: 'Help me with code. First ask about the task, language and expected result.',
    docPrompt: 'Prepare a document. First ask about the topic, goal, audience and structure.',
    quickPromptsLabel: 'Quick prompts',
    quickPrompts: [
      {
        label: 'Ad headlines',
        prompt: 'Write 5 catchy ad headline variants for ',
      },
      {
        label: 'Make more persuasive',
        prompt: 'Rewrite the following text to make it more persuasive and sales-oriented:\n\n',
      },
      {
        label: 'For social media',
        prompt: 'Adapt this text for an Instagram/Telegram post — short, with emoji and a call to action:\n\n',
      },
      {
        label: 'SEO description',
        prompt: 'Write an SEO-optimized product description for a marketplace listing: ',
      },
      {
        label: 'Content plan',
        prompt: 'Put together a one-month social content plan — topics, formats and posting frequency. Niche: ',
      },
      {
        label: 'Proofread',
        prompt: 'Proofread this text for grammar, style, and tone, and suggest edits:\n\n',
      },
    ],
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
    registerTitle: 'Register',
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
    advantages: [
      {
        title: 'Everything for content, in one place',
        description: 'Images, video, text and audio in a single workspace.',
        benefit: 'Fewer tabs, fewer tools to juggle.',
        image: 'step-01.webp',
        imageAlt: 'One workspace for photo, video, text and audio',
      },
      {
        title: 'Chain steps into a process',
        description: 'Combine generation and processing into chains of connected blocks.',
        benefit: 'Easy to repeat familiar tasks.',
        image: 'step-02.webp',
        imageAlt: 'Node chain: source, generation and result',
      },
      {
        title: 'One visual. Any format.',
        description: 'Adapt one image for posts, stories and ad banners.',
        benefit: 'Less manual layout prep.',
        image: 'step-03.webp',
        imageAlt: 'One product in square, vertical and horizontal formats',
      },
      {
        title: 'From idea to a clear plan',
        description: 'Find ideas in TRENDS, write copy and build out a strategy.',
        benefit: "Clearer what to create and why.",
        image: 'step-04.webp',
        imageAlt: 'Campaign plan: audience, message and channels',
      },
      {
        title: 'Compare before you launch',
        description: 'Creative Predictor helps compare visuals and spot weak points.',
        benefit: 'More grounds for picking a creative.',
        image: 'step-05.png',
        imageAlt: 'Two creatives compared on readability and composition',
      },
      {
        title: 'Start from one product photo',
        description: 'Upload a photo to One Launch and get product cards and ad creatives.',
        benefit: 'One source photo, many materials.',
        image: 'step-06.webp',
        imageAlt: 'A product photo becomes a card and an ad banner',
      },
      {
        title: 'Your budget never expires',
        description: 'Unused budget rolls over to next month and stays available for generations.',
        benefit: 'Create at your own pace.',
        image: 'step-08.webp',
        imageAlt: 'Leftover budget carries over to the next month',
      },
      {
        title: 'Up to 25% cheaper generation',
        description: "You're not overpaying middlemen — more of your budget goes to actual generations.",
        benefit: 'More output for the same budget.',
        image: 'step-07.webp',
        imageAlt: 'Up to 25% savings on generation with ONEFLOW',
      },
    ],
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
    tierFreeDesc: 'Try ONEFLOW and see if it fits your workflow',
    tierPopularDesc: 'Best value for teams generating on a regular basis',
    tierMaxDesc: 'For teams that need access without limits',
    tierFreeIncludes: 'Free plan includes:',
    tierPopularIncludes: 'Everything in Free, plus:',
    tierMaxIncludes: 'Everything in Popular, plus:',
    popularBadge: 'Popular',
    yearlySaveBadge: 'Save 20%',
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
  consent: {
    title: 'Analytics',
    text: 'We use analytics to see which features get used and what breaks. Nothing is stored on your device until you agree.',
    policyLink: 'Privacy policy',
    accept: 'Accept',
    decline: 'Decline',
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
    recentNew: 'New project',
    recentNav: 'Recent',
    recentHint: 'Projects save themselves — open one and pick up where you left off.',
    recentNodes: (count) => `${count} ${count === 1 ? 'node' : 'nodes'}`,
    recentJustNow: 'just now',
    recentMinutes: (n) => `${n} min ago`,
    recentHours: (n) => `${n} h ago`,
    recentDays: (n) => (n <= 1 ? 'yesterday' : `${n} days ago`),
    recentDelete: 'Delete project',
    recentDeleteConfirm: 'Delete?',
    autosaveQuotaError: 'Not enough space for autosave — remove projects you no longer need under Recent.',
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
  home: {
    navLabel: 'Home',
    greetingMorning: 'Good morning! Coffee’s ready —',
    greetingDay: 'Good afternoon! Perfect time',
    greetingEvening: 'Good evening! A couple of creatives',
    greetingNight: 'Can’t sleep? Then',
    greetingAccentMorning: 'ideas will be too',
    greetingAccentDay: 'to launch something',
    greetingAccentEvening: 'before bed?',
    greetingAccentNight: 'let’s create in peace',
    resume: (mode) => `Welcome back. Last time you were working in “${mode}” — continue?`,
    resumeBtn: 'Continue',
    budgetLeft: 'left in budget',
    planLabel: 'plan',
    badgeNew: 'New',
    badgeBeta: 'Beta',
    more: 'Learn more',
    prevSlide: 'Previous slide',
    nextSlide: 'Next slide',
    slideN: (n) => `Slide ${n}`,
    video: 'Video',
    slides: [
      { tag: 'New · Motion Engine', title: 'A video from your photos in minutes', text: 'Upload product photos and a brief — ONEFLOW proposes storyboards, you pick the best and send it to render.' },
      { tag: 'One Launch', title: 'One photo — a whole campaign', text: 'Cards for every format and post copy from a single product photo.' },
      { tag: 'Creative Predictor', title: 'Know which creative wins — before launch', text: 'Upload up to 3 variants and get a score plus tips on what to improve.' },
    ],
    searchPlaceholder: 'Search modes',
    searchEmpty: 'Nothing found',
    assets: 'Assets',
    profile: 'Profile',
    modeDescriptions: {
      canvas: 'Build node chains and adapt a creative to every format',
      generate: 'Photo and video from a description — top models in one place',
      text: 'Copy for posts, banners and product cards in your brand voice',
      trends: 'Fresh social trends and ideas on how to use them for your brand',
      evaluate: 'Scores up to 3 creatives before launch and tells you what to fix',
      onelaunch: 'Product photo → ready campaign: cards per format plus copy',
      musicaudio: 'A track from a description, or a voiceover in a voice you pick',
      motion: 'A video from your photos: brief → storyboards → render',
      strategy: 'A marketing strategy for your goal: sales, leads or reach',
    },
  },
  ux: {
    attachReference: 'Reference',
    tryExample: 'Try:',
    genIntroTitle: 'What shall we create?',
    genIntroText: 'Describe an image or a video in words, pick a model and format, then hit Generate.',
    imageExamples: [
      'Perfume bottle on wet black stone, studio light',
      'Takeaway coffee on a windowsill, morning sun, film look',
      'Sneakers floating on a pastel background, 3D',
    ],
    videoExamples: [
      'Slow orbit around a soda can covered in droplets',
      'Steam rising from a coffee cup, macro, soft light',
      'Smartphone spinning on a podium, neon rim light',
    ],
    musicEmptyTitle: 'Your track will appear here',
    speechEmptyTitle: 'Your voiceover will appear here',
    musicExamples: ['Energetic pop-rock for a sneaker ad', 'Chill lo-fi for a coffee shop', 'Epic orchestral trailer'],
    evalDropTitle: 'Drop up to 3 creative variants',
    evalDropHint: 'or click to choose files · PNG, JPG',
    evalNeedImage: 'Add at least one variant to get a score',
    unlocksAfter: (step) => `Unlocks after step ${step}`,
    productPhotoCta: 'Upload a product photo',
    launchNeedPhoto: 'Upload a product photo to launch (step 1)',
    launchNeedName: 'Add the product name (step 2)',
    launchNeedSetup: 'Pick formats and a colour palette (steps 4–5)',
    goalDesc: {
      sales: 'Purchases and revenue: offer, price, path to checkout',
      leads: 'Requests and contacts: forms, calls, messages',
      awareness: 'Reach and brand recall',
    },
    pickGoal: 'Pick a goal to continue',
    canvasEmptyTitle: 'The canvas is empty',
    canvasEmptyText: 'Add a node from the left panel or start from a ready-made scheme:',
    launchEmptyTitle: 'Your campaign will appear here',
    launchEmptyText: 'Go through the 5 steps on the left to get cards for the chosen formats and post copy.',
    optional: 'optional',
    formatLabel: 'Format',
    resultsTitle: 'Results',
    genRefHintImage: 'Photo reference: product, style or composition — the model will build on it.',
    genRefHintVideo: 'For video: start and end frames, reference images or a reference video.',
    genNeedPrompt: 'Write a prompt to start',
    genResultsHint: 'click a card — prompt, model, “Regenerate”, “Download”',
    genSteps: [
      'Describe the idea: product, background, mood, on-image text',
      'Pick a model, format and quality — or keep the defaults',
      'Hit “Generate” — the results will show up here',
    ],
    variantN: (n) => `Variant ${n}`,
    stepDone: 'done',
    replace: 'Replace',
    productPhotoHint: 'PNG or JPG, ideally on a plain background',
    postN: (n) => `Post ${n}`,
    campaignTitle: 'Your campaign',
    strategyEmptyTitle: 'Your plan will appear here',
    strategyEmptyText:
      'Answer 2 questions — ONEFLOW will break down the business and build a marketing strategy: audience, offer, message, channels and creatives. Then turn it into a node flow in one click.',
    strategySections: ['Your business', 'Who to sell to', 'What to offer', 'What to say', 'Where to promote', 'What to create'],
    motionEmptyTitle: 'Storyboards will appear here',
    motionEmptyText: 'Fill in the brief on the left and press “Make storyboard” — ONEFLOW will suggest video variants. Send the best one to render.',
    motionSteps: [
      'Upload product photos and describe the task',
      'Get storyboards — open one to watch the preview',
      'Drag the best one to “Render” and download the MP4',
    ],
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
    insufficientBalance: 'Insufficient balance for this generation. Top up your balance to continue.',
    sendFailed: 'Could not send.',
    userNotFound: 'No user found with that email.',
    quotaExceeded: 'Not enough credits. Top up your balance to continue.',
    tooManyJobs: 'Too many generations at once — wait for the current ones to finish.',
    emailNotConfirmed: 'Confirm your email via the link we sent you to use generation.',
    jobTooExpensive: 'This request is too expensive for a single generation — lower the duration or resolution.',
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
      runPipeline: 'Run pipeline',
      pipelineHint: 'Generate the photo and turn it into a video in one go',
      pipelineImageStage: 'Step 1 of 2: generating the photo...',
      pipelineVideoStage: 'Step 2 of 2: generating the video...',
      pipelineOneImageError:
        'The Image generation node must produce exactly one photo — set the variant count to 1 and run again.',
      pipelineImagePromptError: 'The Image generation node has an empty prompt — fill it in before running the pipeline.',
      pipelineImageFailed: 'The photo failed to generate — the pipeline stopped and no video was started.',
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
