import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { handleDockMouseMove, handleDockMouseLeave } from './dockHover';
import PromptNode from './nodes/PromptNode';
import ImageGenNode from './nodes/ImageGenNode';
import VideoGenNode from './nodes/VideoGenNode';
import VideoGenProNode from './nodes/VideoGenProNode';
import AdaptNode from './nodes/AdaptNode';
import ImageInputNode from './nodes/ImageInputNode';
import VectorGenNode from './nodes/VectorGenNode';
import SettingsModal from './components/SettingsModal';
import AboutModal from './components/AboutModal';
import ProfileModal from './components/ProfileModal';
import ContextMenu, { type ContextMenuOption } from './components/ContextMenu';
import DropdownMenu from './components/DropdownMenu';
import AiAssistantPanel from './components/AiAssistantPanel';
import TextWorkPanel from './components/TextWorkPanel';
import AdminMessageToast from './components/AdminMessageToast';
import AdminSendMessageModal from './components/AdminSendMessageModal';
import BudgetBar from './components/BudgetBar';
import Logo from './components/Logo';
import PaymentModal from './components/PaymentModal';
import QuickGenPanel from './components/QuickGenPanel';
import EvaluationPanel from './components/EvaluationPanel';
import OneLaunchPanel from './components/OneLaunchPanel';
import MusicAudioPanel from './components/MusicAudioPanel';
import AssetsPanel from './components/AssetsPanel';
import BackgroundRemoverModal from './components/BackgroundRemoverModal';
import UpscalerModal from './components/UpscalerModal';
import PhotoEditorModal from './components/PhotoEditorModal';
import StartScreen, { type StartScreenChoice } from './components/StartScreen';
import ReloadGuard from './components/ReloadGuard';
import { BUSINESS_PRESET_ORDER, BUSINESS_PRESET_PROMPTS, type BusinessPresetKey } from './businessPresets';
import {
  IconDocument,
  IconImage,
  IconSparkles,
  IconVideo,
  IconCrop,
  IconSave,
  IconFolderOpen,
  IconSettings,
  IconInfo,
  IconChat,
  IconVector,
  IconUser,
  IconSend,
  IconFlow,
  IconCreditCard,
  IconGauge,
  IconRocket,
  IconTool,
  IconMusic,
  IconAssetsFolder,
} from './components/Icons';
import {
  VIDEO_MODEL_META,
  VIDEO_PRO_MODEL,
  IMAGE_MODEL_META,
  ADAPT_PRESETS,
  IMAGE_REFERENCE_SLOTS,
  ADMIN_EMAIL,
  type ChatMessage,
} from './types';
import { ProjectIdContext } from './store/projectContext';
import { SubscriptionContext } from './store/subscriptionContext';
import ArchiveStrip from './components/ArchiveStrip';
import { parseAssistantReply, type AssistantAction, type AssistantNodeType } from './aiActions';
import { useT, type Translations } from './i18n';
import { useThemeStore } from './theme';
import { saveProjectToYandexDisk } from './webApi';
import { formatGenerationError } from './errorMessages';
import './App.css';

const nodeTypes = {
  prompt: PromptNode,
  imageGen: ImageGenNode,
  videoGen: VideoGenNode,
  videoGenPro: VideoGenProNode,
  adapt: AdaptNode,
  imageInput: ImageInputNode,
  vector: VectorGenNode,
};

type AddableNodeType =
  | 'prompt'
  | 'imageGen'
  | 'videoGen'
  | 'videoGenPro'
  | 'adapt'
  | 'imageInput'
  | 'vector';

// Full set (incl. "Адаптация") — used by the right-click canvas menu. A function (not a
// module-level constant) since the labels come from useT(), which only exists inside a
// component.
function buildAddNodeOptions(t: Translations): ContextMenuOption<AddableNodeType>[] {
  return [
    { type: 'prompt', label: t.nodeLabels.prompt, icon: IconDocument },
    { type: 'imageInput', label: t.nodeLabels.image, icon: IconImage },
    { type: 'imageGen', label: t.nodeLabels.imageGen, icon: IconSparkles },
    { type: 'vector', label: t.nodeLabels.vector, icon: IconVector },
    { type: 'videoGen', label: t.nodeLabels.videoGen, icon: IconVideo },
    { type: 'videoGenPro', label: t.nodeLabels.videoGenPro, icon: IconVideo },
    { type: 'adapt', label: t.nodeLabels.adapt, icon: IconCrop },
  ];
}

const defaultAdaptFormats = [
  { id: 'fmt-square', label: 'Instagram 1:1', width: 1080, height: 1080 },
  { id: 'fmt-story', label: 'Stories 9:16', width: 1080, height: 1920 },
  { id: 'fmt-wide', label: 'YouTube 16:9', width: 1280, height: 720 },
];

const NODE_ID_PREFIX: Record<AddableNodeType, string> = {
  prompt: 'prompt',
  imageGen: 'image',
  videoGen: 'video',
  videoGenPro: 'videoPro',
  adapt: 'adapt',
  imageInput: 'imageInput',
  vector: 'vector',
};

