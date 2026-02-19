
import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import MastodonTicker from './components/MastodonTicker';
import WeatherDisplay from './components/WeatherDisplay';
import { ToastContainer, useToast } from './components/Toast';
import {
  Search, Plus, Upload, Moon, Sun, Menu,
  Trash2, Edit2, Loader2, Cloud, CheckCircle2, AlertCircle,
  Pin, Settings, Lock, CloudCog, Github, GitFork, GripVertical, Save, CheckSquare, LogOut, ExternalLink
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, WebDavConfig, AIConfig, SearchMode, ExternalSearchSource, SearchConfig, PasswordExpiryConfig, IconConfig, AppConfig, WeatherConfig, MastodonConfig } from './types';
import { parseBookmarks } from './services/bookmarkParser';
import { DEFAULT_ICON_CONFIG } from './src/constants';
import { configManager, loadAppConfig, saveAppConfig, getAppConfig, getWebDavConfig, getSearchConfig, getIconConfig, getViewMode, getUIConfig, getAIConfig, getWebsiteConfig, getMastodonConfig, getWeatherConfig, updateWebDavConfig, updateSearchConfig, updateIconConfig, updateMastodonConfig, updateWeatherConfig, updateViewMode, updateUIConfig, updateAIConfig, updateWebsiteConfig, syncConfigToKV, syncConfigFromKV } from './src/utils/configManager';
import { extractColorFromImage, generateColorFromText, ExtractedColor } from './src/utils/colorExtractor';
import Icon from './components/Icon';
import CardSkeleton from './components/CardSkeleton';
import ErrorBoundary from './components/ErrorBoundary';