// Shared by the sidebar/context-menu "add node" flow and the AI assistant's node-chain
// creation, so both produce nodes with the same shape the node components expect.
function buildDefaultNodeData(type: AddableNodeType): Record<string, unknown> {
  if (type === 'prompt') return { value: '' };
  if (type === 'imageGen') {
    return {
      model: 'google/nano-banana-pro',
      manualPrompt: '',
      aspectRatio: '1:1',
      resolution: IMAGE_MODEL_META['google/nano-banana-pro'].resolutions[0].value,
      variantCount: 1,
      saveFormat: 'png',
      status: 'idle',
      outputs: [],
    };
  }
  if (type === 'vector') {
    return {
      manualPrompt: '',
      aspectRatio: '1:1',
      status: 'idle',
      outputs: [],
    };
  }
  if (type === 'videoGen') {
    return {
      model: 'bytedance/seedance-2.0',
      manualPrompt: '',
      aspectRatio: '16:9',
      duration: 5,
      resolution: VIDEO_MODEL_META['bytedance/seedance-2.0'].resolutions[0],
      status: 'idle',
      outputs: [],
    };
  }
  if (type === 'videoGenPro') {
    return {
      manualPrompt: '',
      aspectRatio: '16:9',
      duration: 5,
      resolution: VIDEO_MODEL_META[VIDEO_PRO_MODEL].resolutions[0],
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
      status: 'idle',
      outputs: [],
    };
  }
  if (type === 'adapt') {
    return {
      formats: defaultAdaptFormats.map((f) => ({ ...f })),
      manualImageUrl: '',
      note: '',
      saveFormat: 'png',
      status: 'idle',
      results: {},
    };
  }
  return { outputs: [], manualUrl: '' };
}

// Output ("source") handle id per node type — prompt/imageGen/imageInput/videoGen each
// expose exactly one; "adapt" is terminal and has no source handle at all.
const SOURCE_HANDLE_BY_TYPE: Record<AssistantNodeType, string | null> = {
  prompt: 'text',
  imageGen: 'image',
  imageInput: 'image',
  videoGen: 'video',
  adapt: null,
};