// 懒加载大型 Modal 组件
const LinkModal = lazy(() => import('./components/LinkModal'));
const AuthModal = lazy(() => import('./components/AuthModal'));
const CategoryManagerModal = lazy(() => import('./components/CategoryManagerModal'));
const BackupModal = lazy(() => import('./components/BackupModal'));
const CategoryAuthModal = lazy(() => import('./components/CategoryAuthModal'));
const ImportModal = lazy(() => import('./components/ImportModal'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const SearchConfigModal = lazy(() => import('./components/SearchConfigModal'));
const ContextMenu = lazy(() => import('./components/ContextMenu'));
const QRCodeModal = lazy(() => import('./components/QRCodeModal'));

// --- 配置项 ---
// 项目核心仓库地址
const GITHUB_REPO_URL = 'https://github.com/eallion/favorite';

const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
const AUTH_KEY = 'cloudnav_auth_token';
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';
const SEARCH_CONFIG_KEY = 'cloudnav_search_config';

function App() {
  // --- Toast ---
  const { toasts, removeToast, success, error, warning, info } = useToast();

  // --- State ---
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  // Selected Category State - 动态默认值
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    const uiConfig = getUIConfig();
    const showPinned = uiConfig?.showPinnedWebsites ?? true;

    // 如果显示置顶网站，默认选择 'all'
    if (showPinned) {
      return 'all';
    }

    // 如果隐藏置顶网站，选择第一个可用的分类
    // 这里暂时返回 'all'，因为在组件初始化时 categories 还是空的
    // 我们需要在 useEffect 中处理这个逻辑
    return 'all';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    // 优先级：1. 用户个人偏好 > 2. 默认浅色模式
    const savedTheme = localStorage.getItem('cloudnav_theme_preference');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme === 'dark';
    }
    // 默认使用浅色模式，不跟随系统设置
    return false;
  });

  // 初始化时立即应用主题，避免闪烁
  useEffect(() => {
    // 确保初始化时立即应用主题，避免闪烁
    const savedTheme = localStorage.getItem('cloudnav_theme_preference');
    const isDark = savedTheme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  // 监听 darkMode 变化并应用到 document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark'); // 额外添加 data-theme 属性以防万一
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-theme');
    }
  }, [darkMode]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search Mode State
  const [searchMode, setSearchMode] = useState<SearchMode>('internal');
  const [externalSearchSources, setExternalSearchSources] = useState<ExternalSearchSource[]>([]);
  const [isLoadingSearchConfig, setIsLoadingSearchConfig] = useState(true);

  // Category Security State
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // WebDAV Config State
  const [webDavConfig, setWebDavConfig] = useState<WebDavConfig>({
      url: '',
      username: '',
      password: '',
      enabled: false
  });

  // AI Config State - 使用配置管理器
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
      // 加载统一配置并获取 AI 配置
      const appConfig = loadAppConfig();
      return getAIConfig() || {
          provider: 'gemini',
          apiKey: import.meta.env.VITE_API_KEY || '',
          baseUrl: '',
          model: 'gemini-2.5-flash'
      };
  });

  // Icon Config State
  const [iconConfig, setIconConfig] = useState<IconConfig>(() => {
      const saved = localStorage.getItem('cloudnav_icon_config');
      if (saved) {
          try {
              return JSON.parse(saved);
          } catch (e) {
              console.error('Failed to parse icon config:', e);
          }
      }
      return DEFAULT_ICON_CONFIG;
  });

  // Mastodon Config State - 从服务器配置加载
  const [mastodonConfig, setMastodonConfig] = useState<MastodonConfig>({
    enabled: false,
    instance: '',
    username: '',
    limit: 10,
    exclude_replies: true,
    exclude_reblogs: false,
    pinned: false
  });

  // Weather Config State - 从服务器配置加载
  const [weatherConfig, setWeatherConfig] = useState<WeatherConfig>({
    enabled: false,
    apiHost: 'devapi.qweather.com',
    apiKey: '',
    location: '101010100',
    unit: 'celsius'
  });

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);

  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  // State for data pre-filled from Bookmarklet
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);

  // Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null); // null 表示未检查，true 表示需要认证，false 表示不需要
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Sort State
  const [isSortingMode, setIsSortingMode] = useState<string | null>(null); // 存储正在排序的分类 ID，null 表示不在排序模式
  const [isSortingPinned, setIsSortingPinned] = useState(false); // 是否正在排序置顶链接

  // Batch Edit State
  const [isBatchEditMode, setIsBatchEditMode] = useState(false); // 是否处于批量编辑模式
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set()); // 选中的链接 ID 集合

  // View Mode State
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>(() => {
    // 优先级：1. 用户个人偏好（仅视图模式） > 2. 管理员设置的默认值 > 3. 系统默认简约版
    const savedViewMode = localStorage.getItem('cloudnav_view_mode_preference');
    const viewConfig = getViewMode();
    const defaultViewMode = viewConfig?.defaultMode || 'compact';

    // 如果用户有个人偏好设置，优先使用（仅限视图模式）
    if (savedViewMode === 'detailed' || savedViewMode === 'compact') {
      return savedViewMode;
    }
    // 否则使用管理员设置的默认值
    return defaultViewMode;
  });

  // Pinned Websites Visibility State - 从服务器配置加载
  const [showPinnedWebsites, setShowPinnedWebsites] = useState(() => {
    const uiConfig = getUIConfig();
    return uiConfig?.showPinnedWebsites ?? true;
  });

  // 动态处理置顶网站设置变化时的分类切换
  useEffect(() => {
    if (showPinnedWebsites && selectedCategory !== 'all') {
      // 显示置顶网站时，切换到 'all'
      setSelectedCategory('all');
    } else if (!showPinnedWebsites && selectedCategory === 'all') {
      // 隐藏置顶网站时，切换到 'common'
      setSelectedCategory('common');
    }
  }, [showPinnedWebsites]);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    link: LinkItem | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    link: null
  });

  // QR Code Modal State
  const [qrCodeModal, setQrCodeModal] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({
    isOpen: false,
    url: '',
    title: ''
  });

  // Mobile Search State
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // Category Action Auth State
  const [categoryActionAuth, setCategoryActionAuth] = useState<{
    isOpen: boolean;
    action: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  }>({
    isOpen: false,
    action: 'edit',
    categoryId: '',
    categoryName: ''
  });

  // Password Expiry Config State - 使用配置管理器
  const [passwordExpiryConfig, setPasswordExpiryConfig] = useState<PasswordExpiryConfig>(() => {
      const appConfig = loadAppConfig();
      const websiteConfig = getWebsiteConfig();
      return websiteConfig?.passwordExpiry || { value: 1, unit: 'week' };
  });

  // 服务器配置加载状态
  const [isServerConfigLoaded, setIsServerConfigLoaded] = useState(false);

  // 颜色缓存状态
  const [linkColors, setLinkColors] = useState<Map<string, ExtractedColor>>(new Map());

  // --- Helpers & Sync Logic ---

  const loadFromLocal = () => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        let loadedCategories = parsed.categories || DEFAULT_CATEGORIES;

        // 确保"常用推荐"分类始终存在，并确保它是第一个分类
        if (!loadedCategories.some(c => c.id === 'common')) {
          loadedCategories = [
            { id: 'common', name: '常用推荐', icon: 'Star' },
            ...loadedCategories
          ];
        } else {
          // 如果"常用推荐"分类已存在，确保它是第一个分类
          const commonIndex = loadedCategories.findIndex(c => c.id === 'common');
          if (commonIndex > 0) {
            const commonCategory = loadedCategories[commonIndex];
            loadedCategories = [
              commonCategory,
              ...loadedCategories.slice(0, commonIndex),
              ...loadedCategories.slice(commonIndex + 1)
            ];
          }
        }

        // 检查是否有链接的 categoryId 不存在于当前分类中，将这些链接移动到"常用推荐"
        const validCategoryIds = new Set(loadedCategories.map(c => c.id));
        let loadedLinks = parsed.links || INITIAL_LINKS;
        loadedLinks = loadedLinks.map(link => {
          if (!validCategoryIds.has(link.categoryId)) {
            return { ...link, categoryId: 'common' };
          }
          return link;
        });

        setLinks(loadedLinks);
        setCategories(loadedCategories);
      } catch (e) {
        setLinks(INITIAL_LINKS);
        setCategories(DEFAULT_CATEGORIES);
      }
    } else {
      setLinks(INITIAL_LINKS);
      setCategories(DEFAULT_CATEGORIES);
    }
  };

  const syncToCloud = async (newLinks: LinkItem[], newCategories: Category[], token: string) => {
    setSyncStatus('saving');
    try {
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': token
            },
            body: JSON.stringify({ links: newLinks, categories: newCategories })
        });

        if (response.status === 401) {
            // 检查是否是密码过期
            try {
                const errorData = await response.json();
                if (errorData.error && errorData.error.includes('过期')) {
                    error('您的密码已过期，请重新登录');
                } else {
                    warning('管理操作需要密码验证');
                }
            } catch (e) {
                // 如果无法解析错误信息，使用默认提示
                console.error('Failed to parse error response', e);
                warning('管理操作需要密码验证');
            }

            setAuthToken(null);
            localStorage.removeItem(AUTH_KEY);
            setIsAuthOpen(true);
            setSyncStatus('error');
            return false;
        }

        if (!response.ok) throw new Error('Network response was not ok');

        setSyncStatus('saved');
        setTimeout(() => setSyncStatus('idle'), 2000);
        return true;
    } catch (error) {
        console.error("Sync failed", error);
        setSyncStatus('error');
        return false;
    }
  };

  const updateData = (newLinks: LinkItem[], newCategories: Category[]) => {
      // 1. Optimistic UI Update
      setLinks(newLinks);
      setCategories(newCategories);

      // 2. Save to Local Cache
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: newLinks, categories: newCategories }));

      // 3. Sync to Cloud (if authenticated)
      if (authToken) {
          syncToCloud(newLinks, newCategories, authToken);
      } else {
          // 如果未登录，提示用户需要密码才能保存到云端
          if (requiresAuth) {
              warning('请先登录才能保存数据到云端');
              setIsAuthOpen(true);
          }
      }
  };

  // --- Context Menu Functions ---
  const handleContextMenu = (event: React.MouseEvent, link: LinkItem) => {
    // 在批量编辑模式下禁用右键菜单
    if (isBatchEditMode) return;

    // 未登录状态下显示浏览器默认右键菜单
    if (!authToken) return;

    // 只有登录用户才阻止默认行为并显示自定义菜单
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      link: link
    });
  };

  const closeContextMenu = () => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      link: null
    });
  };

  const copyLinkToClipboard = () => {
    if (!contextMenu.link) return;

    navigator.clipboard.writeText(contextMenu.link.url)
      .then(() => {
        // 可以添加一个短暂的提示
        console.log('链接已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制链接失败：', err);
      });

    closeContextMenu();
  };

  const showQRCode = () => {
    if (!contextMenu.link) return;

    setQrCodeModal({
      isOpen: true,
      url: contextMenu.link.url,
      title: contextMenu.link.title
    });

    closeContextMenu();
  };

  const editLinkFromContextMenu = () => {
    if (!contextMenu.link) return;

    setEditingLink(contextMenu.link);
    setIsModalOpen(true);
    closeContextMenu();
  };

  const deleteLinkFromContextMenu = () => {
    if (!contextMenu.link) return;

    if (window.confirm(`确定要删除"${contextMenu.link.title}"吗？`)) {
      const newLinks = links.filter(link => link.id !== contextMenu.link!.id);
      updateData(newLinks, categories);
    }

    closeContextMenu();
  };

  const togglePinFromContextMenu = () => {
    if (!contextMenu.link) return;

    const linkToToggle = links.find(l => l.id === contextMenu.link!.id);
    if (!linkToToggle) return;

    // 如果是设置为置顶，则设置 pinnedOrder 为当前置顶链接数量
    // 如果是取消置顶，则清除 pinnedOrder
    const updated = links.map(l => {
      if (l.id === contextMenu.link!.id) {
        const isPinned = !l.pinned;
        return {
          ...l,
          pinned: isPinned,
          pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined
        };
      }
      return l;
    });

    updateData(updated, categories);
    closeContextMenu();
  };

  // 加载链接图标缓存
  const loadLinkIcons = async (linksToLoad: LinkItem[]) => {
    if (!authToken) return; // 只有在已登录状态下才加载图标缓存

    const updatedLinks = [...linksToLoad];
    const domainsToFetch: string[] = [];

    // 收集所有链接的域名（包括已有图标的链接）
    for (const link of updatedLinks) {
      if (link.url) {
        try {
          let domain = link.url;
          if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
            domain = 'https://' + link.url;
          }

          if (domain.startsWith('http://') || domain.startsWith('https://')) {
            const urlObj = new URL(domain);
            domain = urlObj.hostname;
            domainsToFetch.push(domain);
          }
        } catch (e) {
          console.error("Failed to parse URL for icon loading", e);
        }
      }
    }

    // 批量获取图标
    if (domainsToFetch.length > 0) {
      const iconPromises = domainsToFetch.map(async (domain) => {
        try {
          const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.cached && data.icon) {
              return { domain, icon: data.icon };
            }
          }
        } catch (error) {
          console.log(`Failed to fetch cached icon for ${domain}`, error);
        }
        return null;
      });

      const iconResults = await Promise.all(iconPromises);

      // 更新链接的图标
      iconResults.forEach(result => {
        if (result) {
          const linkToUpdate = updatedLinks.find(link => {
            if (!link.url) return false;
            try {
              let domain = link.url;
              if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
                domain = 'https://' + link.url;
              }

              if (domain.startsWith('http://') || domain.startsWith('https://')) {
                const urlObj = new URL(domain);
                return urlObj.hostname === result.domain;
              }
            } catch (e) {
              return false;
            }
            return false;
          });

          if (linkToUpdate) {
            // 只有当链接没有图标，或者当前图标是 faviconextractor.com 生成的，或者缓存中的图标是自定义图标时才更新
            if (!linkToUpdate.icon ||
                linkToUpdate.icon.includes('faviconextractor.com') ||
                !result.icon.includes('faviconextractor.com')) {
              linkToUpdate.icon = result.icon;
            }
          }
        }
      });

      // 更新状态
      setLinks(updatedLinks);
    }
  };

  // --- Effects ---

  useEffect(() => {
    // Listen for authSuccess event
    const handleAuthSuccess = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail && customEvent.detail.token) {
            const token = customEvent.detail.token;
            setAuthToken(token);
            localStorage.setItem(AUTH_KEY, token);
            localStorage.setItem('lastLoginTime', Date.now().toString());
            success('登录成功');
            // 登录成功后重新加载数据以获取最新状态
            // loadFromLocal(); // Optional: might not be needed if state update triggers re-render
        }
    };

    window.addEventListener('authSuccess', handleAuthSuccess);

    return () => {
        window.removeEventListener('authSuccess', handleAuthSuccess);
    };
  }, []);

  useEffect(() => {
    // Theme init
    const savedThemePreference = localStorage.getItem('cloudnav_theme_preference');
    const uiConfig = getUIConfig();
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 优先级：1. 用户个人偏好 > 2. 管理员设置 > 3. 系统默认
    let isDark = systemPrefersDark; // 默认跟随系统

    if (savedThemePreference) {
      // 用户有个人偏好
      isDark = savedThemePreference === 'dark';
    } else if (uiConfig?.defaultTheme) {
      // 使用管理员设置的默认主题
      isDark = uiConfig.defaultTheme === 'dark';
    }

    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Load Token
    const savedToken = localStorage.getItem(AUTH_KEY);
    if (savedToken) {
        // 检查保存的 token 是否仍然有效（密码过期检查）
        const lastLoginTime = localStorage.getItem('lastLoginTime');
        const currentTime = Date.now();

        // 如果有上次登录时间，先检查是否过期
        if (lastLoginTime) {
            const lastLogin = parseInt(lastLoginTime);
            const timeDiff = currentTime - lastLogin;

            // 默认过期时间（1 周），在获取到服务器配置后会更新
            let defaultExpiryMs = 7 * 24 * 60 * 60 * 1000; // 1 周

            // 如果超过默认时间，暂时清除 token，等待服务器配置确认
            if (timeDiff > defaultExpiryMs) {
                localStorage.removeItem(AUTH_KEY);
                localStorage.removeItem('lastLoginTime');
                // 不立即设置 authToken，等待配置加载后再确认是否真的过期
            } else {
                setAuthToken(savedToken);
            }
        } else {
            setAuthToken(savedToken);
        }
    }

    // Load WebDAV Config
    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
        try {
            setWebDavConfig(JSON.parse(savedWebDav));
        } catch (e) {}
    }

    // Handle URL Params for Bookmarklet (Add Link)
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
        const addTitle = urlParams.get('add_title') || '';
        // Clean URL params to avoid re-triggering on refresh
        window.history.replaceState({}, '', window.location.pathname);

        setPrefillLink({
            title: addTitle,
            url: addUrl,
            categoryId: 'common' // Default, Modal will handle selection
        });
        setEditingLink(undefined);
        setIsModalOpen(true);
    }

    // Initial Data Fetch
    const initData = async () => {
        // 首先立即加载本地缓存或初始数据 (stale-while-revalidate 策略)
        loadFromLocal();

        // 然后检查是否需要认证（管理操作）
        try {
            const authRes = await fetch('/api/storage?checkAuth=true');
            if (authRes.ok) {
                const authData = await authRes.json();
                setRequiresAuth(authData.requiresAuth);

                // 公开访问模式：所有用户都可以查看数据，不需要密码
                // 管理操作需要密码
            }
        } catch (e) {
            console.warn("Failed to check auth requirement.", e);
        }

        // 异步获取最新数据并更新缓存 (revalidate)
        let hasCloudData = false;
        try {
            // 使用 readOnly=true 参数，表示只读访问
            const res = await fetch('/api/storage?getConfig=true&readOnly=true');
            if (res.ok) {
                const data = await res.json();
                if (data.links && data.links.length > 0) {
                    setLinks(data.links);
                    setCategories(data.categories || DEFAULT_CATEGORIES);
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));

                    // 加载链接图标缓存
                    loadLinkIcons(data.links);
                    hasCloudData = true;
                }
            } else if (res.status === 401) {
                // 只读模式不应该返回 401，如果返回了说明有错误
                console.error("Read-only access failed unexpectedly");
            }
        } catch (e) {
            console.error("Failed to fetch from cloud:", e);
            // 如果是网络错误或服务器错误，显示更友好的提示
            if (e instanceof Error) {
                if (e.message.includes('Failed to fetch')) {
                    console.error("Network error - please check if the site is deployed correctly");
                } else if (e.message.includes('401') || e.message.includes('403')) {
                    console.error("Authentication error - KV might not be properly configured");
                }
            }
        }

        // 无论是否有云端数据，都尝试从 KV 空间加载搜索配置、网站配置和 AI 配置
        try {
            const searchConfigRes = await fetch('/api/storage?getConfig=search');
            if (searchConfigRes.ok) {
                const searchConfigData = await searchConfigRes.json();
                // 检查搜索配置是否有效（包含必要的字段）
                if (searchConfigData && (searchConfigData.mode || searchConfigData.externalSources || searchConfigData.selectedSource)) {
                    setSearchMode(searchConfigData.mode || 'internal');
                    setExternalSearchSources(searchConfigData.externalSources || []);
                    // 加载已保存的选中搜索源
                    if (searchConfigData.selectedSource) {
                        setSelectedSearchSource(searchConfigData.selectedSource);
                    }
                }
            }

            // 获取网站配置（包括密码过期时间设置）
            const websiteConfigRes = await fetch('/api/storage?getConfig=website');
            if (websiteConfigRes.ok) {
                const websiteConfigData = await websiteConfigRes.json();
                if (websiteConfigData && websiteConfigData.passwordExpiry) {
                    setPasswordExpiryConfig(websiteConfigData.passwordExpiry);

                    // 重新检查之前可能被清除的 token
                    const savedToken = localStorage.getItem(AUTH_KEY);
                    const lastLoginTime = localStorage.getItem('lastLoginTime');

                    if (savedToken && lastLoginTime && !authToken) {
                        const lastLogin = parseInt(lastLoginTime);
                        const currentTime = Date.now();
                        const timeDiff = currentTime - lastLogin;

                        // 计算精确的过期时间
                        let expiryTimeMs = 0;
                        if (websiteConfigData.passwordExpiry.unit === 'day') {
                            expiryTimeMs = websiteConfigData.passwordExpiry.value * 24 * 60 * 60 * 1000;
                        } else if (websiteConfigData.passwordExpiry.unit === 'week') {
                            expiryTimeMs = websiteConfigData.passwordExpiry.value * 7 * 24 * 60 * 60 * 1000;
                        } else if (websiteConfigData.passwordExpiry.unit === 'month') {
                            expiryTimeMs = websiteConfigData.passwordExpiry.value * 30 * 24 * 60 * 60 * 1000;
                        } else if (websiteConfigData.passwordExpiry.unit === 'year') {
                            expiryTimeMs = websiteConfigData.passwordExpiry.value * 365 * 24 * 60 * 60 * 1000;
                        }

                        // 如果实际上没有过期（使用服务器配置的精确时间），恢复 token
                        if (expiryTimeMs === 0 || timeDiff <= expiryTimeMs) {
                            setAuthToken(savedToken);
                        } else {
                            // 确实过期了，清除相关数据
                            localStorage.removeItem(AUTH_KEY);
                            localStorage.removeItem('lastLoginTime');
                        }
                    }
                }
            }

            // 获取AI配置（包含网站设置如title、favicon等）- 这是公开访问的
            const aiConfigRes = await fetch('/api/storage?getConfig=ai');
            if (aiConfigRes.ok) {
                const aiConfigData = await aiConfigRes.json();
                if (aiConfigData) {
                    // 直接设置AI配置，确保服务器配置优先
                    setAiConfig(aiConfigData);

                    // 将网站设置部分单独保存到localStorage，确保所有用户都能看到这些设置
                    const websiteSettings = {
                        websiteTitle: aiConfigData.websiteTitle || '',
                        faviconUrl: aiConfigData.faviconUrl || '',
                        navigationName: aiConfigData.navigationName || ''
                    };
                    localStorage.setItem('cloudnav_website_settings', JSON.stringify(websiteSettings));

                    // 如果服务器有默认视图模式设置，保存到localStorage并清除用户个人偏好
                    if (aiConfigData.defaultViewMode && (aiConfigData.defaultViewMode === 'compact' || aiConfigData.defaultViewMode === 'detailed')) {
                        localStorage.setItem('cloudnav_default_view_mode', aiConfigData.defaultViewMode);
                        // 清除用户的个人视图偏好，让用户使用管理员设置的默认视图
                        localStorage.removeItem('cloudnav_view_mode');
                        // 如果当前状态不匹配，更新状态
                        if (viewMode !== aiConfigData.defaultViewMode) {
                            setViewMode(aiConfigData.defaultViewMode);
                        }
                        console.log('从服务器加载默认视图模式:', aiConfigData.defaultViewMode);
                    }

                    // AI配置的敏感部分只在没有本地配置时才保存
                    const currentLocalConfig = localStorage.getItem(AI_CONFIG_KEY);
                    if (!currentLocalConfig) {
                        const localAiConfig = {
                            provider: aiConfigData.provider || 'gemini',
                            apiKey: '', // 不保存API key到本地
                            baseUrl: aiConfigData.baseUrl || '',
                            model: aiConfigData.model || 'gemini-2.5-flash',
                            ...websiteSettings
                        };
                        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(localAiConfig));
                    }
                }
            }

            // 获取天气配置
            try {
                const weatherConfigRes = await fetch('/api/storage?getConfig=weather');
                if (weatherConfigRes.ok) {
                    const weatherConfigData = await weatherConfigRes.json();
                    if (weatherConfigData && Object.keys(weatherConfigData).length > 0) {
                         setWeatherConfig(prev => ({ ...prev, ...weatherConfigData }));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch weather config", e);
            }

            // 获取 Mastodon 配置
            try {
                const mastodonConfigRes = await fetch('/api/storage?getConfig=mastodon');
                if (mastodonConfigRes.ok) {
                     const mastodonConfigData = await mastodonConfigRes.json();
                     if (mastodonConfigData && Object.keys(mastodonConfigData).length > 0) {
                         setMastodonConfig(prev => ({ ...prev, ...mastodonConfigData }));
                     }
                }
            } catch (e) {
                console.warn("Failed to fetch mastodon config", e);
            }
        } catch (e) {
            console.warn("Failed to fetch configs from KV.", e);
        }

        // 获取Mastodon配置 - 这是公开访问的
        try {
            const mastodonConfigRes = await fetch('/api/storage?getConfig=mastodon');
            if (mastodonConfigRes.ok) {
                const mastodonConfigData = await mastodonConfigRes.json();
                // 无论是否启用都设置配置，让组件自己处理显示逻辑
                setMastodonConfig(mastodonConfigData || {
                    enabled: false,
                    instance: '',
                    username: '',
                    limit: 10,
                    exclude_replies: true,
                    exclude_reblogs: false,
                    pinned: false
                });
            }
        } catch (e) {
            console.warn("Failed to fetch mastodon config from KV.", e);
        }

        // 获取天气配置 - 这是公开访问的
        try {
            const weatherConfigRes = await fetch('/api/storage?getConfig=weather');
            if (weatherConfigRes.ok) {
                const weatherConfigData = await weatherConfigRes.json();
                // 无论是否启用都设置配置，让组件自己处理显示逻辑
                setWeatherConfig(weatherConfigData || {
                    enabled: false,
                    apiHost: 'devapi.qweather.com',
                    apiKey: '',
                    location: '101010100',
                    unit: 'celsius'
                });
            }
        } catch (e) {
            console.warn("Failed to fetch weather config from KV.", e);
        }

        // 如果有云端数据，则不需要加载本地数据
        if (hasCloudData) {
            setIsCheckingAuth(false);
            return;
        }

        // 如果没有云端数据，则加载本地数据
        loadFromLocal();

        // 如果从KV空间加载搜索配置失败，直接使用默认配置（不使用localStorage回退）
        setSearchMode('internal');
        setExternalSearchSources([
            {
                id: 'google',
                name: 'Google',
                url: 'https://www.google.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'bing',
                name: '必应',
                url: 'https://www.bing.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'baidu',
                name: '百度',
                url: 'https://www.baidu.com/s?wd={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'sogou',
                name: '搜狗',
                url: 'https://www.sogou.com/web?query={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'yandex',
                name: 'Yandex',
                url: 'https://yandex.com/search/?text={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'github',
                name: 'GitHub',
                url: 'https://github.com/search?q={query}',
                icon: 'Github',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'linuxdo',
                name: 'Linux.do',
                url: 'https://linux.do/search?q={query}',
                icon: 'Terminal',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'bilibili',
                name: 'B站',
                url: 'https://search.bilibili.com/all?keyword={query}',
                icon: 'Play',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'youtube',
                name: 'YouTube',
                url: 'https://www.youtube.com/results?search_query={query}',
                icon: 'Video',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'wikipedia',
                name: '维基',
                url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                icon: 'BookOpen',
                enabled: true,
                createdAt: Date.now()
            }
        ]);

        setIsLoadingSearchConfig(false);
        setIsCheckingAuth(false);
        setIsServerConfigLoaded(true); // 标记服务器配置已加载完成
        setIsInitialLoading(false);
    };

    initData();
  }, []);

  // Update page title and favicon when AI config changes
  useEffect(() => {
    if (aiConfig.websiteTitle) {
      document.title = aiConfig.websiteTitle;
    }

    if (aiConfig.faviconUrl) {
      // Remove existing favicon links
      const existingFavicons = document.querySelectorAll('link[rel="icon"]');
      existingFavicons.forEach(favicon => favicon.remove());

      // Add new favicon
      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = aiConfig.faviconUrl;
      document.head.appendChild(favicon);
    }
  }, [aiConfig.websiteTitle, aiConfig.faviconUrl]);

  // 监听来自 SettingsModal 的认证请求
  useEffect(() => {
    const handleOpenAuthModal = () => {
      setIsAuthOpen(true);
    };

    window.addEventListener('openAuthModal', handleOpenAuthModal);

    return () => {
      window.removeEventListener('openAuthModal', handleOpenAuthModal);
    };
  }, []);

  // 在服务器配置加载完成后，检查是否需要更新默认视图模式
  useEffect(() => {
    if (!isServerConfigLoaded) return; // 等待服务器配置加载完成

    const savedViewMode = localStorage.getItem('cloudnav_view_mode');
    const defaultViewMode = localStorage.getItem('cloudnav_default_view_mode');

    // 如果用户没有个人偏好，但服务器有默认设置，则应用服务器的默认设置
    if (!savedViewMode && defaultViewMode && (defaultViewMode === 'detailed' || defaultViewMode === 'compact')) {
      setViewMode(defaultViewMode);
      console.log('应用服务器默认视图模式：', defaultViewMode);
    }
  }, [isServerConfigLoaded]); // 依赖服务器配置加载状态

  // 监听置顶网站设置变化
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'cloudnav_show_pinned_websites' && e.newValue !== null) {
        setShowPinnedWebsites(e.newValue === 'true');
      }
    };

    // 监听 localStorage 变化
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 监听退出登录事件
  useEffect(() => {
    const handleAuthStateChanged = async (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail.isAuthenticated === false) {
        // 退出登录，清除认证状态
        setAuthToken(null);
        setSyncStatus('offline');
        setIsCheckingAuth(false);
        setRequiresAuth(null);

        // 重新加载本地数据
        loadFromLocal();
      }
    };

    // 监听自定义事件
    window.addEventListener('authStateChanged', handleAuthStateChanged as EventListener);

    return () => {
      window.removeEventListener('authStateChanged', handleAuthStateChanged as EventListener);
    };
  }, []);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('cloudnav_theme_preference', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('cloudnav_theme_preference', 'light');
    }
  };

  // 视图模式切换处理函数 - 只保存用户个人偏好
  const handleViewModeChange = (mode: 'compact' | 'detailed') => {
    setViewMode(mode);
    // 只保存用户的个人偏好，不影响全局设置
    localStorage.setItem('cloudnav_view_mode_preference', mode);
  };

  // --- Batch Edit Functions ---
  const toggleBatchEditMode = () => {
    setIsBatchEditMode(!isBatchEditMode);
    setSelectedLinks(new Set()); // 退出批量编辑模式时清空选中项
  };

  const toggleLinkSelection = (linkId: string) => {
    setSelectedLinks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(linkId)) {
        newSet.delete(linkId);
      } else {
        newSet.add(linkId);
      }
      return newSet;
    });
  };

  const handleBatchDelete = () => {
    if (!authToken) { setIsAuthOpen(true); return; }

    if (selectedLinks.size === 0) {
      warning('请先选择要删除的链接');
      return;
    }

    if (confirm(`确定要删除选中的 ${selectedLinks.size} 个链接吗？`)) {
      const newLinks = links.filter(link => !selectedLinks.has(link.id));
      updateData(newLinks, categories);
      setSelectedLinks(new Set());
      setIsBatchEditMode(false);
    }
  };

  const handleBatchMove = (targetCategoryId: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }

    if (selectedLinks.size === 0) {
      warning('请先选择要移动的链接');
      return;
    }

    const newLinks = links.map(link =>
      selectedLinks.has(link.id) ? { ...link, categoryId: targetCategoryId } : link
    );
    updateData(newLinks, categories);
    setSelectedLinks(new Set());
    setIsBatchEditMode(false);
  };

  const handleSelectAll = () => {
    // 获取当前显示的所有链接 ID
    const currentLinkIds = displayedLinks.map(link => link.id);

    // 如果已选中的链接数量等于当前显示的链接数量，则取消全选
    if (selectedLinks.size === currentLinkIds.length && currentLinkIds.every(id => selectedLinks.has(id))) {
      setSelectedLinks(new Set());
    } else {
      // 否则全选当前显示的所有链接
      setSelectedLinks(new Set(currentLinkIds));
    }
  };

  // --- Actions ---

  const handleLogin = async (password: string): Promise<boolean> => {
      try {
        // 登录成功后，获取网站配置（包括密码过期时间设置）
        let passwordExpirySettings: PasswordExpiryConfig = { value: 1, unit: 'week' }; // 默认值
        try {
            const websiteConfigRes = await fetch('/api/storage?getConfig=website');
            if (websiteConfigRes.ok) {
                const websiteConfigData = await websiteConfigRes.json();
                if (websiteConfigData && websiteConfigData.passwordExpiry) {
                    passwordExpirySettings = websiteConfigData.passwordExpiry;
                    setPasswordExpiryConfig(passwordExpirySettings);
                }
            }
        } catch (e) {
            console.warn("Failed to fetch website config before login.", e);
        }

        // 检查密码是否过期（在登录前检查）
        const lastLoginTime = localStorage.getItem('lastLoginTime');
        const currentTime = Date.now();

        if (lastLoginTime && passwordExpirySettings.unit !== 'permanent') {
            const lastLogin = parseInt(lastLoginTime);
            const timeDiff = currentTime - lastLogin;

            // 计算过期时间（毫秒）
            let expiryTimeMs = 0;
            if (passwordExpirySettings.unit === 'day') {
                expiryTimeMs = passwordExpirySettings.value * 24 * 60 * 60 * 1000;
            } else if (passwordExpirySettings.unit === 'week') {
                expiryTimeMs = passwordExpirySettings.value * 7 * 24 * 60 * 60 * 1000;
            } else if (passwordExpirySettings.unit === 'month') {
                expiryTimeMs = passwordExpirySettings.value * 30 * 24 * 60 * 60 * 1000;
            } else if (passwordExpirySettings.unit === 'year') {
                expiryTimeMs = passwordExpirySettings.value * 365 * 24 * 60 * 60 * 1000;
            }

            // 如果设置了过期时间且已过期
            if (expiryTimeMs > 0 && timeDiff > expiryTimeMs) {
                // 清除旧的认证信息
                setAuthToken(null);
                localStorage.removeItem(AUTH_KEY);
                localStorage.removeItem('lastLoginTime');
                // 继续登录流程（用新密码）
            }
        }

        // 验证密码
        const authResponse = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': password
            },
            body: JSON.stringify({ authOnly: true }) // 只用于验证密码，不更新数据
        });

        if (authResponse.ok) {
            setAuthToken(password);
            localStorage.setItem(AUTH_KEY, password);
            localStorage.setItem('lastLoginTime', currentTime.toString());
            setIsAuthOpen(false);
            setSyncStatus('saved');

            // 登录成功后，从服务器获取数据
            try {
                const res = await fetch('/api/storage');
                if (res.ok) {
                    const data = await res.json();
                    // 如果服务器有数据，使用服务器数据
                    if (data.links && data.links.length > 0) {
                        setLinks(data.links);
                        setCategories(data.categories || DEFAULT_CATEGORIES);
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));

                        // 加载链接图标缓存
                        loadLinkIcons(data.links);
                    } else {
                        // 如果服务器没有数据，使用本地数据
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links, categories }));
                        // 并将本地数据同步到服务器
                        syncToCloud(links, categories, password);

                        // 加载链接图标缓存
                        loadLinkIcons(links);
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch data after login.", e);
                loadFromLocal();
                // 尝试将本地数据同步到服务器
                syncToCloud(links, categories, password);
            }

            // 登录成功后，从 KV 空间加载 AI 配置
            try {
                const aiConfigRes = await fetch('/api/storage?getConfig=ai');
                if (aiConfigRes.ok) {
                    const aiConfigData = await aiConfigRes.json();
                    if (aiConfigData && Object.keys(aiConfigData).length > 0) {
                        setAiConfig(aiConfigData);
                        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch AI config after login.", e);
            }

            return true;
        }
        return false;
      } catch (e) {
          return false;
      }
  };

  const handleLogout = () => {
      setAuthToken(null);
      localStorage.removeItem(AUTH_KEY);
      setSyncStatus('offline');
      // 退出后重新加载本地数据
      loadFromLocal();
  };

  // 分类操作密码验证处理函数
  const handleCategoryActionAuth = async (password: string): Promise<boolean> => {
    try {
      // 验证密码
      const authResponse = await fetch('/api/storage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-password': password
        },
        body: JSON.stringify({ authOnly: true })
      });

      return authResponse.ok;
    } catch (error) {
      console.error('Category action auth error:', error);
      return false;
    }
  };

  // 打开分类操作验证弹窗
  const openCategoryActionAuth = (action: 'edit' | 'delete', categoryId: string, categoryName: string) => {
    setCategoryActionAuth({
      isOpen: true,
      action,
      categoryId,
      categoryName
    });
  };

  // 关闭分类操作验证弹窗
  const closeCategoryActionAuth = () => {
    setCategoryActionAuth({
      isOpen: false,
      action: 'edit',
      categoryId: '',
      categoryName: ''
    });
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[]) => {
      // Merge categories: Avoid duplicate names/IDs
      const mergedCategories = [...categories];

      // 确保"常用推荐"分类始终存在
      if (!mergedCategories.some(c => c.id === 'common')) {
        mergedCategories.push({ id: 'common', name: '常用推荐', icon: 'Star' });
      }

      newCategories.forEach(nc => {
          if (!mergedCategories.some(c => c.id === nc.id || c.name === nc.name)) {
              mergedCategories.push(nc);
          }
      });

      const mergedLinks = [...links, ...newLinks];
      updateData(mergedLinks, mergedCategories);
      setIsImportModalOpen(false);
      success(`成功导入 ${newLinks.length} 个新书签!`);
  };

  const handleAddLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }

    // 处理 URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }

    // 获取当前分类下的所有链接（不包括置顶链接）
    const categoryLinks = links.filter(link =>
      !link.pinned && (data.categoryId === 'all' || link.categoryId === data.categoryId)
    );

    // 计算新链接的 order 值，使其排在分类最后
    const maxOrder = categoryLinks.length > 0
      ? Math.max(...categoryLinks.map(link => link.order || 0))
      : -1;

    const newLink: LinkItem = {
      ...data,
      url: processedUrl, // 使用处理后的 URL
      id: Date.now().toString(),
      createdAt: Date.now(),
      order: maxOrder + 1, // 设置为当前分类的最大 order 值 +1，确保排在最后
      // 如果是置顶链接，设置 pinnedOrder 为当前置顶链接数量
      pinnedOrder: data.pinned ? links.filter(l => l.pinned).length : undefined
    };

    // 将新链接插入到合适的位置，而不是直接放在开头
    // 如果是置顶链接，放在置顶链接区域的最后
    if (newLink.pinned) {
      const firstNonPinnedIndex = links.findIndex(link => !link.pinned);
      if (firstNonPinnedIndex === -1) {
        // 如果没有非置顶链接，直接添加到末尾
        updateData([...links, newLink], categories);
      } else {
        // 插入到非置顶链接之前
        const updatedLinks = [...links];
        updatedLinks.splice(firstNonPinnedIndex, 0, newLink);
        updateData(updatedLinks, categories);
      }
    } else {
      // 非置顶链接，按照 order 字段排序后插入
      const updatedLinks = [...links, newLink].sort((a, b) => {
        // 置顶链接始终排在前面
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;

        // 同类型链接按照 order 排序
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
      updateData(updatedLinks, categories);
    }

    // Clear prefill if any
    setPrefillLink(undefined);
  };

  const handleEditLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (!editingLink) return;

    // 处理 URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }

    // 更新链接
    const updated = links.map(l => l.id === editingLink.id ? { ...l, ...data, url: processedUrl } : l);
    
    // 去重：确保每个 ID 只存在一次，保留最新的记录
    const uniqueLinks: LinkItem[] = Array.from(
      updated.reduce((map: Map<string, LinkItem>, link: LinkItem) => {
        map.set(link.id, link); // 后面的会覆盖前面的，保留最新记录
        return map;
      }, new Map<string, LinkItem>()).values()
    );
    
    updateData(uniqueLinks, categories);
    setEditingLink(undefined);
  };

  // 拖拽结束事件处理函数
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // 获取当前分类下的所有链接
      const categoryLinks = links.filter(link =>
        selectedCategory === 'all' || link.categoryId === selectedCategory
      );

      // 找到被拖拽元素和目标元素的索引
      const activeIndex = categoryLinks.findIndex(link => link.id === active.id);
      const overIndex = categoryLinks.findIndex(link => link.id === over.id);

      if (activeIndex !== -1 && overIndex !== -1) {
        // 重新排序当前分类的链接
        const reorderedCategoryLinks = arrayMove(categoryLinks, activeIndex, overIndex);

        // 更新所有链接的顺序
        const updatedLinks = links.map(link => {
          const reorderedIndex = reorderedCategoryLinks.findIndex(l => l.id === link.id);
          if (reorderedIndex !== -1) {
            return { ...link, order: reorderedIndex };
          }
          return link;
        });

        // 按照 order 字段重新排序
        updatedLinks.sort((a, b) => (a.order || 0) - (b.order || 0));

        updateData(updatedLinks, categories);
      }
    }
  };

  // 置顶链接拖拽结束事件处理函数
  const handlePinnedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // 获取所有置顶链接
      const pinnedLinksList = links.filter(link => link.pinned);

      // 找到被拖拽元素和目标元素的索引
      const activeIndex = pinnedLinksList.findIndex(link => link.id === active.id);
      const overIndex = pinnedLinksList.findIndex(link => link.id === over.id);

      if (activeIndex !== -1 && overIndex !== -1) {
        // 重新排序置顶链接
        const reorderedPinnedLinks = arrayMove(pinnedLinksList, activeIndex, overIndex);

        // 创建一个映射，存储每个置顶链接的新 pinnedOrder
        const pinnedOrderMap = new Map<string, number>();
        reorderedPinnedLinks.forEach((link, index) => {
          pinnedOrderMap.set(link.id, index);
        });

        // 只更新置顶链接的 pinnedOrder，不改变任何链接的顺序
        const updatedLinks = links.map(link => {
          if (link.pinned) {
            return {
              ...link,
              pinnedOrder: pinnedOrderMap.get(link.id)
            };
          }
          return link;
        });

        // 按照 pinnedOrder 重新排序整个链接数组，确保置顶链接的顺序正确
        // 同时保持非置顶链接的相对顺序不变
        updatedLinks.sort((a, b) => {
          // 如果都是置顶链接，按照 pinnedOrder 排序
          if (a.pinned && b.pinned) {
            return (a.pinnedOrder || 0) - (b.pinnedOrder || 0);
          }
          // 如果只有一个是置顶链接，置顶链接排在前面
          if (a.pinned) return -1;
          if (b.pinned) return 1;
          // 如果都不是置顶链接，保持原位置不变（按照 order 或 createdAt 排序）
          const aOrder = a.order !== undefined ? a.order : a.createdAt;
          const bOrder = b.order !== undefined ? b.order : b.createdAt;
          return bOrder - aOrder;
        });

        updateData(updatedLinks, categories);
      }
    }
  };

  // 开始排序
  const startSorting = (categoryId: string) => {
    setIsSortingMode(categoryId);
  };

  // 保存排序
  const saveSorting = () => {
    // 在保存排序时，确保将当前排序后的数据保存到服务器和本地存储
    updateData(links, categories);
    setIsSortingMode(null);
  };

  // 取消排序
  const cancelSorting = () => {
    setIsSortingMode(null);
  };

  // 保存置顶链接排序
  const savePinnedSorting = () => {
    // 在保存排序时，确保将当前排序后的数据保存到服务器和本地存储
    updateData(links, categories);
    setIsSortingPinned(false);
  };

  // 取消置顶链接排序
  const cancelPinnedSorting = () => {
    setIsSortingPinned(false);
  };

  // 设置 dnd-kit 的传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 需要拖动 8px 才开始拖拽，避免误触
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDeleteLink = (id: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (confirm('确定删除此链接吗？')) {
      updateData(links.filter(l => l.id !== id), categories);
    }
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!authToken) { setIsAuthOpen(true); return; }

      const linkToToggle = links.find(l => l.id === id);
      if (!linkToToggle) return;

      // 如果是设置为置顶，则设置 pinnedOrder 为当前置顶链接数量
      // 如果是取消置顶，则清除 pinnedOrder
      const updated = links.map(l => {
        if (l.id === id) {
          const isPinned = !l.pinned;
          return {
            ...l,
            pinned: isPinned,
            pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined
          };
        }
        return l;
      });

      updateData(updated, categories);
  };

  const handleSavePasswordExpiryConfig = async (config: PasswordExpiryConfig) => {
    setPasswordExpiryConfig(config);

    // 使用统一的配置管理器更新网站配置
    const currentWebsiteConfig = getWebsiteConfig() || { passwordExpiry: { value: 1, unit: 'week' } };
    const updatedWebsiteConfig = { ...currentWebsiteConfig, passwordExpiry: config };
    updateWebsiteConfig(updatedWebsiteConfig);

    // 只有已登录用户才能同步到服务器
    if (authToken) {
        await syncConfigToKV(authToken);
    }
  };

  const handleSaveIconConfig = (config: IconConfig) => {
    setIconConfig(config);
    localStorage.setItem('cloudnav_icon_config', JSON.stringify(config));
  };

  const handleSaveAIConfig = async (config: AIConfig) => {
      setAiConfig(config);

      // 使用统一的配置管理器保存
      updateAIConfig(config);

      // 只有已登录用户才能同步到服务器
      if (authToken) {
          await syncConfigToKV(authToken);
      }
  };

  const handleRestoreAIConfig = async (config: AIConfig) => {
      setAiConfig(config);

      // 使用统一的配置管理器保存
      updateAIConfig(config);

      // 同时同步到 KV 空间
      if (authToken) {
          await syncConfigToKV(authToken);
      }
  };

  // --- Category Management & Security ---

  // 构建分类树结构
  const buildCategoryTree = (categories: Category[]) => {
    // 分离顶级分类和子分类
    const topLevelCategories = categories.filter(cat => !cat.isSubcategory && !cat.parentId);
    const subcategories = categories.filter(cat => cat.isSubcategory || cat.parentId);

    // 为每个顶级分类构建子分类树
    return topLevelCategories.map(cat => {
      const children = subcategories.filter(sub => sub.parentId === cat.id);
      return {
        ...cat,
        children
      };
    });
  };

  // 递归渲染分类树节点
  const renderCategoryNode = (category: any, level: number = 0) => {
    const isLocked = category.password && !unlockedCategoryIds.has(category.id);
    const hasChildren = category.children && category.children.length > 0;
    const isExpanded = expandedCategories.has(category.id);

    return (
      <div key={category.id}>
        <button
          onClick={() => handleCategoryClick(category)}
          className={`w-full flex items-center cursor-pointer gap-3 px-4 py-2.5 rounded-xl transition-all group ${
            selectedCategory === category.id
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
          style={{ paddingLeft: `${level * 12 + 16}px` }} // 缩进样式
        >
          <div className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${selectedCategory === category.id ? 'bg-blue-100 dark:bg-blue-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
            {isLocked ? <Lock size={16} className="text-amber-500" /> : <Icon name={category.icon} size={16} />}
          </div>
          <span className="truncate flex-1 text-left">{category.name}</span>
          {hasChildren && (
            <span className="text-slate-400">
              {isExpanded ? <Icon name="ChevronDown" size={14} /> : <Icon name="ChevronRight" size={14} />}
            </span>
          )}
          {selectedCategory === category.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
        </button>

        {/* 渲染子分类 */}
        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {category.children.map((child: any) => renderCategoryNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // 切换分类展开/收起状态
  const toggleCategoryExpand = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const handleCategoryClick = (cat: Category) => {
      // If category has password and is NOT unlocked
      if (cat.password && !unlockedCategoryIds.has(cat.id)) {
          setCatAuthModalData(cat);
          setSidebarOpen(false);
          return;
      }

      // Check if category has children
      const children = categories.filter((c: Category) => c.parentId === cat.id);
      if (children.length > 0) {
        // If has children, expand/collapse and select first child
        toggleCategoryExpand(cat.id);
        // Select the first child instead of the parent
        setSelectedCategory(children[0].id);
      } else {
        // If no children, select the category itself
        setSelectedCategory(cat.id);
      }
      setSidebarOpen(false);
  };

  const handleUnlockCategory = (catId: string) => {
      setUnlockedCategoryIds(prev => new Set(prev).add(catId));
      setSelectedCategory(catId);
  };

  const handleUpdateCategories = (newCats: Category[]) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      updateData(links, newCats);
  };

  const handleDeleteCategory = (catId: string) => {
      if (!authToken) { setIsAuthOpen(true); return; }

      // 防止删除"常用推荐"分类
      if (catId === 'common') {
          warning('"常用推荐"分类不能被删除');
          return;
      }

      let newCats = categories.filter(c => c.id !== catId);

      // 检查是否存在"常用推荐"分类，如果不存在则创建它
      if (!newCats.some(c => c.id === 'common')) {
          newCats = [
              { id: 'common', name: '常用推荐', icon: 'Star' },
              ...newCats
          ];
      }

      // Move links to common or first available
      const targetId = 'common';
      const newLinks = links.map(l => l.categoryId === catId ? { ...l, categoryId: targetId } : l);

      updateData(newLinks, newCats);
  };

  // --- WebDAV Config ---
  const handleSaveWebDavConfig = (config: WebDavConfig) => {
      setWebDavConfig(config);
      localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));
  };

  // 搜索源选择弹出窗口状态
  const [showSearchSourcePopup, setShowSearchSourcePopup] = useState(false);
  const [hoveredSearchSource, setHoveredSearchSource] = useState<ExternalSearchSource | null>(null);
  const [selectedSearchSource, setSelectedSearchSource] = useState<ExternalSearchSource | null>(null);
  const [isIconHovered, setIsIconHovered] = useState(false);
  const [isPopupHovered, setIsPopupHovered] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 处理弹出窗口显示/隐藏逻辑
  useEffect(() => {
    if (isIconHovered || isPopupHovered) {
      // 如果图标或弹出窗口被悬停，清除隐藏定时器并显示弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setShowSearchSourcePopup(true);
    } else {
      // 如果图标和弹出窗口都没有被悬停，设置一个延迟隐藏弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setShowSearchSourcePopup(false);
        setHoveredSearchSource(null);
      }, 100);
    }

    // 清理函数
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isIconHovered, isPopupHovered]);

  // 处理搜索源选择
  const handleSearchSourceSelect = async (source: ExternalSearchSource) => {
    // 更新选中的搜索源
    setSelectedSearchSource(source);

    // 保存选中的搜索源到 KV 空间
    await handleSaveSearchConfig(externalSearchSources, searchMode, source);

    if (searchQuery.trim()) {
      const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
      window.open(searchUrl, '_blank');
    }
    setShowSearchSourcePopup(false);
    setHoveredSearchSource(null);
  };

  // --- Mouse tracking for hover cards effect ---
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const linkCards = document.querySelectorAll('.link-card');

      linkCards.forEach((card) => {
        const rect = card.getBoundingClientRect();

        // Calculate center point of the card
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Calculate pointer position relative to center
        const relativeX = event.clientX - centerX;
        const relativeY = event.clientY - centerY;

        // Normalize to -1 to 1 range
        const x = relativeX / (rect.width / 2);
        const y = relativeY / (rect.height / 2);

        // Update CSS custom properties
        (card as HTMLElement).style.setProperty('--pointer-x', x.toFixed(3));
        (card as HTMLElement).style.setProperty('--pointer-y', y.toFixed(3));
      });
    };

    document.addEventListener('pointermove', handlePointerMove);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  // --- UI Config ---
  const handleShowPinnedWebsitesChange = async (show: boolean) => {
    setShowPinnedWebsites(show);

    // 更新到统一配置
    updateUIConfig({ showPinnedWebsites: show });

    // 只有已登录用户才能同步到服务器
    if (authToken) {
      await syncConfigToKV(authToken);
    }
  };

  // --- Mastodon Config ---
  const handleMastodonConfigChange = async (config: Partial<MastodonConfig>) => {
    const updatedConfig = { ...mastodonConfig, ...config };
    setMastodonConfig(updatedConfig);

    // 更新到统一配置
    updateMastodonConfig(updatedConfig);

    // 只有已登录用户才能同步到服务器
    if (authToken) {
      await syncConfigToKV(authToken);
    }
  };

  // --- Weather Config ---
  const handleWeatherConfigChange = async (config: Partial<WeatherConfig>) => {
    const updatedConfig = { ...weatherConfig, ...config };
    setWeatherConfig(updatedConfig);

    // 更新到统一配置
    updateWeatherConfig(updatedConfig);

    // 只有已登录用户才能同步到服务器
    if (authToken) {
      await syncConfigToKV(authToken);
    }
  };

  // --- Search Config ---
  const handleSaveSearchConfig = async (sources: ExternalSearchSource[], mode: SearchMode, selectedSource?: ExternalSearchSource | null) => {
      const searchConfig: SearchConfig = {
          mode,
          externalSources: sources,
          selectedSource: selectedSource !== undefined ? selectedSource : selectedSearchSource
      };

      setExternalSearchSources(sources);
      setSearchMode(mode);
      if (selectedSource !== undefined) {
          setSelectedSearchSource(selectedSource);
      }

      // 保存到 KV 空间（搜索配置需要密码验证）
      if (!authToken) {
          console.error('搜索配置保存需要登录');
          return;
      }

      try {
          const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'x-auth-password': authToken
          };

          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                  saveConfig: 'search',
                  config: searchConfig
              })
          });

          if (!response.ok) {
              console.error('Failed to save search config to KV:', response.statusText);
          }
      } catch (error) {
          console.error('Error saving search config to KV:', error);
      }
  };

  const handleSearchModeChange = (mode: SearchMode) => {
      setSearchMode(mode);

      // 如果切换到外部搜索模式且搜索源列表为空，自动加载默认搜索源
      if (mode === 'external' && externalSearchSources.length === 0) {
          const defaultSources: ExternalSearchSource[] = [
              {
                  id: 'google',
                  name: 'Google',
                  url: 'https://www.google.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'bing',
                  name: '必应',
                  url: 'https://www.bing.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'baidu',
                  name: '百度',
                  url: 'https://www.baidu.com/s?wd={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'sogou',
                  name: '搜狗',
                  url: 'https://www.sogou.com/web?query={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'yandex',
                  name: 'Yandex',
                  url: 'https://yandex.com/search/?text={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'github',
                  name: 'GitHub',
                  url: 'https://github.com/search?q={query}',
                  icon: 'Github',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'linuxdo',
                  name: 'Linux.do',
                  url: 'https://linux.do/search?q={query}',
                  icon: 'Terminal',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'bilibili',
                  name: 'B 站',
                  url: 'https://search.bilibili.com/all?keyword={query}',
                  icon: 'Play',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'youtube',
                  name: 'YouTube',
                  url: 'https://www.youtube.com/results?search_query={query}',
                  icon: 'Video',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'wikipedia',
                  name: '维基',
                  url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                  icon: 'BookOpen',
                  enabled: true,
                  createdAt: Date.now()
              }
          ];

          // 保存默认搜索源到状态和 KV 空间
          handleSaveSearchConfig(defaultSources, mode);
      } else {
          handleSaveSearchConfig(externalSearchSources, mode);
      }
  };

  const handleExternalSearch = () => {
      if (searchQuery.trim() && searchMode === 'external') {
          // 如果搜索源列表为空，自动加载默认搜索源
          if (externalSearchSources.length === 0) {
              const defaultSources: ExternalSearchSource[] = [
                  {
                      id: 'google',
                      name: 'Google',
                      url: 'https://www.google.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'bing',
                      name: '必应',
                      url: 'https://www.bing.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'baidu',
                      name: '百度',
                      url: 'https://www.baidu.com/s?wd={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'sogou',
                      name: '搜狗',
                      url: 'https://www.sogou.com/web?query={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'yandex',
                      name: 'Yandex',
                      url: 'https://yandex.com/search/?text={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'github',
                      name: 'GitHub',
                      url: 'https://github.com/search?q={query}',
                      icon: 'Github',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'linuxdo',
                      name: 'Linux.do',
                      url: 'https://linux.do/search?q={query}',
                      icon: 'Terminal',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'bilibili',
                      name: 'B 站',
                      url: 'https://search.bilibili.com/all?keyword={query}',
                      icon: 'Play',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'youtube',
                      name: 'YouTube',
                      url: 'https://www.youtube.com/results?search_query={query}',
                      icon: 'Video',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'wikipedia',
                      name: '维基',
                      url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                      icon: 'BookOpen',
                      enabled: true,
                      createdAt: Date.now()
                  }
              ];

              // 保存默认搜索源到状态和 KV 空间，并设置 Google 为默认选择
              setSelectedSearchSource(defaultSources[0]); // Google
              handleSaveSearchConfig(defaultSources, 'external');

              // 使用第一个默认搜索源立即执行搜索
              const searchUrl = defaultSources[0].url.replace('{query}', encodeURIComponent(searchQuery));
              window.open(searchUrl, '_blank');
              return;
          }

          // 优先使用第一个启用的搜索源（Google），确保 Google 为默认站外搜索引擎
          let source = selectedSearchSource;
          const enabledSources = externalSearchSources.filter((s: ExternalSearchSource) => s.enabled);
          if (enabledSources.length > 0) {
              // 始终使用第一个启用的搜索源作为站外搜索默认，确保 Google 优先
              source = enabledSources[0];
          }

          if (source) {
              const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
              window.open(searchUrl, '_blank');
          }
      }
  };

  const handleRestoreBackup = (restoredLinks: LinkItem[], restoredCategories: Category[]) => {
      updateData(restoredLinks, restoredCategories);
      setIsBackupModalOpen(false);
  };

  const handleRestoreSearchConfig = (restoredSearchConfig: SearchConfig) => {
      handleSaveSearchConfig(restoredSearchConfig.externalSources, restoredSearchConfig.mode);
  };

  // --- Filtering & Memo ---

  // Helper to check if a category is "Locked" (Has password AND not unlocked)
  const isCategoryLocked = (catId: string) => {
      const cat = categories.find(c => c.id === catId);
      if (!cat || !cat.password) return false;
      return !unlockedCategoryIds.has(catId);
  };

  const pinnedLinks = useMemo(() => {
      // Don't show pinned links if they belong to a locked category
      const filteredPinnedLinks = links.filter(l => l.pinned && !isCategoryLocked(l.categoryId));
      // 按照 pinnedOrder 字段排序，如果没有 pinnedOrder 字段则按创建时间排序
      return filteredPinnedLinks.sort((a, b) => {
        // 如果有 pinnedOrder 字段，则使用 pinnedOrder 排序
        if (a.pinnedOrder !== undefined && b.pinnedOrder !== undefined) {
          return a.pinnedOrder - b.pinnedOrder;
        }
        // 如果只有一个有 pinnedOrder 字段，有 pinnedOrder 的排在前面
        if (a.pinnedOrder !== undefined) return -1;
        if (b.pinnedOrder !== undefined) return 1;
        // 如果都没有 pinnedOrder 字段，则按创建时间排序
        return a.createdAt - b.createdAt;
      });
  }, [links, categories, unlockedCategoryIds]);

  const displayedLinks = useMemo(() => {
    let result = links;

    // Security Filter: Always hide links from locked categories
    result = result.filter(l => !isCategoryLocked(l.categoryId));


    // Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        (l.description && l.description.toLowerCase().includes(q))
      );
    }

    // Category Filter
    if (selectedCategory !== 'all') {
      result = result.filter(l => l.categoryId === selectedCategory);
    }

    // In non-search mode, exclude pinned links since they have their own section
    if (!searchQuery.trim() && selectedCategory === 'all') {
      result = result.filter(l => !l.pinned);
    }

    // 排序逻辑
    return result.sort((a, b) => {
      // 如果在搜索模式下，优先显示置顶链接
      if (searchQuery.trim()) {
        // 置顶的排在前面，非置顶的排在后面
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // 如果都是置顶或都不是置顶，则按 order 或 createdAt 排序
      }
      
      // 按照 order 字段排序，如果没有 order 字段则按创建时间排序
      const aOrder = a.order !== undefined ? a.order : a.createdAt;
      const bOrder = b.order !== undefined ? b.order : b.createdAt;
      // 升序排序，这样 order 值小 (旧卡片) 的排在前面，order 值大 (新卡片) 的排在后面
      return aOrder - bOrder;
    });
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds]);


  // --- Render Components ---

  // 创建可排序的链接卡片组件
  const SortableLinkCard = ({ link }: { link: LinkItem }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: link.id });

    // 根据视图模式决定卡片样式
    const isDetailedView = viewMode === 'detailed';

    // 获取或生成颜色
    const linkColor = linkColors.get(link.id) || (() => {
      let color: ExtractedColor;
      if (link.icon) {
        // 对于有图标的链接，使用默认颜色，稍后异步提取
        color = { hex: '#3b82f6', rgb: '59, 130, 246' };
        // 异步提取颜色
        extractColorFromImage(link.icon).then(extractedColor => {
          if (extractedColor) {
            setLinkColors(prev => new Map(prev.set(link.id, extractedColor)));
          }
        }).catch(() => {
          // 提取失败时使用标题生成颜色
          const generatedColor = generateColorFromText(link.title);
          setLinkColors(prev => new Map(prev.set(link.id, generatedColor)));
        });
      } else {
        // 对于没有图标的链接，根据标题生成颜色
        color = generateColorFromText(link.title);
        setLinkColors(prev => new Map(prev.set(link.id, color)));
      }
      return color;
    })();

    const style = {
      transform: CSS.Transform.toString(transform),
      transition: isDragging ? 'none' : transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 1000 : 'auto',
      '--icon-color': linkColor.hex,
      '--icon-color-rgb': linkColor.rgb
    } as React.CSSProperties;

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`link-card group relative transition-all duration-200 cursor-grab active:cursor-grabbing min-w-0 max-w-full overflow-hidden hover:shadow-lg ${
          isSortingMode || isSortingPinned
            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        } ${isDragging ? 'shadow-2xl scale-105' : ''} ${
          isDetailedView
            ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px]'
            : 'flex items-center rounded-xl border shadow-sm'
        }`}
        {...attributes}
        {...listeners}
      >
        {/* Icon background for hover effect */}
        <div className="icon-bg">
          {link.icon ? (
            <img src={link.icon} alt={`${link.title} background`} />
          ) : (
            <span className="text-6xl opacity-20">{link.title.charAt(0).toUpperCase()}</span>
          )}
        </div>
        {/* 链接内容 - 移除 a 标签，改为 div 防止点击跳转 */}
        <div className={`flex flex-1 min-w-0 overflow-hidden ${
          isDetailedView ? 'flex-col' : 'items-center gap-3'
        }`}>
          {/* 第一行：图标和标题水平排列 */}
          <div className={`flex items-center gap-3 mb-2 ${
            isDetailedView ? '' : 'w-full'
          }`}>
            {/* Icon */}
            <div className={`icon-main text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
              isDetailedView ? 'w-8 h-8 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800' : 'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
            }`}>
                {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-5 h-5" loading="lazy"/> : link.title.charAt(0)}
            </div>

            {/* 标题 */}
            <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
              isDetailedView ? 'text-base' : 'text-sm font-medium text-slate-800 dark:text-slate-200'
            }`} title={link.title}>
                {link.title}
            </h3>
          </div>

          {/* 第二行：描述文字 */}
             {isDetailedView && link.description && (
               <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                 {link.description}
               </p>
             )}
        </div>
      </div>
    );
  };

  const renderLinkCard = (link: LinkItem) => {
    const isSelected = selectedLinks.has(link.id);

    // 根据视图模式决定卡片样式
    const isDetailedView = viewMode === 'detailed';

    // 获取或生成颜色
    const linkColor = linkColors.get(link.id) || (() => {
      let color: ExtractedColor;
      if (link.icon) {
        // 对于有图标的链接，使用默认颜色，稍后异步提取
        color = { hex: '#3b82f6', rgb: '59, 130, 246' };
        // 异步提取颜色
        extractColorFromImage(link.icon).then(extractedColor => {
          if (extractedColor) {
            setLinkColors(prev => new Map(prev.set(link.id, extractedColor)));
          }
        }).catch(() => {
          // 提取失败时使用标题生成颜色
          const generatedColor = generateColorFromText(link.title);
          setLinkColors(prev => new Map(prev.set(link.id, generatedColor)));
        });
      } else {
        // 对于没有图标的链接，根据标题生成颜色
        color = generateColorFromText(link.title);
        setLinkColors(prev => new Map(prev.set(link.id, color)));
      }
      return color;
    })();

    return (
      <div
        key={link.id}
        className={`link-card group relative transition-all duration-200 hover:shadow-lg ${
          isSelected
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        } ${isBatchEditMode ? 'cursor-pointer' : 'cursor-pointer'} ${
          isDetailedView
            ? 'flex flex-col rounded-2xl border shadow-sm p-4 min-h-[100px] items-start justify-start text-left w-full min-w-0'
            : 'flex items-center justify-between rounded-xl border shadow-sm p-3'
        }`}
        style={{
          '--icon-color': linkColor.hex,
          '--icon-color-rgb': linkColor.rgb
        } as React.CSSProperties}
        onClick={(e) => {
          if (isBatchEditMode) {
            toggleLinkSelection(link.id);
          } else {
            // 阻止右键菜单触发
            if (e.button === 0) {
              window.open(link.url, '_blank', 'noopener,noreferrer');
            }
          }
        }}
        onContextMenu={(e) => handleContextMenu(e, link)}
      >
        {/* Icon background for hover effect */}
        <div className="icon-bg">
          {link.icon ? (
            <img src={link.icon} alt={`${link.title} background`} />
          ) : (
            <span className="text-6xl opacity-20">{link.title.charAt(0).toUpperCase()}</span>
          )}
        </div>
        {/* 链接内容 - 在批量编辑模式下不使用 a 标签 */}
        {isBatchEditMode ? (
          <div className={`flex flex-1 min-w-0 overflow-hidden h-full w-full ${
            isDetailedView ? 'flex-col md:flex-row md:gap-4 md:items-center' : 'items-center'
          }`}>
            {isDetailedView ? (
              <>
                {/* 移动端：上下两行布局 */}
                {/* PC 端：左右两列布局 */}
                <div className="flex flex-col md:flex-row md:items-start gap-3 w-full min-w-0">
                  {/* 移动端第一行：图标 + 标题 */}
                  <div className="flex items-center gap-3 w-full md:hidden">
                    {/* 图标 */}
                    <div className="icon-main text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 shadow-sm">
                      {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-6 h-6" loading="lazy"/> : link.title.charAt(0)}
                    </div>
                    {/* 标题 */}
                    <h3 className="flex-1 min-w-0 text-slate-900 dark:text-slate-100 text-base font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={link.title}>
                      {link.title}
                    </h3>
                  </div>

                  {/* 移动端第二行：说明 */}
                  {link.description && (
                    <p className="w-full md:hidden text-sm text-slate-600 dark:text-slate-400 leading-relaxed overflow-hidden text-ellipsis whitespace-nowrap" title={link.description}>
                      {link.description}
                    </p>
                  )}

                  {/* PC 端：左侧图标 */}
                  <div className="icon-main hidden md:flex text-blue-600 dark:text-blue-400 items-center justify-center text-sm font-bold uppercase shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 shadow-sm">
                    {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-10 h-10" loading="lazy"/> : link.title.charAt(0)}
                  </div>

                  {/* PC 端：右侧标题和说明 */}
                  <div className="hidden md:flex flex-1 min-w-0 flex-col justify-start w-full">
                    {/* 标题 */}
                    <h3 className="text-slate-900 dark:text-slate-100 text-base font-medium w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={link.title}>
                      {link.title}
                    </h3>

                    {/* 描述 - 限制为 1 行 */}
                    {link.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={link.description}>
                        {link.description}
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 简洁视图保持原有布局 */}
                <div className={`flex items-center gap-3 w-full`}>
                  {/* Icon */}
                  <div className={`icon-main text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
                    'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
                  }`}>
                      {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-5 h-5" loading="lazy"/> : link.title.charAt(0)}
                  </div>

                  {/* 标题 */}
                  <h3 className={`text-sm font-medium text-slate-800 dark:text-slate-200 truncate overflow-hidden text-ellipsis`} title={link.title}>
                      {link.title}
                  </h3>
                </div>
              </>
            )}
          </div>
        ) : (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-1 min-w-0 overflow-hidden h-full w-full ${
              isDetailedView ? 'flex-col md:flex-row md:gap-4 md:items-center' : 'items-center'
            }`}
            title={isDetailedView ? link.url : (link.description || link.url)} // 详情版视图只显示URL作为tooltip
            onClick={(e) => e.stopPropagation()} // 阻止事件冒泡到外层div
          >
            {isDetailedView ? (
              <>
                {/* 移动端：上下两行布局 */}
                {/* PC 端：左右两列布局 */}
                <div className="flex flex-col md:flex-row md:items-start gap-3 w-full min-w-0">
                  {/* 移动端第一行：图标 + 标题 */}
                  <div className="flex items-center gap-3 w-full md:hidden">
                    {/* 图标 */}
                    <div className="icon-main text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 shadow-sm">
                      {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-6 h-6" loading="lazy"/> : link.title.charAt(0)}
                    </div>
                    {/* 标题 */}
                    <h3 className="flex-1 min-w-0 text-slate-800 dark:text-slate-200 text-base font-medium overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" title={link.title}>
                      {link.title}
                    </h3>
                  </div>

                  {/* 移动端第二行：说明 */}
                  {link.description && (
                    <p className="w-full md:hidden text-sm text-slate-600 dark:text-slate-400 leading-relaxed overflow-hidden text-ellipsis whitespace-nowrap" title={link.description}>
                      {link.description}
                    </p>
                  )}

                  {/* PC 端：左侧图标 */}
                  <div className="icon-main hidden md:flex text-blue-600 dark:text-blue-400 items-center justify-center text-sm font-bold uppercase shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 shadow-sm">
                    {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-10 h-10" loading="lazy"/> : link.title.charAt(0)}
                  </div>

                  {/* PC 端：右侧标题和说明 */}
                  <div className="hidden md:flex flex-1 min-w-0 flex-col justify-start w-full">
                    {/* 标题 */}
                    <h3 className="text-slate-800 dark:text-slate-200 text-base font-medium w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" title={link.title}>
                      {link.title}
                    </h3>

                    {/* 描述 - 限制为 1 行 */}
                    {link.description && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={link.description}>
                        {link.description}
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 简洁视图保持原有布局 */}
                <div className={`flex items-center gap-3 w-full`}>
                  {/* Icon */}
                  <div className={`icon-main text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 ${
                    'w-8 h-8 rounded-lg bg-slate-50 dark:bg-slate-700'
                  }`}>
                      {link.icon ? <img src={link.icon} alt={`${link.title} 的图标`} className="w-5 h-5" loading="lazy"/> : link.title.charAt(0)}
                  </div>

                  {/* 标题 */}
                  <h3 className={`text-sm font-medium text-slate-800 dark:text-slate-200 truncate whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors`} title={link.title}>
                      {link.title}
                  </h3>
                </div>

                {/* tooltip for compact view */}
                {link.description && (
                  <div className="tooltip-custom absolute left-0 -top-8 w-max max-w-[200px] bg-black text-white text-xs p-2 rounded opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all z-20 pointer-events-none truncate">
                    {link.description}
                  </div>
                )}
              </>
            )}
          </a>
        )}

        {/* Hover Actions (Absolute Right) - 在批量编辑模式下隐藏，只有在登录状态下显示 */}
        {!isBatchEditMode && authToken && (
          <div className={`flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-md p-1 absolute ${
            isDetailedView ? 'top-3 right-3' : 'top-1/2 -translate-y-1/2 right-2'
          }`}>
              <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingLink(link); setIsModalOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
                  title="编辑"
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.65-.07-.97l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.32-.07.64-.07.97c0 .33.03.65.07.97l-2.11 1.63c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.39 1.06.73 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.25 1.17-.59 1.69-.98l2.49 1c.22.08.49 0 .61-.22l2-3.46c.13-.22.07-.49-.12-.64l-2.11-1.63Z" fill="currentColor"/>
                  </svg>
              </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 dark:text-slate-50">
      {/* 现在所有用户都可以查看页面，不需要认证遮罩层 */}

      {/* AuthModal - 只在需要时显示 */}
      <AuthModal
        isOpen={isAuthOpen}
        onLogin={handleLogin}
        onClose={() => setIsAuthOpen(false)}
      />

      <CategoryAuthModal
        isOpen={!!catAuthModalData}
        category={catAuthModalData}
        onClose={() => setCatAuthModalData(null)}
        onUnlock={handleUnlockCategory}
      />

      <CategoryManagerModal
        isOpen={isCatManagerOpen}
        onClose={() => setIsCatManagerOpen(false)}
        categories={categories}
        onUpdateCategories={handleUpdateCategories}
        onDeleteCategory={handleDeleteCategory}
        onVerifyPassword={handleCategoryActionAuth}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        links={links}
        categories={categories}
        onRestore={handleRestoreBackup}
        webDavConfig={webDavConfig}
        onSaveWebDavConfig={handleSaveWebDavConfig}
        searchConfig={{ mode: searchMode, externalSources: externalSearchSources }}
        onRestoreSearchConfig={handleRestoreSearchConfig}
        aiConfig={aiConfig}
        onRestoreAIConfig={handleRestoreAIConfig}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingLinks={links}
        categories={categories}
        onImport={handleImportConfirm}
        onImportSearchConfig={handleRestoreSearchConfig}
        onImportAIConfig={handleRestoreAIConfig}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        config={aiConfig}
        onSave={handleSaveAIConfig}
        links={links}
        onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
        passwordExpiryConfig={passwordExpiryConfig}
        onSavePasswordExpiry={handleSavePasswordExpiryConfig}
        authToken={authToken}
        showPinnedWebsites={showPinnedWebsites}
        onShowPinnedWebsitesChange={handleShowPinnedWebsitesChange}
        mastodonConfig={mastodonConfig}
        onMastodonConfigChange={handleMastodonConfigChange}
        weatherConfig={weatherConfig}
        onWeatherConfigChange={handleWeatherConfigChange}
        onImportClick={() => { setIsImportModalOpen(true); setIsSettingsModalOpen(false); }}
        onBackupClick={() => { setIsBackupModalOpen(true); setIsSettingsModalOpen(false); }}
      />

      <SearchConfigModal
        isOpen={isSearchConfigModalOpen}
        onClose={() => setIsSearchConfigModalOpen(false)}
        sources={externalSearchSources}
        onSave={(sources) => handleSaveSearchConfig(sources, searchMode)}
      />

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden backdrop-blur-sm cursor-pointer"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30 w-64 lg:w-48 xl:w-64 transform transition-transform duration-300 ease-in-out
          bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              {aiConfig.navigationName || '蜗牛导航'}
            </span>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-hide">
            {showPinnedWebsites && (
                <button
                  onClick={() => { setSelectedCategory('all'); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="p-1"><Icon name="LayoutGrid" size={18} /></div>
                  <span>置顶网站</span>
                </button>
            )}

            <div className="flex items-center justify-between pt-4 pb-2 px-4">
               <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">分类目录</span>
               {authToken && (
                  <button
                     onClick={() => setIsCatManagerOpen(true)}
                     className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                     title="管理分类"
                  >
                     <Settings size={14} />
                  </button>
               )}
            </div>

            {(() => {
                const categoryTree = buildCategoryTree(categories);
                return categoryTree.map(category => renderCategoryNode(category, 0));
            })()}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 shrink-0">


            <div className="flex items-center justify-between text-xs px-2 mt-2">
               <div className="flex items-center gap-1 text-slate-400">
                 {syncStatus === 'saving' && <Loader2 className="animate-spin w-3 h-3 text-blue-500" />}
                 {syncStatus === 'saved' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                 {syncStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
                 {authToken ? <span className="text-green-600">已同步</span> : <span className="text-amber-500">离线</span>}
               </div>

               <a
                 href={GITHUB_REPO_URL}
                 target="_blank"
                 rel="noopener noreferrer"
                 className="flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                 title="Fork this project on GitHub"
               >
                 <GitFork size={14} />
                 <span>Favorite</span>
               </a>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-900 overflow-hidden relative">

        {/* Header */}
        <header className="h-16 px-4 lg:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              <Menu size={24} />
            </button>

            {/* 搜索模式切换 + 搜索框 */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* 移动端搜索图标 - 仅在手机端显示，平板端隐藏 */}
              <button
                onClick={() => {
                  setIsMobileSearchOpen(!isMobileSearchOpen);
                  // 手机端点击搜索图标时默认使用站外搜索
                  if (searchMode !== 'external') {
                    handleSearchModeChange('external');
                  }
                }}
                className="sm:flex md:hidden lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                title="搜索"
              >
                <Search size={20} />
              </button>

              {/* 搜索模式切换 - 平板端和桌面端显示，手机端隐藏 */}
              <div className="hidden sm:hidden md:flex lg:flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full h-[36px]">
                  <button
                    onClick={() => handleSearchModeChange('internal')}
                    className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-[36px] min-w-[40px] leading-none cursor-pointer ${
                      searchMode === 'internal'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站内搜索"
                  >
                    站内
                  </button>
                  <button
                    onClick={() => handleSearchModeChange('external')}
                    className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-[36px] min-w-[40px] leading-none cursor-pointer ${
                      searchMode === 'external'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站外搜索"
                  >
                    站外
                  </button>
                </div>

                {/* 搜索配置管理按钮 */}
                {searchMode === 'external' && authToken && (
                  <button
                    onClick={() => setIsSearchConfigModalOpen(true)}
                    className="p-2 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                    title="管理搜索源"
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>

              {/* 搜索框 */}
              <div className={`relative w-full max-w-lg ${isMobileSearchOpen ? 'block' : 'hidden'} sm:block`}>
                {/* 搜索源选择弹出窗口 */}
                {searchMode === 'external' && showSearchSourcePopup && (
                  <div
                    className="absolute left-0 top-full mt-2 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 z-50"
                    onMouseEnter={() => setIsPopupHovered(true)}
                    onMouseLeave={() => setIsPopupHovered(false)}
                  >
                    <div className="grid grid-cols-5 sm:grid-cols-5 gap-2">
                      {externalSearchSources
                        .filter(source => source.enabled)
                        .map((source, index) => (
                          <button
                            key={index}
                            onClick={() => handleSearchSourceSelect(source)}
                            onMouseEnter={() => setHoveredSearchSource(source)}
                            onMouseLeave={() => setHoveredSearchSource(null)}
                            className="px-2 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1 justify-center"
                          >
                            <img
                              src={`https://www.faviconextractor.com/favicon/${new URL(source.url).hostname}?larger=true`}
                              alt={source.name}
                              className="w-4 h-4"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                              }}
                            />
                            <span className="truncate hidden sm:inline">{source.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* 搜索图标 */}
                <div
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
                  onMouseEnter={() => searchMode === 'external' && setIsIconHovered(true)}
                  onMouseLeave={() => setIsIconHovered(false)}
                  onClick={() => {
                    // 移动端点击事件：显示搜索源选择窗口
                    if (searchMode === 'external') {
                      setShowSearchSourcePopup(!showSearchSourcePopup);
                    }
                  }}
                >
                  {searchMode === 'internal' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search">
                      <path d="m21 21-4.35-4.35"></path>
                      <circle cx="11" cy="11" r="8"></circle>
                    </svg>
                  ) : (hoveredSearchSource || selectedSearchSource) ? (
                    <img
                      src={`https://www.faviconextractor.com/favicon/${new URL((hoveredSearchSource || selectedSearchSource).url).hostname}?larger=true`}
                      alt={(hoveredSearchSource || selectedSearchSource).name}
                      className="w-4 h-4"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                      }}
                    />
                  ) : (
                    <Search size={16} />
                  )}
                </div>

                <input
                  type="text"
                  placeholder={
                    searchMode === 'internal'
                      ? "搜索站内内容..."
                      : selectedSearchSource
                        ? `在${selectedSearchSource.name}搜索内容`
                        : "搜索站外内容..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="搜索框"
                  role="searchbox"
                  aria-expanded={showSearchSourcePopup ? "true" : "false"}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMode === 'external') {
                      handleExternalSearch();
                    }
                  }}
                  className="w-full pl-9 pr-4 py-2 h-[36px] rounded-full bg-slate-100 dark:bg-slate-700/50 border-none text-sm focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-slate-400 outline-none transition-all leading-none"
                  // 移动端优化：防止页面缩放
                  style={{ fontSize: '16px' }}
                  inputMode="search"
                  enterKeyHint="search"
                />

                {searchMode === 'external' && searchQuery.trim() && (
                  <button
                    onClick={handleExternalSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-500 cursor-pointer"
                    title="执行站外搜索"
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mastodon 滚动 ticker - 仅在大屏幕显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} xl:flex`}>
              <MastodonTicker config={mastodonConfig} />
            </div>

            {/* 天气显示 - 仅在大屏幕显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} xl:flex`}>
              <WeatherDisplay config={weatherConfig} />
            </div>

            {/* 视图切换控制器 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center bg-slate-100 dark:bg-slate-700 rounded-full h-[36px]`}>
              <button
                onClick={() => handleViewModeChange('compact')}
                className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-[36px] min-w-[40px] leading-none cursor-pointer ${
                  viewMode === 'compact'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="简约版视图"
              >
                简约
              </button>
              <button
                onClick={() => handleViewModeChange('detailed')}
                className={`px-3 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center h-[36px] min-w-[40px] leading-none cursor-pointer ${
                  viewMode === 'detailed'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="详情版视图"
              >
                详情
              </button>
            </div>

            {/* 主题切换按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <button onClick={toggleTheme} className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer`}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* 设置按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center justify-center p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 h-[36px] min-w-[36px] cursor-pointer`}
              title="设置"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-8">

            {/* 1. Pinned Area (Custom Top Area) */}
            {pinnedLinks.length > 0 && showPinnedWebsites && !searchQuery && (selectedCategory === 'all') && (
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Pin size={16} className="text-blue-500 fill-blue-500" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                置顶 / 常用
                            </h2>
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                {pinnedLinks.length}
                            </span>
                        </div>
                        {authToken && (isSortingPinned ? (
                            <div className="flex gap-2">
                                <button
                                    onClick={savePinnedSorting}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                    title="保存顺序"
                                >
                                    <Save size={14} />
                                    <span>保存顺序</span>
                                </button>
                                <button
                                    onClick={cancelPinnedSorting}
                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all cursor-pointer"
                                    title="取消排序"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsSortingPinned(true)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                title="排序"
                            >
                                <GripVertical size={14} />
                                <span>排序</span>
                            </button>
                        ))}
                    </div>
                    {isInitialLoading && selectedCategory === 'all' && pinnedLinks.length === 0 && !searchQuery ? (
                        <div className={`grid gap-3 ${
                              viewMode === 'detailed'
                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                            }`}>
                            <CardSkeleton viewMode={viewMode} count={10} />
                        </div>
                    ) : isSortingPinned ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handlePinnedDragEnd}
                        >
                            <SortableContext
                                items={pinnedLinks.map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  viewMode === 'detailed'
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                }`}>
                                    {pinnedLinks.map(link => (
                                        <SortableLinkCard key={link.id} link={link} />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                                <div className={`grid gap-3 ${
                                  viewMode === 'detailed'
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                }`}>
                            {pinnedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )}
                </section>
            )}

            {/* 2. Main Grid */}
            {(selectedCategory !== 'all' || searchQuery) && (
            <section>
                 {(!pinnedLinks.length && !searchQuery && selectedCategory === 'all') && (
                    <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg flex items-center justify-between">
                         <div>
                            <h1 className="text-xl font-bold">早安 👋</h1>
                            <p className="text-sm opacity-90 mt-1">
                                {links.length} 个链接 · {categories.length} 个分类
                            </p>
                         </div>
                         <Icon name="Compass" size={48} className="opacity-20" />
                    </div>
                 )}

                 <div className="flex items-center justify-between mb-4">
                     <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                         {selectedCategory === 'all'
                            ? (searchQuery ? '搜索结果' : '所有链接')
                            : (
                                <>
                                    {categories.find(c => c.id === selectedCategory)?.name}
                                    {isCategoryLocked(selectedCategory) && <Lock size={14} className="text-amber-500" />}
                                    <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                        {displayedLinks.length}
                                    </span>
                                </>
                            )
                         }
                     </h2>
                     {selectedCategory !== 'all' && !isCategoryLocked(selectedCategory) && (
                         isSortingMode === selectedCategory ? (
                             <div className="flex gap-2">
                                 <button
                                     onClick={saveSorting}
                                     className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                     title="保存顺序"
                                 >
                                     <Save size={14} />
                                     <span>保存顺序</span>
                                 </button>
                                 <button
                                     onClick={cancelSorting}
                                     className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all cursor-pointer"
                                     title="取消排序"
                                 >
                                     取消
                                 </button>
                             </div>
                         ) : authToken && (
                             <div className="flex gap-2">
                                 <button
                                     onClick={() => { setIsModalOpen(true); }}
                                     className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                     title="添加链接"
                                 >
                                     <Plus size={14} />
                                     <span>添加链接</span>
                                 </button>
                                 <button
                                     onClick={toggleBatchEditMode}
                                     className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-medium rounded-full transition-colors cursor-pointer ${
                                         isBatchEditMode
                                             ? 'bg-red-600 hover:bg-red-700'
                                             : 'bg-blue-600 hover:bg-blue-700'
                                     }`}
                                     title={isBatchEditMode ? "退出批量编辑" : "批量编辑"}
                                 >
                                     {isBatchEditMode ? '取消' : '批量编辑'}
                                 </button>
                                 {isBatchEditMode ? (
                                     <>
                                         <button
                                             onClick={handleBatchDelete}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                             title="批量删除"
                                         >
                                             <Trash2 size={14} />
                                             <span>批量删除</span>
                                         </button>
                                         <button
                                             onClick={handleSelectAll}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                             title="全选/取消全选"
                                         >
                                             <CheckSquare size={14} />
                                             <span>{selectedLinks.size === displayedLinks.length ? '取消全选' : '全选'}</span>
                                         </button>
                                         <div className="relative group">
                                              <button
                                                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                                  title="批量移动"
                                              >
                                                  <Upload size={14} />
                                                  <span>批量移动</span>
                                              </button>
                                              <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                                  {categories.filter(cat => cat.id !== selectedCategory).map(cat => (
                                                      <button
                                                          key={cat.id}
                                                          onClick={() => handleBatchMove(cat.id)}
                                                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-lg last:rounded-b-lg cursor-pointer"
                                                      >
                                                          {cat.name}
                                                      </button>
                                                  ))}
                                              </div>
                                          </div>
                                     </>
                                 ) : (
                                     <button
                                         onClick={() => startSorting(selectedCategory)}
                                         className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
                                         title="排序"
                                     >
                                         <GripVertical size={14} />
                                         <span>排序</span>
                                     </button>
                                 )}
                             </div>
                         )
                     )}
                 </div>

                 {displayedLinks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        {isCategoryLocked(selectedCategory) ? (
                            <>
                                <Lock size={40} className="text-amber-400 mb-4" />
                                <p>该目录已锁定</p>
                                <button onClick={() => setCatAuthModalData(categories.find(c => c.id === selectedCategory) || null)} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg cursor-pointer">输入密码解锁</button>
                            </>
                        ) : (
                            <>
                                <Search size={40} className="opacity-30 mb-4" />
                                <p>没有找到相关内容</p>
                                {selectedCategory !== 'all' && (
                                    <button onClick={() => setIsModalOpen(true)} className="mt-4 text-blue-500 hover:underline cursor-pointer">添加一个？</button>
                                )}
                            </>
                        )}
                    </div>
                 ) : (
                    searchQuery ? (
                        // 搜索模式下只显示结果
                        <div key={searchQuery} className={`grid gap-3 ${
                            viewMode === 'detailed'
                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                        }`}>
                            {displayedLinks.map(link => renderLinkCard(link))}
                        </div>
                    ) : (
                        // 非搜索模式下的正常渲染
                        <>
                            {isInitialLoading && selectedCategory === 'all' ? (
                                <div className={`grid gap-3 ${
                                    viewMode === 'detailed'
                                        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                        : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                }`}>
                                    <CardSkeleton viewMode={viewMode} count={20} />
                                </div>
                            ) : isSortingMode === selectedCategory ? (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCorners}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={displayedLinks.map(link => link.id)}
                                        strategy={rectSortingStrategy}
                                    >
                                        <div className={`grid gap-3 ${
                                            viewMode === 'detailed'
                                                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                                : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                        }`}>
                                            {displayedLinks.map(link => (
                                                <SortableLinkCard key={link.id} link={link} />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            ) : (
                                <div className={`grid gap-3 ${
                                    viewMode === 'detailed'
                                        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                                        : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                                }`}>
                                    {displayedLinks.map(link => renderLinkCard(link))}
                                </div>
                            )}
                        </>
                    )
                 )}
            </section>
            )}
        </div>
      </main>

      {/* Modals */}
      <>
        <LinkModal
            isOpen={isModalOpen}
            onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
            onSave={editingLink ? handleEditLink : handleAddLink}
            onDelete={editingLink ? handleDeleteLink : undefined}
            categories={categories}
            initialData={editingLink || (prefillLink as LinkItem)}
            aiConfig={aiConfig}
            defaultCategoryId={selectedCategory !== 'all' ? selectedCategory : undefined}
            iconConfig={iconConfig}
          />

          <ErrorBoundary>
            <SettingsModal
              isOpen={isSettingsModalOpen}
              onClose={() => setIsSettingsModalOpen(false)}
              config={aiConfig}
              onSave={handleSaveAIConfig}
              links={links}
              onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
              passwordExpiryConfig={passwordExpiryConfig}
              onSavePasswordExpiry={handleSavePasswordExpiryConfig}
              authToken={authToken}
              showPinnedWebsites={showPinnedWebsites}
              onShowPinnedWebsitesChange={handleShowPinnedWebsitesChange}
              mastodonConfig={mastodonConfig}
              onMastodonConfigChange={handleMastodonConfigChange}
              weatherConfig={weatherConfig}
              onWeatherConfigChange={handleWeatherConfigChange}
              onImportClick={() => { setIsSettingsModalOpen(false); setIsImportModalOpen(true); }}
              onBackupClick={() => { setIsSettingsModalOpen(false); setIsBackupModalOpen(true); }}
            />
          </ErrorBoundary>

        {/* 右键菜单 - 只有登录状态才显示 */}
        {authToken && (
          <ContextMenu
              isOpen={contextMenu.isOpen}
              position={contextMenu.position}
              onClose={closeContextMenu}
              onCopyLink={copyLinkToClipboard}
              onShowQRCode={showQRCode}
              onEditLink={editLinkFromContextMenu}
              onDeleteLink={deleteLinkFromContextMenu}
              onTogglePin={togglePinFromContextMenu}
            />
        )}

          {/* 二维码模态框 */}
          <QRCodeModal
            isOpen={qrCodeModal.isOpen}
            url={qrCodeModal.url || ''}
            title={qrCodeModal.title || ''}
            onClose={() => setQrCodeModal({ isOpen: false, url: '', title: '' })}
          />

          {/* Toast 通知容器 */}
          <ToastContainer
            toasts={toasts}
            onRemove={removeToast}
          />
        </>
    </div>
  );
}

export default App;