function resolveTargetHandle(
  targetType: AssistantNodeType,
  sourceType: AssistantNodeType,
  explicit: string | undefined,
  usedSlots: Set<string>
): string | null {
  if (explicit) return explicit;
  if (targetType === 'imageGen') {
    if (sourceType === 'prompt') return 'prompt';
    for (let i = 0; i < IMAGE_REFERENCE_SLOTS; i++) {
      if (!usedSlots.has(`ref-${i}`)) return `ref-${i}`;
    }
    return null;
  }
  if (targetType === 'videoGen') return sourceType === 'prompt' ? 'prompt' : 'image';
  if (targetType === 'adapt') return 'image';
  return null;
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}-${Date.now().toString(36)}`;

let projectIdCounter = 0;
const nextProjectId = () => `project-${++projectIdCounter}-${Date.now().toString(36)}`;

interface Project {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  assistantMessages: ChatMessage[];
  assistantDraft: string;
}

// Node layouts behind the start screen's tile choices — each wires a minimal ready-to-run
// chain rather than dropping in disconnected nodes, so picking a tile lands on a canvas that
// already does something. Node data comes from buildDefaultNodeData (the same defaults the
// toolbar/context-menu "add node" flow uses) so these never drift from a plain added node.
function buildPhotoGenNodesEdges(): { nodes: Node[]; edges: Edge[] } {
  const promptId = nextId('prompt');
  const imageId = nextId('image');
  return {
    nodes: [
      { id: promptId, type: 'prompt', position: { x: 60, y: 160 }, data: buildDefaultNodeData('prompt') },
      {
        id: imageId,
        type: 'imageGen',
        position: { x: 460, y: 60 },
        data: buildDefaultNodeData('imageGen'),
      },
    ],
    edges: [{ id: `e-${promptId}-${imageId}`, source: promptId, target: imageId, targetHandle: 'prompt' }],
  };
}

function buildPhotoAdaptNodesEdges(): { nodes: Node[]; edges: Edge[] } {
  const imageInputId = nextId('imageInput');
  const adaptId = nextId('adapt');
  return {
    nodes: [
      {
        id: imageInputId,
        type: 'imageInput',
        position: { x: 60, y: 160 },
        data: buildDefaultNodeData('imageInput'),
      },
      { id: adaptId, type: 'adapt', position: { x: 460, y: 60 }, data: buildDefaultNodeData('adapt') },
    ],
    edges: [
      { id: `e-${imageInputId}-${adaptId}`, source: imageInputId, target: adaptId, targetHandle: 'image' },
    ],
  };
}

function buildVideoGenNodesEdges(): { nodes: Node[]; edges: Edge[] } {
  const promptId = nextId('prompt');
  const videoId = nextId('video');
  return {
    nodes: [
      { id: promptId, type: 'prompt', position: { x: 60, y: 160 }, data: buildDefaultNodeData('prompt') },
      {
        id: videoId,
        type: 'videoGen',
        position: { x: 460, y: 60 },
        data: buildDefaultNodeData('videoGen'),
      },
    ],
    edges: [{ id: `e-${promptId}-${videoId}`, source: promptId, target: videoId, targetHandle: 'prompt' }],
  };
}

// "Для бизнеса" tiles — same Prompt→Генерация фото shape as buildPhotoGenNodesEdges, but with
// the vertical's pre-written prompt already filled in, the settings the user specified
// (nano-banana-pro, 2K, 9:16), and an Image input wired into the first reference slot — every
// one of these prompts operates on "the uploaded photo", so the scheme is useless without it.
// That Image node starts highlighted (see ImageInputNode's highlightUntilFilled) until the
// user actually attaches a photo.
function buildBusinessPresetNodesEdges(prompt: string): { nodes: Node[]; edges: Edge[] } {
  const promptId = nextId('prompt');
  const imageInputId = nextId('imageInput');
  const imageId = nextId('image');
  return {
    nodes: [
      { id: promptId, type: 'prompt', position: { x: 60, y: 60 }, data: { value: prompt } },
      {
        id: imageInputId,
        type: 'imageInput',
        position: { x: 60, y: 300 },
        data: { ...buildDefaultNodeData('imageInput'), highlightUntilFilled: true },
      },
      {
        id: imageId,
        type: 'imageGen',
        position: { x: 460, y: 160 },
        data: {
          ...buildDefaultNodeData('imageGen'),
          model: 'google/nano-banana-pro',
          resolution: '2K',
          aspectRatio: '9:16',
        },
      },
    ],
    edges: [
      { id: `e-${promptId}-${imageId}`, source: promptId, target: imageId, targetHandle: 'prompt' },
      { id: `e-${imageInputId}-${imageId}`, source: imageInputId, target: imageId, targetHandle: 'ref-0' },
    ],
  };
}

function makeBlankProject(name: string): Project {
  return {
    id: nextProjectId(),
    name,
    nodes: [],
    edges: [],
    assistantMessages: [],
    assistantDraft: '',
  };
}

function Canvas() {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const ADD_NODE_OPTIONS = buildAddNodeOptions(t);
  const SIDEBAR_ADD_NODE_OPTIONS = ADD_NODE_OPTIONS.filter((opt) => opt.type !== 'adapt');
  // Shared between the start screen's "Для бизнеса" tab and the toolbar's «Шаблоны» dropdown —
  // both list the same 5 verticals and produce the same node scheme when clicked.
  const businessTileLabels: Record<BusinessPresetKey, string> = {
    horeca: t.startScreen.businessHoreca,
    auto: t.startScreen.businessAuto,
    apartment: t.startScreen.businessApartment,
    furniture: t.startScreen.businessFurniture,
    electronics: t.startScreen.businessElectronics,
  };
  const [projects, setProjects] = useState<Project[]>(() => [makeBlankProject(t.toolbar.projectName(1))]);
  const [activeProjectId, setActiveProjectId] = useState(() => projects[0].id);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [mainView, setMainView] = useState<
    'canvas' | 'text' | 'generate' | 'evaluate' | 'onelaunch' | 'musicaudio' | 'assets'
  >('canvas');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [adminMessageOpen, setAdminMessageOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [bgRemoverOpen, setBgRemoverOpen] = useState(false);
  const [upscalerOpen, setUpscalerOpen] = useState(false);
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [showStartScreen, setShowStartScreen] = useState(true);
  const [subscriptionActive, setSubscriptionActive] = useState(true);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [saveToast, setSaveToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flowPosition: { x: number; y: number };
  } | null>(null);
  const positionRef = useRef({ x: 300, y: 300 });
  const { screenToFlowPosition, fitView } = useReactFlow();

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const [nodes, setNodes, onNodesChange] = useNodesState(activeProject.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(activeProject.edges);

  useEffect(() => {
    setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? { ...p, nodes, edges } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, activeProjectId]);

  useEffect(() => {
    window.api.getAuthStatus().then((status) => setAuthEmail(status.email));
  }, []);

  const refreshSubscriptionStatus = useCallback(async (): Promise<boolean> => {
    const status = await window.api.getSubscriptionStatus();
    setSubscriptionActive(status.active);
    setCheckoutUrl(status.checkoutUrl);
    return status.active;
  }, []);

  useEffect(() => {
    void refreshSubscriptionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPayment = useCallback(() => setPaymentModalOpen(true), []);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const switchProject = (id: string) => {
    if (id === activeProjectId) return;
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    setActiveProjectId(id);
    setNodes(target.nodes);
    setEdges(target.edges);
  };

  const addProjectTab = () => {
    const project = makeBlankProject(t.toolbar.projectName(projects.length + 1));
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setNodes(project.nodes);
    setEdges(project.edges);
  };

  const closeProjectTab = (id: string) => {
    if (projects.length <= 1) return;
    const idx = projects.findIndex((p) => p.id === id);
    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    if (id === activeProjectId) {
      const next = remaining[Math.max(0, idx - 1)];
      setActiveProjectId(next.id);
      setNodes(next.nodes);
      setEdges(next.edges);
    }
  };

  const renameProject = (id: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  // Web mode saves to the user's own Yandex Disk (see ReloadGuard, which uses the same call) —
  // a plain local-file download is unreliable in a hosted/embedded browser tab and gives no
  // in-app confirmation either way, which is why this used to look like it "did nothing".
  // Electron keeps saving to a local file via window.api, unchanged.
  const handleSaveProject = async () => {
    if (import.meta.env.VITE_WEB_MODE === '1') {
      try {
        const path = await saveProjectToYandexDisk({ name: activeProject.name, nodes, edges });
        setSaveToast({ ok: true, message: `${t.toolbar.saveProjectSuccess}: ${path}` });
      } catch (err) {
        setSaveToast({
          ok: false,
          message: window.api.isYandexDiskConnected()
            ? formatGenerationError(err) || t.toolbar.saveProjectError
            : t.reloadGuard.notConnectedError,
        });
      }
      window.setTimeout(() => setSaveToast(null), 4000);
      return;
    }
    await window.api.saveProjectFile({ name: activeProject.name, nodes, edges });
  };

  // Generous fit-view padding (React Flow's own default is 0.1) so nodes never sit flush
  // against the viewport edge — F zooms out enough to leave real breathing room.
  const FIT_VIEW_PADDING = 0.25;

  // Ctrl+F — lays nodes out left-to-right by dependency depth (BFS over edges), stacking
  // same-depth nodes in a column. A capped step count keeps a cyclic graph from looping.
  // Column widths and row heights are each node's own measured/resized size (not a fixed
  // grid cell), so a node bigger than the old fixed cell can no longer overlap its neighbors.
  const alignNodes = useCallback(() => {
    if (nodes.length === 0) return;
    const incoming = new Map<string, number>();
    nodes.forEach((n) => incoming.set(n.id, 0));
    edges.forEach((e) => incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1));

    const adjacency = new Map<string, string[]>();
    edges.forEach((e) => {
      if (!adjacency.has(e.source)) adjacency.set(e.source, []);
      adjacency.get(e.source)!.push(e.target);
    });

    const column = new Map<string, number>();
    const queue: string[] = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
    queue.forEach((id) => column.set(id, 0));
    let head = 0;
    let steps = 0;
    const maxSteps = nodes.length * (nodes.length + 4);
    while (head < queue.length && steps < maxSteps) {
      steps++;
      const id = queue[head++];
      const col = column.get(id) ?? 0;
      for (const targetId of adjacency.get(id) ?? []) {
        const nextCol = col + 1;
        if ((column.get(targetId) ?? -1) < nextCol) {
          column.set(targetId, nextCol);
          queue.push(targetId);
        }
      }
    }
    nodes.forEach((n) => {
      if (!column.has(n.id)) column.set(n.id, 0);
    });

    const GAP_X = 64;
    const GAP_Y = 48;
    const DEFAULT_WIDTH = 320;
    const DEFAULT_HEIGHT = 220;
    const nodeWidth = (n: Node) => n.measured?.width ?? n.width ?? DEFAULT_WIDTH;
    const nodeHeight = (n: Node) => n.measured?.height ?? n.height ?? DEFAULT_HEIGHT;

    const nodesByColumn = new Map<number, Node[]>();
    nodes.forEach((n) => {
      const col = column.get(n.id) ?? 0;
      if (!nodesByColumn.has(col)) nodesByColumn.set(col, []);
      nodesByColumn.get(col)!.push(n);
    });

    const maxColumn = Math.max(...Array.from(column.values()));
    const columnX = new Map<number, number>();
    let xCursor = 0;
    for (let col = 0; col <= maxColumn; col++) {
      columnX.set(col, xCursor);
      const widestInColumn = (nodesByColumn.get(col) ?? []).reduce(
        (max, n) => Math.max(max, nodeWidth(n)),
        DEFAULT_WIDTH
      );
      xCursor += widestInColumn + GAP_X;
    }

    const positions = new Map<string, { x: number; y: number }>();
    nodesByColumn.forEach((colNodes, col) => {
      let yCursor = 0;
      for (const n of colNodes) {
        positions.set(n.id, { x: columnX.get(col)!, y: yCursor });
        yCursor += nodeHeight(n) + GAP_Y;
      }
    });

    setNodes((current) =>
      current.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))
    );
    window.requestAnimationFrame(() => fitView({ duration: 300, padding: FIT_VIEW_PADDING }));
  }, [nodes, edges, setNodes, fitView]);

  // F / Ctrl+F / Ctrl+S — matches the hint printed in the bottom-left corner of the canvas.
  // Ignored while typing in a field so "f" in a prompt doesn't trigger fit-view.
  // Keyed off e.code (the physical key position, e.g. "KeyF") rather than e.key (the
  // character the layout produces) — e.key would be a Cyrillic letter with a Russian layout
  // active, silently breaking every shortcut for exactly this app's target audience.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target?.isContentEditable);
      if (isEditable) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyS') {
        e.preventDefault();
        void handleSaveProject();
      } else if (mod && e.code === 'KeyF') {
        e.preventDefault();
        alignNodes();
      } else if (!mod && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        fitView({ duration: 300, padding: FIT_VIEW_PADDING });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveProject, alignNodes, fitView]);

  const handleOpenProject = async () => {
    const file = await window.api.openProjectFile();
    if (!file) return;
    const project: Project = {
      id: nextProjectId(),
      name: file.name || t.toolbar.importedProjectName,
      nodes: file.nodes as Node[],
      edges: file.edges as Edge[],
      assistantMessages: [],
      assistantDraft: '',
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setNodes(project.nodes);
    setEdges(project.edges);
  };

  const handleSaveWorkspace = async () => {
    await window.api.saveWorkspaceFile({
      projects: projects.map((p) => ({ id: p.id, name: p.name, nodes: p.nodes, edges: p.edges })),
    });
  };

  const handleOpenWorkspace = async () => {
    const file = await window.api.openWorkspaceFile();
    if (!file || !file.projects?.length) return;
    const loaded: Project[] = file.projects.map((p) => ({
      id: nextProjectId(),
      name: p.name,
      nodes: p.nodes as Node[],
      edges: p.edges as Edge[],
      assistantMessages: [],
      assistantDraft: '',
    }));
    setProjects(loaded);
    setActiveProjectId(loaded[0].id);
    setNodes(loaded[0].nodes);
    setEdges(loaded[0].edges);
  };

  const addNode = (type: AddableNodeType, explicitPosition?: { x: number; y: number }) => {
    let position: { x: number; y: number };
    if (explicitPosition) {
      position = explicitPosition;
    } else {
      positionRef.current = {
        x: positionRef.current.x + 40,
        y: positionRef.current.y + 40,
      };
      position = { ...positionRef.current };
    }
    const node: Node = {
      id: nextId(NODE_ID_PREFIX[type]),
      type,
      data: buildDefaultNodeData(type),
      position,
    };
    setNodes((nds) => nds.concat(node));
  };

  const executeAssistantActions = useCallback(
    (actions: AssistantAction[]): number => {
      const refMap = new Map<string, { id: string; nodeType: AssistantNodeType }>();
      const newNodes: Node[] = [];
      const connections: Connection[] = [];
      const usedTargetSlots = new Map<string, Set<string>>();
      const cursor = { ...positionRef.current };

      for (const action of actions) {
        if (action.type !== 'addNode') continue;
        cursor.x += 340;
        const id = nextId(NODE_ID_PREFIX[action.nodeType]);
        const data = { ...buildDefaultNodeData(action.nodeType), ...(action.data ?? {}) };
        newNodes.push({ id, type: action.nodeType, data, position: { ...cursor } });
        refMap.set(action.refId, { id, nodeType: action.nodeType });
      }

      for (const action of actions) {
        if (action.type !== 'connect') continue;
        const source = refMap.get(action.from);
        const target = refMap.get(action.to);
        if (!source || !target) continue;
        const sourceHandle = SOURCE_HANDLE_BY_TYPE[source.nodeType];
        if (!sourceHandle) continue;
        const used = usedTargetSlots.get(target.id) ?? new Set<string>();
        const targetHandle = resolveTargetHandle(
          target.nodeType,
          source.nodeType,
          action.targetHandle,
          used
        );
        if (!targetHandle) continue;
        used.add(targetHandle);
        usedTargetSlots.set(target.id, used);
        connections.push({ source: source.id, target: target.id, sourceHandle, targetHandle });
      }

      if (newNodes.length === 0) return 0;
      positionRef.current = cursor;
      setNodes((nds) => nds.concat(newNodes));
      setEdges((eds) => connections.reduce((acc, conn) => addEdge(conn, acc), eds));
      return newNodes.length;
    },
    [setNodes, setEdges]
  );

  // Start screen tile choices — the app boots into a blank project already, so "Пустой
  // документ" just dismisses the overlay; the other three drop a ready-wired node pair into
  // that same starting project.
  const handleStartScreenChoice = (choice: StartScreenChoice) => {
    if (choice !== 'empty') {
      const { nodes: presetNodes, edges: presetEdges } =
        choice === 'photoGen'
          ? buildPhotoGenNodesEdges()
          : choice === 'photoAdapt'
            ? buildPhotoAdaptNodesEdges()
            : buildVideoGenNodesEdges();
      setNodes(presetNodes);
      setEdges(presetEdges);
    }
    setShowStartScreen(false);
  };

  // "Для бизнеса" tile choice — same shape as handleStartScreenChoice, just fed a
  // vertical-specific prompt instead of branching on a fixed set of layouts.
  const handleStartScreenBusinessChoice = (prompt: string) => {
    const { nodes: presetNodes, edges: presetEdges } = buildBusinessPresetNodesEdges(prompt);
    setNodes(presetNodes);
    setEdges(presetEdges);
    setShowStartScreen(false);
  };

  // "Авто создание нод с ИИ ассистентом" on the start screen — reuses the same assistant
  // pipeline as the in-canvas AI panel (generateChat in 'assistant' mode + parseAssistantReply)
  // rather than a separate endpoint, so both surfaces stay in sync automatically.
  const handleStartScreenAutoCreate = async (promptText: string) => {
    const reply = await window.api.generateChat([{ role: 'user', content: promptText }], undefined, 'assistant');
    const { actions } = parseAssistantReply(reply);
    if (!actions || actions.length === 0) throw new Error('Assistant reply had no node actions');
    const created = executeAssistantActions(actions);
    if (created === 0) throw new Error('Assistant actions created no nodes');
    setShowStartScreen(false);
  };

  const addAdaptWithPreset = async (presetKey: string) => {
    const preset = await window.api.getAdaptPreset(presetKey);
    const source = preset.length > 0 ? preset : defaultAdaptFormats;
    const formats = source.map((f, i) => ({
      id: `fmt-${presetKey}-${i}-${Date.now().toString(36)}`,
      label: f.label,
      width: f.width,
      height: f.height,
    }));
    positionRef.current = { x: positionRef.current.x + 40, y: positionRef.current.y + 40 };
    const node: Node = {
      id: nextId('adapt'),
      type: 'adapt',
      position: { ...positionRef.current },
      data: {
        formats,
        manualImageUrl: '',
        note: '',
        saveFormat: 'png',
        status: 'idle',
        results: {},
      },
    };
    setNodes((nds) => nds.concat(node));
  };

  const setAssistantMessages = (messages: ChatMessage[]) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProjectId ? { ...p, assistantMessages: messages } : p))
    );
  };

  const setAssistantDraft = (draft: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProjectId ? { ...p, assistantDraft: draft } : p))
    );
  };

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const clientX = 'clientX' in event ? event.clientX : 0;
      const clientY = 'clientY' in event ? event.clientY : 0;
      setContextMenu({
        x: clientX,
        y: clientY,
        flowPosition: screenToFlowPosition({ x: clientX, y: clientY }),
      });
    },
    [screenToFlowPosition]
  );

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onCanvasDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onCanvasDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length === 0) return;
      const basePosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNodes: Node[] = [];
      for (let i = 0; i < files.length; i++) {
        const dataUrl = await readFileAsDataUrl(files[i]);
        newNodes.push({
          id: nextId('imageInput'),
          type: 'imageInput',
          position: { x: basePosition.x + i * 30, y: basePosition.y + i * 30 },
          data: { outputs: [dataUrl], manualUrl: '' },
        });
      }
      setNodes((nds) => nds.concat(newNodes));
    },
    [screenToFlowPosition, setNodes]
  );

  return (
    <div className={`app-shell${import.meta.env.VITE_WEB_MODE === '1' ? ' web-mode' : ''}`}>
      <div className={`top-toolbar${mainView === 'canvas' ? ' dot-grid-bg' : ''}`}>
        <div className="toolbar-left">
          <div className="toolbar-menu-wrapper">
            <button
              className="toolbar-label-btn"
              onClick={() => {
                setTemplatesMenuOpen(false);
                setToolsMenuOpen(false);
                setFileMenuOpen((v) => !v);
              }}
            >
              <IconSave size={13} /> {t.toolbar.file} ▾
            </button>
            {fileMenuOpen && (
              <DropdownMenu
                align="left"
                onClose={() => setFileMenuOpen(false)}
                items={[
                  { label: t.toolbar.saveProject, icon: IconSave, onClick: handleSaveProject },
                  { label: t.toolbar.openProject, icon: IconFolderOpen, onClick: handleOpenProject },
                  {
                    label: t.toolbar.saveWorkspace,
                    icon: IconSave,
                    onClick: handleSaveWorkspace,
                  },
                  {
                    label: t.toolbar.openWorkspace,
                    icon: IconFolderOpen,
                    onClick: handleOpenWorkspace,
                  },
                ]}
              />
            )}
          </div>
          <div className="toolbar-menu-wrapper">
            <button
              className="toolbar-label-btn"
              onClick={() => {
                setFileMenuOpen(false);
                setToolsMenuOpen(false);
                setTemplatesMenuOpen((v) => !v);
              }}
            >
              <IconFlow size={13} /> {t.toolbar.templates} ▾
            </button>
            {templatesMenuOpen && (
              <DropdownMenu
                align="left"
                onClose={() => setTemplatesMenuOpen(false)}
                items={[
                  { type: 'header', label: t.toolbar.templatesBusinessSection },
                  ...BUSINESS_PRESET_ORDER.map((key) => ({
                    label: businessTileLabels[key],
                    onClick: () => handleStartScreenBusinessChoice(BUSINESS_PRESET_PROMPTS[key]),
                  })),
                  { type: 'header', label: t.toolbar.templatesMarketplacesSection },
                ]}
              />
            )}
          </div>
          <div className="toolbar-menu-wrapper">
            <button
              className="toolbar-label-btn"
              onClick={() => {
                setFileMenuOpen(false);
                setTemplatesMenuOpen(false);
                setToolsMenuOpen((v) => !v);
              }}
            >
              <IconTool size={13} /> {t.tools.menuLabel} ▾
            </button>
            {toolsMenuOpen && (
              <DropdownMenu
                align="left"
                onClose={() => setToolsMenuOpen(false)}
                items={[
                  { label: t.tools.bgRemoverLabel, icon: IconTool, onClick: () => setBgRemoverOpen(true) },
                  { label: t.tools.upscalerLabel, icon: IconTool, onClick: () => setUpscalerOpen(true) },
                  { label: t.tools.photoEditorLabel, icon: IconTool, onClick: () => setPhotoEditorOpen(true) },
                ]}
              />
            )}
          </div>
        </div>
        <div className="toolbar-brand">
          <Logo className="toolbar-logo" />
        </div>
        <div className="toolbar-group toolbar-right">
          {!subscriptionActive && (
            <button className="toolbar-pay-btn" onClick={() => setPaymentModalOpen(true)}>
              <IconCreditCard size={13} /> {t.paymentModal.topBarBtn}
            </button>
          )}
          <button
            className="toolbar-dsp-btn"
            onClick={() => window.api.openDsp()}
            title={t.toolbar.dspTooltip}
          >
            DSP
          </button>
          {authEmail === ADMIN_EMAIL && (
            <button
              className="toolbar-icon-btn toolbar-icon-btn-ghost"
              onClick={() => setAdminMessageOpen(true)}
              title={t.toolbar.sendMessageTooltip}
            >
              <IconSend />
            </button>
          )}
          <button
            className="toolbar-icon-btn toolbar-icon-btn-ghost"
            onClick={() => setSettingsOpen(true)}
            title={t.toolbar.settingsTooltip}
          >
            <IconSettings />
          </button>
          <button
            className="toolbar-icon-btn toolbar-icon-btn-ghost"
            onClick={() => setAboutOpen(true)}
            title={t.toolbar.aboutTooltip}
          >
            <IconInfo />
          </button>
          <button
            className="toolbar-avatar-btn"
            onClick={() => setProfileOpen(true)}
            title={t.toolbar.profileTooltip}
          >
            <IconUser />
          </button>
        </div>
      </div>
      <div className="main-area">
        <div className={`topbar${mainView === 'canvas' ? ' dot-grid-bg' : ''}`}>
          {mainView === 'canvas' && (
          <div className="project-tabs">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`project-tab ${p.id === activeProjectId ? 'active' : ''}`}
                onClick={() => switchProject(p.id)}
                onDoubleClick={() => setEditingTabId(p.id)}
              >
                {editingTabId === p.id ? (
                  <input
                    className="project-tab-input"
                    autoFocus
                    defaultValue={p.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameProject(p.id, e.target.value.trim() || p.name);
                      setEditingTabId(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="project-tab-label">{p.name}</span>
                )}
                {projects.length > 1 && (
                  <button
                    className="project-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeProjectTab(p.id);
                    }}
                    title={t.toolbar.closeProjectTooltip}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              className="project-tab-add"
              onClick={addProjectTab}
              title={t.toolbar.newProjectTooltip}
            >
              +
            </button>
          </div>
          )}
          <div className="mode-switch-pill">
            <button
              className={`mode-switch-tab ${mainView === 'canvas' ? 'active' : ''}`}
              onClick={() => setMainView('canvas')}
            >
              <IconFlow size={13} /> {t.modeSwitch.nodesAndAdapt}
            </button>
            <button
              className={`mode-switch-tab ${mainView === 'generate' ? 'active' : ''}`}
              onClick={() => setMainView('generate')}
            >
              <IconSparkles size={13} /> {t.modeSwitch.quickGeneration}
            </button>
            <button
              className={`mode-switch-tab ${mainView === 'text' ? 'active' : ''}`}
              onClick={() => setMainView('text')}
            >
              <IconChat size={13} /> {t.modeSwitch.textWork}
            </button>
            {import.meta.env.VITE_WEB_MODE === '1' && (
              <button
                className={`mode-switch-tab ${mainView === 'evaluate' ? 'active' : ''}`}
                onClick={() => setMainView('evaluate')}
              >
                <IconGauge size={13} /> {t.modeSwitch.evaluation}
              </button>
            )}
            {import.meta.env.VITE_WEB_MODE === '1' && (
              <button
                className={`mode-switch-tab ${mainView === 'onelaunch' ? 'active' : ''}`}
                onClick={() => setMainView('onelaunch')}
              >
                <IconRocket size={13} /> {t.modeSwitch.oneLaunch}
              </button>
            )}
            {import.meta.env.VITE_WEB_MODE === '1' && (
              <button
                className={`mode-switch-tab ${mainView === 'musicaudio' ? 'active' : ''}`}
                onClick={() => setMainView('musicaudio')}
              >
                <IconMusic size={13} /> {t.modeSwitch.musicAudio}
              </button>
            )}
          </div>
          <div className="topbar-right">
            {import.meta.env.VITE_WEB_MODE === '1' && (
              <button className="toolbar-label-btn assets-btn" onClick={() => setMainView('assets')}>
                <IconAssetsFolder size={15} /> {t.assets.buttonLabel}
              </button>
            )}
            <BudgetBar />
          </div>
        </div>
        <div className="canvas-area" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
          <div className="canvas-toolbar">
            <div
              className="toolbar-group"
              onMouseMove={handleDockMouseMove}
              onMouseLeave={handleDockMouseLeave}
            >
              {SIDEBAR_ADD_NODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <div key={opt.type} className="toolbar-icon-wrap" data-dock-wrap>
                    <button
                      className="toolbar-icon-btn"
                      onClick={() => addNode(opt.type)}
                      title={opt.label}
                      data-dock-item
                    >
                      <Icon />
                    </button>
                    <span className="toolbar-icon-label">{opt.label}</span>
                  </div>
                );
              })}
              <div className="toolbar-icon-wrap" data-dock-wrap>
                <button
                  className="toolbar-icon-btn ai-assistant-btn"
                  onClick={() => setAiAssistantOpen(true)}
                  title={t.nodeLabels.aiAssistantTooltip}
                  data-dock-item
                >
                  <IconChat />
                </button>
                <span className="toolbar-icon-label">{t.nodeLabels.aiAssistantTooltip}</span>
              </div>
            </div>
            <div className="toolbar-divider" />
            <div
              className="toolbar-group"
              onMouseMove={handleDockMouseMove}
              onMouseLeave={handleDockMouseLeave}
            >
              {ADAPT_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  className="toolbar-label-btn"
                  onClick={() => addAdaptWithPreset(preset.key)}
                  data-dock-item
                >
                  <IconCrop size={13} />{' '}
                  {preset.key === 'RSYA' ? t.nodes.modelMeta.yandexNetwork : preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="hotkey-hint">
            <span>{t.hotkeys.fitView}</span>
            <span>{t.hotkeys.alignNodes}</span>
            <span>{t.hotkeys.saveProject}</span>
          </div>
          <ProjectIdContext.Provider value={activeProjectId}>
          <SubscriptionContext.Provider value={{ active: subscriptionActive, requestPayment }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: FIT_VIEW_PADDING }}
              colorMode="light"
              deleteKeyCode={['Delete', 'Backspace']}
              onPaneContextMenu={onPaneContextMenu}
              onPaneClick={() => setContextMenu(null)}
              onMoveStart={() => setContextMenu(null)}
            >
              <Background gap={20} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {aiAssistantOpen && mainView === 'canvas' && (
              <AiAssistantPanel
                messages={activeProject.assistantMessages}
                draft={activeProject.assistantDraft}
                onMessagesChange={setAssistantMessages}
                onDraftChange={setAssistantDraft}
                onClose={() => setAiAssistantOpen(false)}
                onExecuteActions={executeAssistantActions}
              />
            )}
            {mainView === 'canvas' && import.meta.env.VITE_WEB_MODE !== '1' && (
              <ArchiveStrip projectId={activeProjectId} />
            )}
          </SubscriptionContext.Provider>
          </ProjectIdContext.Provider>
          <TextWorkPanel active={mainView === 'text'} />
          <QuickGenPanel
            active={mainView === 'generate'}
            projectId={activeProjectId}
            subscriptionActive={subscriptionActive}
            onRequestPayment={requestPayment}
          />
          {import.meta.env.VITE_WEB_MODE === '1' && (
            <EvaluationPanel active={mainView === 'evaluate'} />
          )}
          {import.meta.env.VITE_WEB_MODE === '1' && (
            <OneLaunchPanel active={mainView === 'onelaunch'} />
          )}
          {import.meta.env.VITE_WEB_MODE === '1' && (
            <MusicAudioPanel active={mainView === 'musicaudio'} />
          )}
          {import.meta.env.VITE_WEB_MODE === '1' && <AssetsPanel active={mainView === 'assets'} />}
        </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={ADD_NODE_OPTIONS}
          onSelect={(type) => addNode(type, contextMenu.flowPosition)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {adminMessageOpen && <AdminSendMessageModal onClose={() => setAdminMessageOpen(false)} />}
      {bgRemoverOpen && <BackgroundRemoverModal onClose={() => setBgRemoverOpen(false)} />}
      {upscalerOpen && <UpscalerModal onClose={() => setUpscalerOpen(false)} />}
      {photoEditorOpen && <PhotoEditorModal onClose={() => setPhotoEditorOpen(false)} />}
      {paymentModalOpen && (
        <PaymentModal
          checkoutUrl={checkoutUrl}
          onClose={() => setPaymentModalOpen(false)}
          onRecheck={refreshSubscriptionStatus}
        />
      )}
      {showStartScreen && (
        <StartScreen
          onChoose={handleStartScreenChoice}
          onChooseBusiness={handleStartScreenBusinessChoice}
          onAutoCreate={handleStartScreenAutoCreate}
          onClose={() => handleStartScreenChoice('empty')}
        />
      )}
      {import.meta.env.VITE_WEB_MODE === '1' && (
        <ReloadGuard projectName={activeProject.name} nodes={nodes} edges={edges} />
      )}
      {saveToast && (
        <div className={`save-toast ${saveToast.ok ? 'ok' : 'error'}`}>{saveToast.message}</div>
      )}
      <AdminMessageToast />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
