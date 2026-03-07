const App = {
  version: '2.0.0',
  elements: {},
  logsByPath: new Map(),
  isLoadingLogs: false,
  renderedPaths: [],
  renderedPathSet: new Set(),
  logsVersion: 0,
  cacheInitPromise: null,
  cacheEnabled: true,
  lastSavedTimer: null,
  lastCounterText: '',
  todayHoursCache: {
    date: null,
    version: -1,
    user: null,
    intervalMs: null,
    text: ''
  },

  isPaused: false,
  isAwaitingLog: false, // No longer used, always false (no queue system)
  isSavingLog: false,
  elapsedMs: 0,
  pomodoroMode: false,
  pomodoroInBreak: false,
  pomodoroSessionCount: 0,
  editingLogPath: null,
  currentEditingProjectId: null,
  manualLogMode: true, // Always in manual mode (no timer triggers)
  logTimespanBaseline: null,
  logTimespanEdited: false,

  activeProjectSession: null, // { projectId, startTime, lastLogTime }
  projectSessions: new Map(), // Map<projectId, { startTime, totalMs }> 
  lastTick: null,
  timerInterval: null,
  pollInterval: null,
  autoSaveInterval: null,
  pollBaseMs: 30 * 1000,
  pollJitterMs: 5 * 1000,
  pollBackoffMs: 0,
  pollBackoffUntilMs: 0,
  lastThrottleToastAtMs: 0,

  user: null,
  audioCtx: null,
  originalTitle: '',
  filters: {
    search: '',
    category: '',
    project: ''
  },
  icons: {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" fill="currentColor"></rect><rect x="14" y="5" width="4" height="14" fill="currentColor"></rect></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l10 7-10 7z" fill="currentColor"></path></svg>'
  },
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  storage: {
    elapsed: 'worklog_elapsed_ms',
    pending: 'worklog_pending_ms',
    paused: 'worklog_paused',
    awaiting: 'worklog_awaiting',
    timerState: 'worklog_timer_state',
    lastSeen: 'worklog_last_seen_sha',
    interval: 'worklog_interval_minutes',
    pendingLogs: 'worklog_pending_logs'
  },
  lastSeenSha: null,
  intervalMs: 60 * 60 * 1000,
  timeline: {
    scale: 'daily',
    periodCount: 0,
    periodWidth: { daily: 420, weekly: 240, monthly: 240, yearly: 180 },
    bufferScreens: 4,
    anchorStart: null,
    initialized: false,
    adjusting: false,
    gridDirty: true,
    rowsDirty: true,
    renderScheduled: false
  },

  init() {
    this.cacheElements();
    this.bindEvents();
    this.updateTimezoneIndicator();
    this.loadProjects();
    this.loadPomodoroMode();
    this.restoreDraft();
    this.loadTimerState();
    this.loadLastSeen();
    this.loadInterval();
    this.setupAudioUnlock();
    this.originalTitle = document.title;

    this.showMainScreenLocal();
  },

  loadPomodoroMode() {
    const prefs = Enhanced.getPreferences();
    if (prefs.pomodoroEnabled) {
      this.enablePomodoroMode(prefs.pomodoroDuration || 25);
    }
  },

  loadProjects() {
    if (!this.elements.logProject) return;
    const projects = Enhanced.getProjects();
    const select = this.elements.logProject;

    while (select.options.length > 1) {
      select.remove(1);
    }

    projects.filter(p => p.active).forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });

    this.populateFilterDropdowns();
  },

  populateFilterDropdowns() {

    if (this.elements.filterCategory) {
      const catSelect = this.elements.filterCategory;
      while (catSelect.options.length > 1) {
        catSelect.remove(1);
      }
      Object.entries(Enhanced.categories).forEach(([key, cat]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${cat.icon} ${cat.name}`;
        catSelect.appendChild(option);
      });
    }

    if (this.elements.filterProject) {
      const projSelect = this.elements.filterProject;
      while (projSelect.options.length > 1) {
        projSelect.remove(1);
      }
      const projects = Enhanced.getProjects();
      projects.filter(p => p.active).forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projSelect.appendChild(option);
      });
    }
  },

  handleSearchInput() {
    if (!this.elements.searchInput) return;
    this.filters.search = this.elements.searchInput.value.toLowerCase();
    this.applyFilters();
  },

  applyFilters() {
    this.filters.category = this.elements.filterCategory?.value || '';
    this.filters.project = this.elements.filterProject?.value || '';
    this.renderLogs();
  },

  clearAllFilters() {
    this.filters = { search: '', category: '', project: '' };
    if (this.elements.searchInput) this.elements.searchInput.value = '';
    if (this.elements.filterCategory) this.elements.filterCategory.value = '';
    if (this.elements.filterProject) this.elements.filterProject.value = '';
    this.renderLogs();
  },

  matchesFilters(log) {
    // Search filter
    if (this.filters.search) {
      const searchText = this.filters.search;
      const textMatch = log.text?.toLowerCase().includes(searchText);
      const dateMatch = log.date?.toLowerCase().includes(searchText);
      const timeMatch = log.time?.toLowerCase().includes(searchText);
      if (!textMatch && !dateMatch && !timeMatch) return false;
    }

    if (this.filters.category) {
      const meta = this.getLogMetadata(log);
      if (meta?.category !== this.filters.category) return false;
    }

    if (this.filters.project) {
      const meta = this.getLogMetadata(log);
      if (meta?.project !== this.filters.project) return false;
    }

    return true;
  },

  updateTimezoneIndicator() {
    if (!this.elements.tzIndicator) return;
    const tzName = Time.getTimeZoneName();
    const tzFull = Time.getTimeZone();
    this.elements.tzIndicator.textContent = `TZ: ${tzName}`;
    this.elements.tzIndicator.title = `Times shown in ${tzName} (${tzFull})`;
  },

  cacheElements() {
    this.elements = {
      loginScreen: document.getElementById('login-screen'),
      mainScreen: document.getElementById('main-screen'),
      loginBtn: document.getElementById('login-btn'),
      patInput: document.getElementById('pat-input'),
      logoutBtn: document.getElementById('logout-btn'),
      pauseBtn: document.getElementById('pause-btn'),
      helpBtn: document.getElementById('help-btn'),
      statsBtn: document.getElementById('stats-btn'),
      exportBtn: document.getElementById('export-btn'),
      addLogBtn: document.getElementById('add-log-btn'),
      counter: document.getElementById('counter'),
      todayHours: document.getElementById('today-hours'),
      intervalInput: document.getElementById('interval-input'),
      userPill: document.getElementById('user-pill'),
      userAvatar: document.getElementById('user-avatar'),
      userName: document.getElementById('user-name'),
      logContainer: document.getElementById('log-container'),
      logList: document.getElementById('log-list'),
      logLoading: document.getElementById('log-loading'),
      logEmpty: document.getElementById('log-empty'),
      tabLogs: document.getElementById('tab-logs'),
      tabTimeline: document.getElementById('tab-timeline'),
      logsView: document.getElementById('logs-view'),
      timelineView: document.getElementById('timeline-view'),
      timelineScroll: document.getElementById('timeline-scroll'),
      timelineCanvas: document.getElementById('timeline-canvas'),
      timelineGrid: document.getElementById('timeline-grid'),
      timelineLabels: document.getElementById('timeline-labels'),
      timelineRows: document.getElementById('timeline-rows'),
      timelineTooltip: document.getElementById('timeline-tooltip'),
      timelineTotal: document.getElementById('timeline-total'),
      tzIndicator: document.getElementById('tz-indicator'),
      logModal: document.getElementById('log-modal'),
      logDate: document.getElementById('log-date'),
      logTime: document.getElementById('log-time'),
      logHours: document.getElementById('log-hours'),
      logMinutes: document.getElementById('log-minutes'),
      logProject: document.getElementById('log-project'),
      logCategory: document.getElementById('log-category'),
      logEnergy: document.getElementById('log-energy'),
      logQueueMeta: document.getElementById('log-queue-meta'),
      logError: document.getElementById('log-error'),
      logText: document.getElementById('log-text'),
      registerLog: document.getElementById('register-log'),
      cancelLog: document.getElementById('cancel-log'),
      helpModal: document.getElementById('help-modal'),
      statsModal: document.getElementById('stats-modal'),
      statsContent: document.getElementById('stats-content'),
      exportModal: document.getElementById('export-modal'),
      exportJsonBtn: document.getElementById('export-json-btn'),
      exportCsvBtn: document.getElementById('export-csv-btn'),
      importFile: document.getElementById('import-file'),
      importBtn: document.getElementById('import-btn'),
      toastContainer: document.getElementById('toast-container'),
      searchInput: document.getElementById('search-input'),
      filterCategory: document.getElementById('filter-category'),
      filterProject: document.getElementById('filter-project'),
      clearFilters: document.getElementById('clear-filters'),
      pomodoroCounter: document.getElementById('pomodoro-counter'),
      pomodoroTodayCount: document.getElementById('pomodoro-today-count'),
      pomodoroTotalCount: document.getElementById('pomodoro-total-count'),
      pomodoroAvgCount: document.getElementById('pomodoro-avg-count'),
      settingsBtn: document.getElementById('settings-btn'),
      projectsBtn: document.getElementById('projects-btn'),
      settingsModal: document.getElementById('settings-modal'),
      settingsSave: document.getElementById('settings-save'),
      settingsReset: document.getElementById('settings-reset'),
      projectsModal: document.getElementById('projects-modal'),
      createProjectBtn: document.getElementById('create-project-btn'),
      projectsList: document.getElementById('projects-list'),
      projectForm: document.getElementById('project-form'),
      projectFormTitle: document.getElementById('project-form-title'),
      projectName: document.getElementById('project-name'),
      projectDescription: document.getElementById('project-description'),
      saveProjectBtn: document.getElementById('save-project-btn'),
      cancelProjectBtn: document.getElementById('cancel-project-btn'),
      reportsBtn: document.getElementById('reports-btn'),
      reportsModal: document.getElementById('reports-modal'),
      reportsContent: document.getElementById('reports-content'),
      reportsDateDisplay: document.getElementById('reports-date-display'),
      reportsPrev: document.getElementById('reports-prev'),
      reportsNext: document.getElementById('reports-next'),
      reportsToday: document.getElementById('reports-today'),
      reportsExport: document.getElementById('reports-export')
    };
  },

  bindEvents() {
    this.elements.loginBtn.addEventListener('click', () => this.login());
    this.elements.logoutBtn.addEventListener('click', () => this.clearAllData());
    this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
    this.elements.helpBtn.addEventListener('click', () => this.showHelp());
    this.elements.statsBtn.addEventListener('click', () => this.showStats());
    this.elements.exportBtn.addEventListener('click', () => this.showExport());
    this.elements.exportJsonBtn.addEventListener('click', () => this.exportJSON());
    this.elements.exportCsvBtn.addEventListener('click', () => this.exportCSV());
    this.elements.importBtn.addEventListener('click', () => this.importJSON());
    this.elements.addLogBtn.addEventListener('click', () => this.showManualLogEntry());
    this.elements.counter.addEventListener('click', () => this.triggerManualLog());
    this.elements.projectsBtn.addEventListener('click', () => this.showProjects());
    this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
    this.elements.settingsSave.addEventListener('click', () => this.saveSettings());
    this.elements.settingsReset.addEventListener('click', () => this.resetSettings());
    this.elements.createProjectBtn.addEventListener('click', () => this.showProjectForm());
    this.elements.saveProjectBtn.addEventListener('click', () => this.saveProject());
    this.elements.reportsBtn.addEventListener('click', () => this.showReports());
    this.elements.reportsPrev.addEventListener('click', () => this.navigateReport(-1));
    this.elements.reportsNext.addEventListener('click', () => this.navigateReport(1));
    this.elements.reportsToday.addEventListener('click', () => this.navigateReportToToday());
    this.elements.reportsExport.addEventListener('click', () => this.exportCurrentReport());
    this.elements.cancelProjectBtn.addEventListener('click', () => this.hideProjectForm());
    this.elements.userPill.addEventListener('click', () => this.openProfile());
    this.elements.registerLog.addEventListener('click', () => this.submitLog());
    this.elements.cancelLog.addEventListener('click', () => this.cancelLog());
    this.elements.intervalInput.addEventListener('change', () => this.updateInterval());
    this.elements.tabLogs.addEventListener('click', () => this.showLogsTab());
    this.elements.tabTimeline.addEventListener('click', () => this.showTimelineTab());

    if (this.elements.searchInput) {
      this.elements.searchInput.addEventListener('input', () => this.handleSearchInput());
    }
    if (this.elements.filterCategory) {
      this.elements.filterCategory.addEventListener('change', () => this.applyFilters());
    }
    if (this.elements.filterProject) {
      this.elements.filterProject.addEventListener('change', () => this.applyFilters());
    }
    if (this.elements.clearFilters) {
      this.elements.clearFilters.addEventListener('click', () => this.clearAllFilters());
    }

    document.querySelectorAll('.scale-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTimelineScale(btn.dataset.scale));
    });

    document.querySelectorAll('.settings-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchSettingsTab(btn.dataset.tab));
    });

    document.querySelectorAll('.reports-type-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchReportType(btn.dataset.type));
    });

    this.elements.timelineScroll.addEventListener('scroll', () => this.handleTimelineScroll());

    this.elements.logText.addEventListener('input', () => {
      localStorage.setItem('worklog_draft', this.elements.logText.value);
    });

    [this.elements.logDate, this.elements.logTime, this.elements.logHours, this.elements.logMinutes].forEach(input => {
      if (!input) return;
      input.addEventListener('input', () => {
        this.logTimespanEdited = true;
        this.validateLogTimespan();
      });
      input.addEventListener('change', () => {
        this.logTimespanEdited = true;
        this.validateLogTimespan();
      });
    });

    this.elements.logText.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.submitLog();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (this.isTyping(event)) return;

      const openModal = document.querySelector('.modal:not(.hidden)');
      const canUseShortcuts = !openModal || openModal === this.elements.helpModal;

      switch(event.key.toLowerCase()) {
        case '?':
          event.preventDefault();
          this.toggleIntervalVisibility();
          break;
        case ' ':
          if (canUseShortcuts) {
            event.preventDefault();
            this.togglePause();
          }
          break;
        case 'l':
          if (canUseShortcuts) {
            event.preventDefault();
            this.triggerManualLog();
          }
          break;
        case 's':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showStats();
          }
          break;
        case 'r':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showReports();
          }
          break;
        case 'e':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showExport();
          }
          break;
        case 'c':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showSettings();
          }
          break;
        case 'm':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showProjects();
          }
          break;
        case 'a':
          if (canUseShortcuts) {
            event.preventDefault();
            this.showManualLogEntry();
          }
          break;
        case 'escape':
          if (openModal) {
            event.preventDefault();
            this.hideModal(openModal);
          }
          break;
      }
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal) this.hideModal(modal);
      });
    });

    [this.elements.helpModal, this.elements.logModal, this.elements.statsModal, this.elements.exportModal, this.elements.reportsModal].forEach(modal => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          this.hideModal(modal);
        }
      });
    });

    window.addEventListener('beforeunload', () => {
      this.saveTimerState();
      this.syncCacheFromMemory();
    });
    window.addEventListener('resize', () => {
      if (this.isTimelineVisible()) {
        this.scheduleTimelineRender({ grid: true, rows: true });
      }
    });
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  },

  isTyping(event) {
    const target = event.target;
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  },

  isPageVisible() {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  },

  handleVisibilityChange() {
    if (!this.user) return;

    if (!this.isPageVisible()) {
      if (this.pollInterval) clearTimeout(this.pollInterval);
      this.pollInterval = null;
      return;
    }

    this.scheduleNextPoll(250);
  },

  setupAudioUnlock() {
    const unlock = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }

      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };

    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  },

  restoreDraft() {
    const draft = localStorage.getItem('worklog_draft');
    if (draft) {
      this.elements.logText.value = draft;
    }
  },

  loadTimerState() {
    const packed = localStorage.getItem(this.storage.timerState);
    if (packed) {
      try {
        const data = JSON.parse(packed);
        if (data && typeof data === 'object') {
          if (typeof data.elapsed === 'number' && data.elapsed >= 0) {
            this.elapsedMs = data.elapsed;
          }
          this.isPaused = data.paused === true;
          // NO MORE QUEUE - ignore old queue data
          this.lastSavedTimer = null;
          return;
        }
      } catch (err) {
        console.error('Failed to load timer state:', err);
      }
    }

    // Fallback to old storage format
    const elapsed = Number(localStorage.getItem(this.storage.elapsed));
    const paused = localStorage.getItem(this.storage.paused);

    if (!Number.isNaN(elapsed) && elapsed >= 0) {
      this.elapsedMs = elapsed;
    }

    this.isPaused = paused === 'true';
  },

  normalizePendingQueueEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;

    const durationMs = Number(entry.durationMs);
    const appearedAtMs = Number(
      entry.appearedAtMs ?? entry.appearedAt ?? entry.endAtMs ?? entry.endAt
    );
    const endAtMs = Number(entry.endAtMs ?? entry.endAt ?? appearedAtMs);

    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    if (!Number.isFinite(appearedAtMs) || !Number.isFinite(endAtMs)) return null;

    return {
      durationMs: Math.max(60 * 1000, Math.floor(durationMs)),
      appearedAtMs: Math.floor(appearedAtMs),
      endAtMs: Math.floor(endAtMs)
    };
  },

  syncPendingQueueState() {
    const current = this.pendingLogQueue[0] || null;
    this.isAwaitingLog = !!current;
    this.pendingMs = current ? current.durationMs : 0;
  },

  loadInterval() {
    const stored = Number(localStorage.getItem(this.storage.interval));
    if (!Number.isNaN(stored) && stored >= 1 && stored <= 120) {
      this.intervalMs = stored * 60 * 1000;
    }
    this.elements.intervalInput.value = Math.round(this.intervalMs / 60000);
  },

  loadLastSeen() {
    const stored = localStorage.getItem(this.storage.lastSeen);
    if (stored) {
      this.lastSeenSha = stored;
    }
  },

  saveTimerState() {
    const data = {
      elapsed: Math.floor(this.elapsedMs),
      paused: this.isPaused
      // NO MORE QUEUE - removed queue property
    };
    const packed = JSON.stringify(data);
    if (this.lastSavedTimer === packed) return;

    this.lastSavedTimer = packed;
    localStorage.setItem(this.storage.timerState, packed);
  },

  saveLastSeen(sha) {
    if (!sha) return;
    this.lastSeenSha = sha;
    localStorage.setItem(this.storage.lastSeen, sha);
  },

  async ensureCacheReady() {
    console.log('🔧 ensureCacheReady - cacheEnabled:', this.cacheEnabled);

    if (!this.cacheEnabled) {
      console.error('🔧 ensureCacheReady - Cache is DISABLED!');
      return false;
    }

    if (!this.cacheInitPromise) {
      console.log('🔧 ensureCacheReady - Initializing cache...');

      if (typeof window === 'undefined') {
        console.error('🔧 ensureCacheReady - window is undefined!');
        this.cacheEnabled = false;
        return false;
      }

      if (!window.LogCache) {
        console.error('🔧 ensureCacheReady - window.LogCache is undefined! Is cache.js loaded?');
        this.cacheEnabled = false;
        return false;
      }

      if (!LogCache.isSupported()) {
        console.error('🔧 ensureCacheReady - IndexedDB not supported in this browser!');
        this.cacheEnabled = false;
        return false;
      }

      console.log('🔧 ensureCacheReady - Opening IndexedDB...');
      this.cacheInitPromise = LogCache.open().catch(err => {
        console.error('🔧 ensureCacheReady - LogCache.open() FAILED:', err);
        this.cacheEnabled = false;
        return null;
      });
    }

    const db = await this.cacheInitPromise;
    console.log('🔧 ensureCacheReady - DB ready?', !!db);
    return !!db;
  },

  getLogMetadata(log) {
    if (log.project !== undefined || log.category !== undefined || log.energy !== undefined) {
      return {
        project: log.project || null,
        category: log.category || null,
        energy: log.energy || null,
        createdAt: log.createdAt || null
      };
    }

    return Enhanced.getLogMetadata(log.path) || {};
  },

  serializeLogForCache(log) {
    return {
      path: log.path,
      text: String(log.text || ''),
      date: log.date || '',
      time: log.time || '',
      username: log.username || (this.user ? this.user.login : this.generateUsername()),
      durationMs: log.durationMs || 0,
      project: log.project || null,
      category: log.category || null,
      energy: log.energy || null,
      createdAt: log.createdAt || new Date().toISOString()
    };
  },

  deserializeCacheLog(entry) {
    if (!entry || !entry.path) return null;
    const parsed = this.parseLogPath(entry.path);
    if (!parsed) return null;

    const log = this.buildLogEntry(entry.path, parsed, entry.text || '');
    log.project = entry.project || null;
    log.category = entry.category || null;
    log.energy = entry.energy || null;
    log.createdAt = entry.createdAt || null;

    return log;
  },

  async loadLogsFromCache() {
    console.log('📂 loadLogsFromCache - Starting...');
    if (!(await this.ensureCacheReady())) {
      console.error('📂 loadLogsFromCache - Cache not ready!');
      return false;
    }

    try {
      const cached = await LogCache.getAllLogs();
      console.log('📂 loadLogsFromCache - Retrieved from IndexedDB:', cached?.length || 0, 'logs');

      if (!Array.isArray(cached) || cached.length === 0) {
        console.warn('📂 loadLogsFromCache - No logs found in cache');
        return false;
      }

      this.logsByPath.clear();
      this.renderedPaths = [];
      this.renderedPathSet = new Set();

      let loaded = 0;
      for (const item of cached) {
        const log = this.deserializeCacheLog(item);
        if (!log) continue;
        this.logsByPath.set(log.path, log);
        loaded += 1;
      }

      console.log('📂 loadLogsFromCache - Loaded', loaded, 'logs into memory');

      if (loaded === 0) {
        return false;
      }

      this.logsVersion += loaded;
      this.renderLogs();
      return true;
    } catch (err) {
      console.error('📂 loadLogsFromCache - ERROR:', err);
      this.toast(`Import failed: ${err.message}`, 'error');
      return false;
    }
  },

  async saveLogsToCache(logs, { replace = false } = {}) {
    console.log('💾 saveLogsToCache - Starting...', logs?.length || 0, 'logs, replace:', replace);
    if (!(await this.ensureCacheReady())) {
      console.error('💾 saveLogsToCache - Cache not ready!');
      return;
    }

    const items = (logs || [])
      .map(log => this.serializeLogForCache(log))
      .filter(item => item && item.path);

    console.log('💾 saveLogsToCache - Serialized', items.length, 'items');

    try {
      if (replace) {
        console.log('💾 saveLogsToCache - Replacing all logs in IndexedDB');
        await LogCache.replaceAllLogs(items);
      } else if (items.length > 0) {
        console.log('💾 saveLogsToCache - Putting', items.length, 'logs to IndexedDB');
        await LogCache.putLogs(items);
      }
      console.log('💾 saveLogsToCache - SUCCESS! Logs saved to IndexedDB');
    } catch (err) {
      console.error('💾 saveLogsToCache - ERROR:', err);
      this.toast(`Failed to save: ${err.message}`, 'error');
    }
  },

  async syncCacheFromMemory() {
    await this.saveLogsToCache(Array.from(this.logsByPath.values()), { replace: true });
  },

  loadPendingLogs() {
    const raw = localStorage.getItem(this.storage.pendingLogs);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      this.toast(`Import failed: ${err.message}`, 'error');
      return {};
    }
  },

  savePendingLogs(pending) {
    localStorage.setItem(this.storage.pendingLogs, JSON.stringify(pending));
  },

  addPendingLog(path, text) {
    const pending = this.loadPendingLogs();
    pending[path] = { text, ts: Date.now() };
    this.savePendingLogs(pending);
  },

  mergePendingLogs() {
    const pending = this.loadPendingLogs();
    let migrated = 0;

    for (const [path, entry] of Object.entries(pending)) {
      if (this.logsByPath.has(path)) {
        continue; 
      }
      if (!entry || !entry.text) {
        continue;
      }

      const parsed = this.parseLogPath(path);
      if (!parsed) {
        continue;
      }

      const log = this.buildLogEntry(path, parsed, entry.text);

      const oldMetadata = Enhanced.getLogMetadata(path);
      if (oldMetadata) {
        log.project = oldMetadata.project || null;
        log.category = oldMetadata.category || null;
        log.energy = oldMetadata.energy || null;
        log.createdAt = oldMetadata.createdAt || new Date().toISOString();
      }

      this.logsByPath.set(path, log);
      migrated++;
    }

    if (migrated > 0) {
      localStorage.removeItem(this.storage.pendingLogs);
      this.syncCacheFromMemory(); // Save migrated logs to IndexedDB
    }
  },

  updateInterval() {
    const raw = Number(this.elements.intervalInput.value);
    const minutes = Math.min(120, Math.max(1, Number.isNaN(raw) ? 60 : raw));
    this.intervalMs = minutes * 60 * 1000;
    this.elements.intervalInput.value = minutes;
    localStorage.setItem(this.storage.interval, String(minutes));

    this.updateCounter();
    this.updateTodayHours();
    this.updateTimelineTotal();
    this.saveTimerState();
  },

  toggleIntervalVisibility() {
    const control = this.elements.intervalInput?.closest('.interval-control');
    if (!control) return;
    control.classList.toggle('hidden');
  },

  showLoginScreen() {
    this.elements.loginScreen.classList.remove('hidden');
    this.elements.mainScreen.classList.add('hidden');
  },

  generateUsername() {
    // Check if username already exists in localStorage
    const stored = localStorage.getItem('worklog_username');
    if (stored) return stored;

    // Generate random username
    const adjectives = ['Swift', 'Bright', 'Clever', 'Bold', 'Quick', 'Wise', 'Keen', 'Sharp', 'Astute', 'Nimble', 'Agile', 'Savvy', 'Deft', 'Adept', 'Skilled'];
    const nouns = ['Coder', 'Dev', 'Builder', 'Maker', 'Hacker', 'Engineer', 'Architect', 'Creator', 'Crafter', 'Designer', 'Artisan', 'Expert', 'Pro', 'Wizard', 'Ninja'];

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);

    const username = `${adj}${noun}${num}`;

    // Store for future use
    localStorage.setItem('worklog_username', username);
    return username;
  },

  generateAvatar(username) {
    // Generate consistent color from username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate pleasant colors (avoid too dark or too bright)
    const hue = hash % 360;
    const saturation = 65 + (hash % 20); // 65-85%
    const lightness = 45 + (hash % 15);  // 45-60%
    const bgColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

    // Get initials (first 2 chars, uppercase)
    const initials = username.substring(0, 2).toUpperCase();

    // Generate SVG avatar
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="${bgColor}"/>
      <text x="50" y="62" font-size="48" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="600">${initials}</text>
    </svg>`;

    // Encode to data URI
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  },

  async showMainScreenLocal() {
    // Generate or retrieve persistent username
    const username = this.generateUsername();
    const avatar = this.generateAvatar(username);

    this.user = {
      login: username,
      avatar_url: avatar
    };
    this.elements.userAvatar.src = this.user.avatar_url;
    this.elements.userName.textContent = `@${this.user.login}`;

    this.elements.loginScreen.classList.add('hidden');
    this.elements.mainScreen.classList.remove('hidden');

    this.startTimer();
    await this.loadLogsFromCache();
    this.mergePendingLogs();
    this.renderLogs();
    this.initTimeline();
    this.elements.logLoading.classList.add('hidden');

    setTimeout(() => this.checkAndArchiveOldLogs(), 2000);

    setTimeout(() => this.showManualLogEntry(), 500);

  },

  async showMainScreen() {
    // Generate or retrieve persistent username
    const username = this.generateUsername();
    const avatar = this.generateAvatar(username);

    this.user = {
      login: username,
      avatar_url: avatar
    };
    this.elements.userAvatar.src = this.user.avatar_url;
    this.elements.userName.textContent = `@${this.user.login}`;

    this.elements.loginScreen.classList.add('hidden');
    this.elements.mainScreen.classList.remove('hidden');

    this.startTimer();
    await this.loadLogsFromCache();
    this.initTimeline();
    this.startPolling();
    this.loadLogs();
  },

  showLogsTab() {
    this.elements.logsView.classList.remove('hidden');
    this.elements.timelineView.classList.add('hidden');
    this.elements.tabLogs.classList.add('active');
    this.elements.tabTimeline.classList.remove('active');
  },

  showTimelineTab() {
    this.elements.logsView.classList.add('hidden');
    this.elements.timelineView.classList.remove('hidden');
    this.elements.tabLogs.classList.remove('active');
    this.elements.tabTimeline.classList.add('active');
    this.updateTimelineTotal();
    requestAnimationFrame(() => {
      const today = new Date();
      const periodStart = this.startOfPeriod(today, this.timeline.scale);
      this.ensureTimelineSized(periodStart, 'left');
      this.positionTimelineOnDate(periodStart, 'left');
      this.scheduleTimelineRender({ grid: true, rows: true });
    });
  },

  isTimelineVisible() {
    return !this.elements.timelineView.classList.contains('hidden');
  },

  openProfile() {
    this.showStats();
  },

  async login() {
    this.toast('Signed in!', 'success');
    await this.showMainScreenLocal();
  },

  logout() {
    this.stopTimers();
    this.logsByPath.clear();
    this.elements.logList.innerHTML = '';
    this.renderedPaths = [];
    this.renderedPathSet = new Set();
    this.logsVersion = 0;
    window.location.reload();
  },

  startTimer() {
    this.stopTimers();
    this.lastTick = Date.now();
    this.setPauseButton(this.isPaused);

    this.autoSaveInterval = setInterval(() => {
      this.syncCacheFromMemory();
    }, 5 * 60 * 1000);

    this.updateCounter();
    this.saveTimerState();
    this.timerInterval = setInterval(() => this.tick(), 1000);
  },

  stopTimers() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.pollInterval) clearTimeout(this.pollInterval);
    if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    this.timerInterval = null;
    this.pollInterval = null;
    this.autoSaveInterval = null;
  },

  tick() {
    const now = Date.now();
    const delta = now - this.lastTick;
    this.lastTick = now;

    if (!this.isPaused) {
      this.elapsedMs += delta;
    }

    this.updateCounter();
    this.saveTimerState();
  },

  updateCounter() {
    const text = `Worked: ${this.formatDuration(this.elapsedMs)}`;
    if (text !== this.lastCounterText) {
      this.elements.counter.textContent = text;
      this.lastCounterText = text;
    }
  },

  getPeriodRange(scale) {
    const now = new Date();
    const start = this.startOfPeriod(now, scale);
    return { start, end: now };
  },

  getTodayDateValue() {
    const parts = Time.getZonedParts(new Date());
    return Time.formatDateValue(parts);
  },

  formatHours(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return '0h';
    const rounded = Math.round(hours * 10) / 10;
    return rounded % 1 === 0 ? `${rounded.toFixed(0)}h` : `${rounded.toFixed(1)}h`;
  },

  computePeriodTotalMs(scale) {
    if (!this.user || !this.user.login) return 0;

    const { start, end } = this.getPeriodRange(scale);
    const login = this.user.login;
    let totalMs = 0;

    for (const log of this.logsByPath.values()) {
      if (log.username !== login) continue;
      const endTime = log.dateObj || this.buildDate(log.date, log.time);
      if (!endTime) continue;
      if (!log.dateObj) {
        log.dateObj = endTime;
      }
      const durationMs = log.durationMs || this.intervalMs;
      if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
      const startTime = new Date(endTime.getTime() - durationMs);

      if (endTime <= start || startTime >= end) continue;

      const overlapStart = startTime < start ? start : startTime;
      const overlapEnd = endTime > end ? end : endTime;
      const overlap = overlapEnd - overlapStart;
      if (overlap > 0) {
        totalMs += overlap;
      }
    }

    return totalMs;
  },

  updateTodayHours() {
    const el = this.elements.todayHours;
    if (!el) return;
    if (!this.user || !this.user.login) {
      el.textContent = 'Today: --';
      el.title = `Hours logged today (${Time.getTimeZoneName()})`;
      return;
    }

    const dateValue = this.getTodayDateValue();
    const cache = this.todayHoursCache;
    const login = this.user.login;
    const version = this.logsVersion;
    const intervalMs = this.intervalMs;

    if (
      cache.date === dateValue &&
      cache.user === login &&
      cache.version === version &&
      cache.intervalMs === intervalMs
    ) {
      if (el.textContent !== cache.text) {
        el.textContent = cache.text;
      }
      return;
    }

    const totalMs = this.computePeriodTotalMs('daily');
    const hours = totalMs / (60 * 60 * 1000);
    const text = `Today: ${this.formatHours(hours)}`;
    cache.date = dateValue;
    cache.user = login;
    cache.version = version;
    cache.intervalMs = intervalMs;
    cache.text = text;
    el.textContent = text;
    el.title = `Hours logged today (${dateValue}, ${Time.getTimeZoneName()}): ${text}`;
  },

  getPeriodLabel(scale) {
    if (scale === 'weekly') return 'This week';
    if (scale === 'monthly') return 'This month';
    if (scale === 'yearly') return 'This year';
    return 'Today';
  },

  updateTimelineTotal() {
    const el = this.elements.timelineTotal;
    if (!el) return;
    if (!this.user || !this.user.login) {
      el.textContent = 'Total: --';
      el.title = 'Total logged for selected period';
      return;
    }

    const scale = this.timeline.scale || 'daily';
    const label = this.getPeriodLabel(scale);
    const { start, end } = this.getPeriodRange(scale);
    const totalMs = this.computePeriodTotalMs(scale);
    const hours = totalMs / (60 * 60 * 1000);
    const text = `${label}: ${this.formatHours(hours)}`;
    const startValue = Time.formatDateValue(Time.getZonedParts(start));
    const endValue = Time.formatDateValue(Time.getZonedParts(end));

    el.textContent = text;
    el.title = `Total logged for ${label.toLowerCase()} (${startValue} → ${endValue}, ${Time.getTimeZoneName()}): ${text}`;
  },

  togglePause() {
    this.isPaused = !this.isPaused;
    this.setPauseButton(this.isPaused);
    this.lastTick = Date.now();
    this.updateCounter();
    this.saveTimerState();
  },

  queuePendingLog(durationMs, { appearedAtMs = Date.now(), endAtMs = appearedAtMs } = {}) {
    const normalized = this.normalizePendingQueueEntry({ durationMs, appearedAtMs, endAtMs });
    if (!normalized) return false;

    this.pendingLogQueue.push(normalized);
    this.syncPendingQueueState();
    return true;
  },

  queueElapsedIntervals(now = Date.now()) {
    if (!Number.isFinite(this.intervalMs) || this.intervalMs <= 0) return 0;
    const dueCount = Math.floor(this.elapsedMs / this.intervalMs);
    if (dueCount <= 0) return 0;

    const remainder = this.elapsedMs - dueCount * this.intervalMs;
    for (let i = 0; i < dueCount; i += 1) {
      const offsetMs = (dueCount - i - 1) * this.intervalMs + remainder;
      const alarmAtMs = now - offsetMs;
      this.queuePendingLog(this.intervalMs, { appearedAtMs: alarmAtMs, endAtMs: alarmAtMs });
    }

    this.elapsedMs = remainder;
    return dueCount;
  },

  showPendingLogModal(force = false) {
    const current = this.pendingLogQueue[0] || null;

    if (!current) {
      this.activePendingLog = null;
      this.logTimespanBaseline = null;
      this.logTimespanEdited = false;
      this.clearPendingLogMeta();
      this.hideModal(this.elements.logModal);
      return;
    }

    this.updatePendingLogMeta(current);
    const isVisible = !this.elements.logModal.classList.contains('hidden');
    const isSamePrompt = this.activePendingLog === current;
    if (!force && isVisible && isSamePrompt) return;

    this.activePendingLog = current;
    this.showModal(this.elements.logModal);

    this.populateLogTimespan(current.durationMs, Date.now());
    this.applyDefaultValues();
    this.validateLogTimespan();
    setTimeout(() => this.elements.logText.focus(), 100);
  },

  applyDefaultValues() {
    const prefs = Enhanced.getPreferences();

    if (prefs.defaultProject && this.elements.logProject) {
      this.elements.logProject.value = prefs.defaultProject;
    }

    if (prefs.defaultCategory && this.elements.logCategory) {
      this.elements.logCategory.value = prefs.defaultCategory;
    }

    if (prefs.defaultEnergy && this.elements.logEnergy) {
      this.elements.logEnergy.value = prefs.defaultEnergy;
    }
  },

  completeCurrentPendingLog() {
    if (this.pendingLogQueue.length > 0) {
      this.pendingLogQueue.shift();
    }

    this.activePendingLog = null;
    this.logTimespanBaseline = null;
    this.logTimespanEdited = false;
    this.syncPendingQueueState();
    this.showPendingLogModal();

    if (!this.isAwaitingLog) {
      this.clearLogError();
      this.clearAttention();
    }

    this.saveTimerState();
  },

  formatPendingLogTimestamp(timestampMs) {
    const date = new Date(timestampMs);
    const parts = Time.getZonedParts(date);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(parts.hour)}:${pad(parts.minute)} (${parts.year}-${pad(parts.month)}-${pad(parts.day)})`;
  },

  updatePendingLogMeta(entry) {
    if (!this.elements.logQueueMeta || !entry) return;
    const appearedAt = this.formatPendingLogTimestamp(entry.appearedAtMs);
    const worth = this.formatDuration(entry.durationMs);
    this.elements.logQueueMeta.textContent = `Appeared at: ${appearedAt}\nWorth: ${worth}`;
  },

  clearPendingLogMeta() {
    if (!this.elements.logQueueMeta) return;
    this.elements.logQueueMeta.textContent = '';
  },

  setPauseButton(isPaused) {
    this.elements.pauseBtn.innerHTML = isPaused ? this.icons.play : this.icons.pause;
    this.elements.pauseBtn.title = isPaused ? 'Resume' : 'Pause';
    this.elements.pauseBtn.setAttribute('aria-label', isPaused ? 'Resume' : 'Pause');
  },

  showHelp() {
    this.showModal(this.elements.helpModal);
  },

  showModal(modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  },

  hideModal(modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  },

  triggerManualLog() {
    if (this.isAwaitingLog) return;
    const now = Date.now();
    if (!this.queuePendingLog(this.elapsedMs, { appearedAtMs: now, endAtMs: now })) return;
    this.elapsedMs = 0;
    this.lastTick = now;
    this.showPendingLogModal(true);
    this.playBeep();
    this.triggerAttention();
    this.updateCounter();
    this.saveTimerState();
  },

  showManualLogEntry() {

    this.manualLogMode = true;
    this.editingLogPath = null;

    const now = new Date();
    const parts = Time.getZonedParts(now);

    if (this.elements.logDate) {
      this.elements.logDate.value = Time.formatDateValue(parts);
    }

    if (this.elements.logTime) {
      this.elements.logTime.value = Time.formatTimeValue(parts);
    }

    if (this.elements.logHours) {
      this.elements.logHours.value = '1';
    }
    if (this.elements.logMinutes) {
      this.elements.logMinutes.value = '0';
    }

    if (this.elements.logText) {
      this.elements.logText.value = '';
    }

    this.applyDefaultValues();

    if (this.elements.registerLog) {
      this.elements.registerLog.textContent = 'Add Log';
    }

    this.clearLogError();

    this.logTimespanBaseline = null;
    this.logTimespanEdited = false;

    this.showModal(this.elements.logModal);
    this.validateLogTimespan();
    setTimeout(() => this.elements.logText.focus(), 100);
  },

  cancelLog() {
    if (!this.isAwaitingLog) return;
    const ok = window.confirm('Erase this log? This time will NOT be logged, NOT counted as work hours, and NOT billable. If you actually worked, please fill the note and click Send.');
    if (!ok) return;

    this.completeCurrentPendingLog();
  },

  async submitLog() {
    if (!this.isAwaitingLog) return;

    const text = this.elements.logText.value.trim();
    if (!text) {
      this.toast('Please enter a short description', 'error');
      this.elements.logText.focus();
      return;
    }

    const timespan = this.validateLogTimespan();
    if (!timespan) {
      return;
    }

    this.isSavingLog = true;
    this.elements.registerLog.disabled = true;
    this.elements.registerLog.textContent = 'Saving...';

    try {
      const filename = this.buildFilename(timespan.endDate, this.user.login, timespan.durationMs);
      const path = `logs/${filename}`;

      // Get enhanced metadata
      const projectId = this.elements.logProject?.value || '';
      const category = this.elements.logCategory?.value || 'other';
      const energy = this.elements.logEnergy?.value || 'medium';

      if (projectId || category || energy) {
        Enhanced.saveLogMetadata(path, {
          project: projectId,
          category: category,
          energy: energy,
          createdAt: new Date().toISOString()
        });
      }

      this.addPendingLog(path, text);

      await this.addLogLocal(path, text);
      this.toast('Log saved locally', 'success');

      this.elements.logText.value = '';
      localStorage.removeItem('worklog_draft');

      if (this.pomodoroMode) {
        this.completePomodoroSession();
      }

      this.completeCurrentPendingLog();
    } catch (err) {
      this.toast(`Failed to save: ${err.message}`, 'error');
    } finally {
      this.isSavingLog = false;
      this.elements.registerLog.textContent = 'Send';
      if (this.isAwaitingLog) {
        this.validateLogTimespan();
      } else {
        this.elements.registerLog.disabled = false;
      }
    }
  },

  triggerAttention() {
    this.flashScreen();
    this.updateFavicon(true);
    this.sendNotification();
    this.vibrateDevice();
    this.setTitleAlert(true);
  },

  clearAttention() {
    this.updateFavicon(false);
    this.setTitleAlert(false);
  },

  flashScreen() {
    document.body.classList.remove('attention-flash');
    void document.body.offsetHeight;
    document.body.classList.add('attention-flash');
    setTimeout(() => document.body.classList.remove('attention-flash'), 1000);
  },

  setTitleAlert(active) {
    document.title = active ? 'Worklog — Action Needed' : this.originalTitle;
  },

  updateFavicon(active) {
    const favicon = document.getElementById('favicon');
    if (!favicon) return;
    const svg = active
      ? "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23b42318'/%3E%3Ctext x='50' y='62' font-size='58' text-anchor='middle' fill='%23ffffff' font-family='Arial'%3E!%3C/text%3E%3C/svg%3E"
      : "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23111111'/%3E%3Ctext x='50' y='62' font-size='58' text-anchor='middle' fill='%23ffffff' font-family='Arial'%3EW%3C/text%3E%3C/svg%3E";
    favicon.href = `data:image/svg+xml,${svg}`;
  },

  sendNotification() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Worklog', {
        body: 'Time to send your work log.',
        silent: true
      });
    } catch (err) {
      this.toast(`Import failed: ${err.message}`, "error");
    }
  },

  vibrateDevice() {
    if (navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 60, 120]);
    }
  },

  formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.max(0, Math.floor(totalSeconds / 60));
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  },

  populateLogTimespan(durationMs, endAtMs = Date.now()) {
    const endDate = new Date(endAtMs);
    const parts = Time.getZonedParts(endDate);
    const normalizedDurationMs = Math.max(60 * 1000, Math.floor(durationMs || 0));
    const totalMinutes = Math.max(1, Math.round(normalizedDurationMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const dateValue = Time.formatDateValue(parts);
    const timeValue = Time.formatTimeValue(parts);
    const hoursValue = String(hours);
    const minutesValue = String(minutes);

    if (this.elements.logDate) {
      this.elements.logDate.value = dateValue;
    }
    if (this.elements.logTime) {
      this.elements.logTime.value = timeValue;
    }
    if (this.elements.logHours) {
      this.elements.logHours.value = hoursValue;
    }
    if (this.elements.logMinutes) {
      this.elements.logMinutes.value = minutesValue;
    }

    this.logTimespanBaseline = {
      dateValue,
      timeValue,
      hoursValue,
      minutesValue,
      durationMs: normalizedDurationMs,
      endAtMs: Math.floor(endAtMs)
    };
    this.logTimespanEdited = false;
  },

  getTimespanFromInputs() {
    const dateValue = this.elements.logDate?.value;
    const timeValue = this.elements.logTime?.value;
    const hoursValue = this.elements.logHours?.value;
    const minutesValue = this.elements.logMinutes?.value;

    const dateParts = Time.parseDateValue(dateValue);
    if (!dateParts) {
      return { valid: false, error: 'Select a valid date.' };
    }

    const timeParts = Time.parseTimeValue(timeValue);
    if (!timeParts) {
      return { valid: false, error: 'Select a valid end time.' };
    }

    const hours = Number(hoursValue);
    const minutes = Number(minutesValue);
    if (!Number.isInteger(hours) || hours < 0) {
      return { valid: false, error: 'Enter valid hours.' };
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      return { valid: false, error: 'Minutes must be between 0 and 59.' };
    }

    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes <= 0) {
      return { valid: false, error: 'Duration must be at least 1 minute.' };
    }

    const baseline = this.logTimespanBaseline;
    const useBaselineSeconds =
      !this.logTimespanEdited &&
      !!baseline &&
      baseline.dateValue === dateValue &&
      baseline.timeValue === timeValue &&
      baseline.hoursValue === String(hours) &&
      baseline.minutesValue === String(minutes);

    if (useBaselineSeconds) {
      const endDate = new Date(baseline.endAtMs);
      const durationMs = baseline.durationMs;
      const startDate = new Date(endDate.getTime() - durationMs);

      return {
        valid: true,
        endDate,
        startDate,
        durationMs,
        dateValue: baseline.dateValue,
        timeValue: baseline.timeValue
      };
    }

    const endDate = Time.zonedPartsToDate({
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0
    });

    const durationMs = totalMinutes * 60 * 1000;
    const startDate = new Date(endDate.getTime() - durationMs);

    return {
      valid: true,
      endDate,
      startDate,
      durationMs,
      dateValue: Time.formatDateValue(dateParts),
      timeValue: Time.formatTimeValue(timeParts)
    };
  },

  findOverlap(startDate, endDate) {
    if (!this.user || !this.user.login) return null;
    const username = this.user.login;

    for (const log of this.logsByPath.values()) {
      if (log.username !== username) continue;
      const end = log.dateObj || this.buildDate(log.date, log.time);
      if (!end) continue;
      if (!log.dateObj) log.dateObj = end;
      const duration = log.durationMs || this.intervalMs;
      const start = new Date(end.getTime() - duration);
      if (startDate < end && endDate > start) {
        return log;
      }
    }

    return null;
  },

  async adjustOverlappingLogs(newLogStartDate, newLogEndDate) {
    if (!this.user || !this.user.login) return;
    const username = this.user.login;

    const logsToAdjust = [];

    for (const [path, log] of this.logsByPath.entries()) {
      if (log.username !== username) continue;

      const logEnd = log.dateObj || this.buildDate(log.date, log.time);
      if (!logEnd) continue;
      if (!log.dateObj) log.dateObj = logEnd;

      const logDuration = log.durationMs || this.intervalMs;
      const logStart = new Date(logEnd.getTime() - logDuration);

      if (logStart < newLogEndDate && logEnd > newLogStartDate) {
        const adjustedDuration = newLogStartDate.getTime() - logStart.getTime();

        logsToAdjust.push({
          oldPath: path,
          log: log,
          adjustedDuration: adjustedDuration,
          newEndDate: new Date(newLogStartDate)
        });
      }
    }

    for (const adjustment of logsToAdjust) {
      const { oldPath, log, adjustedDuration, newEndDate } = adjustment;

      if (adjustedDuration > 0) {
        this.logsByPath.delete(oldPath);

        const newFilename = this.buildFilename(newEndDate, username, adjustedDuration);
        const newPath = `logs/${newFilename}`;

        const adjustedLog = {
          ...log,
          path: newPath,
          date: Time.formatDateValue(Time.getZonedParts(newEndDate)),
          time: Time.formatTimeValue(Time.getZonedParts(newEndDate)),
          dateObj: newEndDate,
          durationMs: adjustedDuration,
          project: log.project || null,
          category: log.category || null,
          energy: log.energy || null,
          createdAt: log.createdAt || new Date().toISOString()
        };

        this.logsByPath.set(newPath, adjustedLog);
      } else {
        this.logsByPath.delete(oldPath);
      }
    }

    if (logsToAdjust.length > 0) {
      this.logsVersion += 1;
      this.renderLogs();
      await this.syncCacheFromMemory();
    }
  },

  setLogError(message) {
    if (!this.elements.logError) return;
    this.elements.logError.textContent = message;
    this.elements.logError.classList.remove('hidden');
  },

  clearLogError() {
    if (!this.elements.logError) return;
    this.elements.logError.textContent = '';
    this.elements.logError.classList.add('hidden');
  },

  validateLogTimespan() {
    const result = this.getTimespanFromInputs();
    if (!result.valid) {
      this.setLogError(result.error);
      if (!this.isSavingLog) {
        this.elements.registerLog.disabled = true;
      }
      return null;
    }
    
    this.clearLogError();

    if (!this.isSavingLog) {
      this.elements.registerLog.disabled = false;
    }
    return result;
  },

  buildFilename(date, username, durationMs) {
    const pad = (num) => String(num).padStart(2, '0');
    const parts = Time.getZonedParts(date);
    const year = parts.year;
    const month = pad(parts.month);
    const day = pad(parts.day);
    const hour = pad(parts.hour);
    const minute = pad(parts.minute);
    const second = pad(parts.second);
    const ms = String(parts.ms).padStart(3, '0');
    const duration = this.formatDuration(durationMs || 0);
    return `${year}-${month}-${day}.${hour}h${minute}m${second}s${ms}ms.${duration}.${username}.txt`;
  },

  parseLogPath(path) {
    const filename = path.split('/').pop();
    const parts = filename.split('.');

    if (parts.length < 4) return null;

    const date = parts[0];
    const timeRaw = parts[1];
    const durationRaw = parts.length >= 5 ? parts[2] : null;
    const username = parts.length >= 5 ? parts[3] : parts[2];

    const match = timeRaw.match(/(\d{2})h(\d{2})m(\d{2})s(?:(\d{3})ms)?/);
    const time = match ? `${match[1]}:${match[2]}:${match[3]}` : timeRaw;
    const durationMatch = durationRaw ? durationRaw.match(/(\d{2,})m(\d{2})s/) : null;
    const duration = durationMatch ? durationRaw : null;

    return { date, time, duration, username };
  },

  async addLogLocal(path, text, metadata = {}) {
    const parsed = this.parseLogPath(path);
    if (!parsed) {
      return;
    }

    const log = this.buildLogEntry(path, parsed, text);

    log.project = metadata.project || null;
    log.category = metadata.category || null;
    log.energy = metadata.energy || null;
    log.createdAt = metadata.createdAt || new Date().toISOString();

    this.logsByPath.set(path, log);
    this.logsVersion += 1;

    this.renderLogs();

    await this.saveLogsToCache([log]);
  },

  buildLogEntry(path, parsed, text) {
    const dateObj = this.buildDate(parsed.date, parsed.time);
    return {
      path,
      ...parsed,
      dateObj,
      durationMs: this.parseDuration(parsed.duration),
      text
    };
  },

  async loadLogs(forceFull = false) {
    return true;
  },

  handleLoadLogsError(err) {
    if (this.applyPollBackoff(err)) {
      const now = Date.now();
      if (this.user && this.isPageVisible()) {
        this.scheduleNextPoll();
      }
      if (now - this.lastThrottleToastAtMs > 15000) {
        const waitMs = Math.max(0, this.pollBackoffUntilMs - now);
        const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
        this.toast(`GitHub is throttling requests. Retrying in ~${waitSeconds}s.`, 'error');
        this.lastThrottleToastAtMs = now;
      }
    } else {
      this.toast(`Failed to load logs: ${err.message}`, 'error');
    }
    this.updateLogUI();
  },

  applyPollBackoff(err) {
    if (!err || !err.isThrottle) return false;

    const now = Date.now();
    let backoffMs = 0;

    if (Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0) {
      backoffMs = err.retryAfterMs;
    } else if (Number.isFinite(err.rateLimitResetMs) && err.rateLimitResetMs > 0) {
      backoffMs = err.rateLimitResetMs + 1000;
    } else {
      const previous = this.pollBackoffMs > 0 ? this.pollBackoffMs : this.pollBaseMs;
      backoffMs = Math.min(previous * 2, 10 * 60 * 1000);
    }

    backoffMs = Math.max(this.pollBaseMs, Math.floor(backoffMs));
    this.pollBackoffMs = backoffMs;
    this.pollBackoffUntilMs = Math.max(this.pollBackoffUntilMs, now + backoffMs);
    return true;
  },

  resetPollBackoff() {
    this.pollBackoffMs = 0;
    this.pollBackoffUntilMs = 0;
  },

  async loadAllLogs(headSha) {
    const entries = await GitHub.listLogTree();
    this.logsByPath.clear();
    this.renderedPaths = [];
    this.renderedPathSet = new Set();
    await this.storeEntries(entries, { skipExisting: false });
    this.mergePendingLogs();
    this.saveLastSeen(headSha);
    this.renderLogs();
    await this.syncCacheFromMemory();
  },

  async loadIncrementalLogs(headSha) {
    if (headSha === this.lastSeenSha) {
      this.updateLogUI();
      return;
    }

    let compare;
    try {
      compare = await GitHub.compareCommits(this.lastSeenSha, headSha);
    } catch (err) {
      await this.loadAllLogs(headSha);
      return;
    }

    if (!compare || !compare.status) {
      await this.loadAllLogs(headSha);
      return;
    }

    if (compare.status !== 'ahead' && compare.status !== 'identical') {
      await this.loadAllLogs(headSha);
      return;
    }

    const files = (compare.files || [])
      .filter(file => file.filename && file.filename.startsWith('logs/'))
      .filter(file => file.status !== 'removed')
      .map(file => ({ path: file.filename, sha: file.sha }));

    if (files.length >= 300) {
      await this.loadAllLogs(headSha);
      return;
    }

    if (files.length === 0) {
      this.saveLastSeen(headSha);
      this.updateLogUI();
      return;
    }

    const remoteAdded = await this.storeEntries(files, { skipExisting: true });
    const pendingAdded = this.mergePendingLogs();
    this.saveLastSeen(headSha);
    this.renderLogs();
    await this.saveLogsToCache([...remoteAdded, ...pendingAdded]);
  },

  async storeEntries(entries, { skipExisting }) {
    const targets = skipExisting
      ? entries.filter(entry => !this.logsByPath.has(entry.path))
      : entries;

    if (targets.length === 0) {
      return [];
    }

    const batchSize = 5;
    let added = 0;
    const addedLogs = [];
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const contents = await Promise.all(batch.map(item => GitHub.getBlobContent(item.sha)));

      batch.forEach((entry, index) => {
        const parsed = this.parseLogPath(entry.path);
        if (!parsed) return;
        const log = this.buildLogEntry(entry.path, parsed, contents[index]);
        this.logsByPath.set(entry.path, log);
        addedLogs.push(log);
        added += 1;
      });
    }

    if (added > 0) {
      this.logsVersion += added;
    }

    return addedLogs;
  },

  initTimeline() {
    if (this.timeline.initialized) return;
    this.timeline.initialized = true;
    this.timeline.gridDirty = true;
    this.timeline.rowsDirty = true;
  },

  scheduleTimelineRender({ grid = false, rows = false } = {}) {
    if (grid) this.timeline.gridDirty = true;
    if (rows) this.timeline.rowsDirty = true;
    if (!this.isTimelineVisible()) return;
    if (this.timeline.renderScheduled) return;
    this.timeline.renderScheduled = true;
    requestAnimationFrame(() => {
      this.timeline.renderScheduled = false;
      this.renderTimelineNow();
    });
  },

  renderTimelineNow() {
    if (!this.timeline.initialized) return;
    if (!this.isTimelineVisible()) return;
    if (!this.ensureTimelineSized()) return;
    if (this.timeline.gridDirty) {
      this.renderTimelineGrid();
      this.timeline.gridDirty = false;
    }
    if (this.timeline.rowsDirty) {
      this.renderTimelineRows();
      this.timeline.rowsDirty = false;
    }
  },

  ensureTimelineSized(anchorDate = null, align = 'center') {
    const viewWidth = this.elements.timelineScroll.clientWidth;
    if (!viewWidth) return false;

    const periodWidth = this.timeline.periodWidth[this.timeline.scale];
    const canvasWidth = Math.max(viewWidth * this.timeline.bufferScreens, periodWidth * 30);
    const periodCount = Math.ceil(canvasWidth / periodWidth);
    this.timeline.periodCount = periodCount;

    const totalWidth = periodCount * periodWidth;
    this.elements.timelineCanvas.style.width = `${totalWidth}px`;
    this.elements.timelineLabels.style.width = `${totalWidth}px`;

    if (!this.timeline.anchorStart || anchorDate) {
      const base = anchorDate || new Date();
      const offset = align === 'left' ? Math.floor(periodCount / 3) : Math.floor(periodCount / 2);
      this.timeline.anchorStart = this.startOfPeriod(
        this.addPeriods(base, -offset, this.timeline.scale),
        this.timeline.scale
      );
    }

    return true;
  },

  positionTimelineOnDate(date, align = 'center') {
    const viewWidth = this.elements.timelineScroll.clientWidth;
    if (!viewWidth) return;
    const totalWidth = this.timeline.periodCount * this.timeline.periodWidth[this.timeline.scale];
    const x = this.timeToX(date);
    const maxScroll = Math.max(0, totalWidth - viewWidth);
    const offset = align === 'left' ? 0 : viewWidth / 2;
    const target = Math.min(Math.max(0, x - offset), maxScroll);
    this.elements.timelineScroll.scrollLeft = target;
  },

  setTimelineScale(scale) {
    if (!scale || scale === this.timeline.scale) return;
    const today = new Date();

    this.timeline.scale = scale;
    document.querySelectorAll('.scale-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scale === scale);
    });

    const periodStart = this.startOfPeriod(today, scale);
    this.timeline.anchorStart = null;
    this.ensureTimelineSized(periodStart, 'left');
    this.positionTimelineOnDate(periodStart, 'left');
    this.renderTimeline();
    this.updateTimelineTotal();
  },

  handleTimelineScroll() {
    if (this.timeline.adjusting) return;
    const scrollLeft = this.elements.timelineScroll.scrollLeft;
    const viewWidth = this.elements.timelineScroll.clientWidth;
    const totalWidth = this.timeline.periodCount * this.timeline.periodWidth[this.timeline.scale];
    const threshold = viewWidth;
    const shiftPeriods = Math.floor(this.timeline.periodCount / 3);
    const shiftWidth = shiftPeriods * this.timeline.periodWidth[this.timeline.scale];

    if (scrollLeft < threshold) {
      this.timeline.adjusting = true;
      this.timeline.anchorStart = this.addPeriods(this.timeline.anchorStart, -shiftPeriods, this.timeline.scale);
      this.elements.timelineScroll.scrollLeft = scrollLeft + shiftWidth;
      this.timeline.adjusting = false;
      this.renderTimeline();
      return;
    }

    if (scrollLeft > totalWidth - threshold) {
      this.timeline.adjusting = true;
      this.timeline.anchorStart = this.addPeriods(this.timeline.anchorStart, shiftPeriods, this.timeline.scale);
      this.elements.timelineScroll.scrollLeft = scrollLeft - shiftWidth;
      this.timeline.adjusting = false;
      this.renderTimeline();
      return;
    }
  },

  renderTimeline() {
    this.scheduleTimelineRender({ grid: true, rows: true });
  },

  renderTimelineGrid() {
    const grid = this.elements.timelineGrid;
    const labels = this.elements.timelineLabels;
    grid.innerHTML = '';
    labels.innerHTML = '';

    const scale = this.timeline.scale;
    const periodWidth = this.timeline.periodWidth[scale];
    const periods = this.timeline.periodCount;
    const gridFragment = document.createDocumentFragment();
    const labelFragment = document.createDocumentFragment();

    for (let i = 0; i <= periods; i += 1) {
      const x = i * periodWidth;
      const line = document.createElement('div');
      line.className = 'timeline-line';
      line.style.left = `${x}px`;
      gridFragment.appendChild(line);

      if (i < periods) {
        const label = document.createElement('div');
        label.className = 'timeline-label';
        const date = this.addPeriods(this.timeline.anchorStart, i, scale);
        label.textContent = this.formatPeriodLabel(date, scale);
        label.style.left = `${x + 4}px`;
        labelFragment.appendChild(label);
      }
    }

    grid.appendChild(gridFragment);
    labels.appendChild(labelFragment);
  },

  formatPeriodLabel(date, scale) {
    const parts = Time.getZonedParts(date);
    const year = parts.year;
    const month = this.months[parts.month - 1];
    const day = String(parts.day).padStart(2, '0');

    if (scale === 'daily') {
      return `${year} ${month} ${day}`;
    }
    if (scale === 'weekly') {
      return `Wk ${year} ${month} ${day}`;
    }
    if (scale === 'yearly') {
      return `${year} ${month}`;
    }
    return `${year} ${month}`;
  },

  renderTimelineRows() {
    const rows = this.elements.timelineRows;
    rows.innerHTML = '';

    const width = this.timeline.periodCount * this.timeline.periodWidth[this.timeline.scale];
    const rangeStart = this.timeline.anchorStart;
    const rangeEnd = this.addPeriods(rangeStart, this.timeline.periodCount, this.timeline.scale);
    const users = this.collectUsers();

    const fragment = document.createDocumentFragment();

    users.forEach(user => {
      const row = document.createElement('div');
      row.className = 'timeline-row';

      const userCell = document.createElement('div');
      userCell.className = 'timeline-user';
      userCell.title = user.username;

      const avatar = document.createElement('img');
      avatar.src = this.generateAvatar(user.username);
      avatar.alt = user.username;
      userCell.appendChild(avatar);

      const track = document.createElement('div');
      track.className = 'timeline-track';
      track.style.width = `${width}px`;

      user.logs.forEach(log => {
        if (!log.dateObj) return;
        const durationMs = log.durationMs || this.intervalMs;
        const endTime = log.dateObj;
        const startTime = new Date(endTime.getTime() - durationMs);
        if (endTime < rangeStart || startTime > rangeEnd) return;
        const visibleStart = startTime < rangeStart ? rangeStart : startTime;
        const visibleEnd = endTime > rangeEnd ? rangeEnd : endTime;
        const visibleDuration = Math.max(0, visibleEnd - visibleStart);
        if (visibleDuration <= 0) return;
        const x = this.timeToX(visibleStart);
        let barWidth = this.durationToWidth(visibleStart, visibleDuration);
        const minWidth = 6;
        const isTiny = barWidth < minWidth;
        if (isTiny) barWidth = minWidth;

        const bar = document.createElement('div');
        bar.className = 'timeline-bar';
        bar.style.left = `${x}px`;
        bar.style.width = `${barWidth}px`;
        if (isTiny) {
          bar.classList.add('tiny');
        }

        bar.addEventListener('mouseenter', (event) => this.showTimelineTooltip(event, log));
        bar.addEventListener('mouseleave', () => this.hideTimelineTooltip());

        track.appendChild(bar);
      });

      row.appendChild(userCell);
      row.appendChild(track);
      fragment.appendChild(row);
    });

    rows.appendChild(fragment);
  },

  collectUsers() {
    const byUser = new Map();

    for (const log of this.logsByPath.values()) {
      if (!log.username) continue;
      const dateObj = log.dateObj || this.buildDate(log.date, log.time);
      if (!dateObj) continue;
      const entry = byUser.get(log.username) || [];
      if (!log.dateObj) {
        log.dateObj = dateObj;
      }
      entry.push(log);
      byUser.set(log.username, entry);
    }

    return Array.from(byUser.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([username, logs]) => ({
        username,
        logs: logs.sort((a, b) => a.dateObj - b.dateObj)
      }));
  },

  buildDate(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const timeParts = timeStr.split(':');
    const hour = Number(timeParts[0] || 0);
    const minute = Number(timeParts[1] || 0);
    const second = Number(timeParts[2] || 0);
    if (!year || !month || !day) return null;
    return Time.zonedPartsToDate({ year, month, day, hour, minute, second });
  },

  parseDuration(duration) {
    if (!duration) return 0;
    const match = duration.match(/(\d{2,})m(\d{2})s/);
    if (!match) return 0;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    return (minutes * 60 + seconds) * 1000;
  },

  durationToWidth(startDate, durationMs) {
    const scale = this.timeline.scale;
    const periodWidth = this.timeline.periodWidth[scale];

    if (scale === 'daily') {
      return (durationMs / (24 * 60 * 60 * 1000)) * periodWidth;
    }

    if (scale === 'weekly') {
      return (durationMs / (7 * 24 * 60 * 60 * 1000)) * periodWidth;
    }

    if (scale === 'yearly') {
      const daysInMonth = this.daysInMonth(startDate);
      return (durationMs / (daysInMonth * 24 * 60 * 60 * 1000)) * periodWidth;
    }

    const daysInMonth = this.daysInMonth(startDate);
    return (durationMs / (daysInMonth * 24 * 60 * 60 * 1000)) * periodWidth;
  },

  timeToX(date) {
    const scale = this.timeline.scale;
    const periodWidth = this.timeline.periodWidth[scale];
    const anchor = this.timeline.anchorStart;

    if (scale === 'daily') {
      return ((date - anchor) / (24 * 60 * 60 * 1000)) * periodWidth;
    }

    if (scale === 'weekly') {
      return ((date - anchor) / (7 * 24 * 60 * 60 * 1000)) * periodWidth;
    }

    const monthsDiff = this.monthDiff(anchor, date);
    const baseMonth = this.addMonths(anchor, monthsDiff);
    const daysInMonth = this.daysInMonth(baseMonth);
    const offset = (date - baseMonth) / (daysInMonth * 24 * 60 * 60 * 1000);
    return monthsDiff * periodWidth + offset * periodWidth;
  },

  dateFromX(x) {
    const scale = this.timeline.scale;
    const periodWidth = this.timeline.periodWidth[scale];
    const anchor = this.timeline.anchorStart;

    if (scale === 'daily') {
      const ms = (x / periodWidth) * (24 * 60 * 60 * 1000);
      return new Date(anchor.getTime() + ms);
    }

    if (scale === 'weekly') {
      const ms = (x / periodWidth) * (7 * 24 * 60 * 60 * 1000);
      return new Date(anchor.getTime() + ms);
    }

    const monthsDiff = Math.floor(x / periodWidth);
    const offset = x - monthsDiff * periodWidth;
    const baseMonth = this.addMonths(anchor, monthsDiff);
    const daysInMonth = this.daysInMonth(baseMonth);
    const ms = (offset / periodWidth) * (daysInMonth * 24 * 60 * 60 * 1000);
    return new Date(baseMonth.getTime() + ms);
  },

  startOfPeriod(date, scale) {
    const parts = Time.getZonedParts(date);
    let year = parts.year;
    let month = parts.month;
    let day = parts.day;

    if (scale === 'weekly') {
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const diff = (weekday === 0 ? -6 : 1) - weekday;
      day += diff;
    }

    if (scale === 'monthly' || scale === 'yearly') {
      day = 1;
    }

    return Time.zonedPartsToDate({ year, month, day, hour: 0, minute: 0, second: 0 });
  },

  addPeriods(date, count, scale) {
    if (scale === 'daily') return this.addDays(date, count);
    if (scale === 'weekly') return this.addDays(date, count * 7);
    // Both monthly and yearly use months as periods
    return this.addMonths(date, count);
  },

  addDays(date, days) {
    const parts = Time.getZonedParts(date);
    const normalized = new Date(Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + days,
      parts.hour,
      parts.minute,
      parts.second
    ));

    return Time.zonedPartsToDate({
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate(),
      hour: normalized.getUTCHours(),
      minute: normalized.getUTCMinutes(),
      second: normalized.getUTCSeconds()
    });
  },

  addMonths(date, months) {
    const parts = Time.getZonedParts(date);
    const totalMonths = parts.year * 12 + (parts.month - 1) + months;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = totalMonths - year * 12;
    const month = monthIndex + 1;
    const max = Time.daysInMonthParts(year, month);
    const day = Math.min(parts.day, max);

    return Time.zonedPartsToDate({
      year,
      month,
      day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second
    });
  },

  daysInMonth(date) {
    const parts = Time.getZonedParts(date);
    return Time.daysInMonthParts(parts.year, parts.month);
  },

  monthDiff(start, end) {
    const startParts = Time.getZonedParts(start);
    const endParts = Time.getZonedParts(end);
    return (endParts.year - startParts.year) * 12 + (endParts.month - startParts.month);
  },

  showTimelineTooltip(event, log) {
    const tooltip = this.elements.timelineTooltip;
    const duration = log.duration || this.formatDuration(log.durationMs || this.intervalMs);
    tooltip.textContent = `${log.date} ${log.time}\n${duration}\n@${log.username}\n${log.text}`;
    tooltip.classList.remove('hidden');

    const padding = 12;
    const x = Math.min(window.innerWidth - tooltip.offsetWidth - padding, event.clientX + padding);
    const y = Math.min(window.innerHeight - tooltip.offsetHeight - padding, event.clientY + padding);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  },

  hideTimelineTooltip() {
    this.elements.timelineTooltip.classList.add('hidden');
  },

  renderLogs() {
    const allPaths = Array.from(this.logsByPath.keys()).sort();

    const paths = allPaths.filter(path => {
      const log = this.logsByPath.get(path);
      return log && this.matchesFilters(log);
    });

    if (allPaths.length === 0) {
      this.elements.logList.innerHTML = '';
      this.renderedPaths = [];
      this.renderedPathSet = new Set();
      this.updateLogUI();
      this.scheduleTimelineRender({ rows: true });
      return;
    }

    if (paths.length === 0) {
      this.elements.logList.innerHTML = '<div class="log-empty" style="position:relative;">No logs match your filters</div>';
      this.renderedPaths = [];
      this.renderedPathSet = new Set();
      return;
    }

    const mustRebuild =
      this.renderedPaths.length === 0 ||
      paths.length < this.renderedPaths.length ||
      !this.renderedPathSet ||
      (this.renderedPaths.length > 0 && paths[0] !== this.renderedPaths[0]);

    if (mustRebuild) {
      const fragment = document.createDocumentFragment();
      for (const path of paths) {
        const log = this.logsByPath.get(path);
        if (!log) continue;
        fragment.appendChild(this.buildLogItem(log));
      }
      this.elements.logList.innerHTML = '';
      this.elements.logList.appendChild(fragment);
      this.renderedPaths = paths;
      this.renderedPathSet = new Set(paths);
      this.updateLogUI();
      this.scrollToBottom();
      this.scheduleTimelineRender({ rows: true });
      return;
    }

    const newPaths = paths.filter(path => !this.renderedPathSet.has(path));
    if (newPaths.length === 0) {
      this.updateLogUI();
      return;
    }

    newPaths.sort();
    const lastRendered = this.renderedPaths[this.renderedPaths.length - 1];
    if (newPaths[0] < lastRendered) {
      this.renderedPaths = [];
      this.renderedPathSet = new Set();
      this.renderLogs();
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const path of newPaths) {
      const log = this.logsByPath.get(path);
      if (!log) continue;
      fragment.appendChild(this.buildLogItem(log));
      this.renderedPathSet.add(path);
      this.renderedPaths.push(path);
    }
    this.elements.logList.appendChild(fragment);
    this.updateLogUI();
    this.scrollToBottom();
    this.scheduleTimelineRender({ rows: true });
  },

  buildLogItem(log) {
    const item = document.createElement('div');
    item.className = 'log-item';

    // Get enhanced metadata
    const metadata = this.getLogMetadata(log);
    const category = metadata?.category;
    const projectId = metadata?.project;
    const energy = metadata?.energy;

    const meta = document.createElement('div');
    meta.className = 'log-meta';
    meta.appendChild(document.createTextNode(`${log.date} ${log.time} `));

    if (log.duration) {
      meta.appendChild(document.createTextNode(`${log.duration} `));
    }

    const userLink = document.createElement('a');
    userLink.href = `https://github.com/${log.username}`;
    userLink.textContent = `@${log.username}`;
    userLink.target = '_blank';
    userLink.rel = 'noopener';
    userLink.className = 'log-user-link';
    meta.appendChild(userLink);

    if (category && Enhanced.categories[category]) {
      const catInfo = Enhanced.categories[category];
      const badge = document.createElement('span');
      badge.className = 'log-badge';
      badge.style.backgroundColor = catInfo.color;
      badge.textContent = `${catInfo.icon} ${catInfo.name}`;
      badge.title = `Category: ${catInfo.name}`;
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(badge);
    }

    if (projectId) {
      const projects = Enhanced.getProjects();
      const project = projects.find(p => p.id === projectId);
      if (project) {
        const projBadge = document.createElement('span');
        projBadge.className = 'log-badge';
        projBadge.style.backgroundColor = project.color;
        projBadge.textContent = `📁 ${project.name}`;
        projBadge.title = `Project: ${project.name}`;
        meta.appendChild(document.createTextNode(' '));
        meta.appendChild(projBadge);
      }
    }

    if (energy && Enhanced.energyLevels[energy]) {
      const energyInfo = Enhanced.energyLevels[energy];
      const energyBadge = document.createElement('span');
      energyBadge.className = 'log-badge log-badge-energy';
      energyBadge.textContent = energyInfo.icon;
      energyBadge.title = `Energy: ${energyInfo.name}`;
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(energyBadge);
    }

    const message = document.createElement('div');
    message.className = 'log-message';
    message.textContent = log.text;

    const actions = document.createElement('div');
    actions.className = 'log-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'log-action-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit log';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editLog(log.path);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'log-action-btn log-action-delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = 'Delete log';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteLog(log.path);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(meta);
    item.appendChild(message);
    item.appendChild(actions);
    return item;
  },

  updateLogUI() {
    const hasLogs = this.logsByPath.size > 0;
    this.elements.logLoading.classList.add('hidden');
    this.elements.logEmpty.classList.toggle('hidden', hasLogs);
    this.updateTodayHours();
    this.updateTimelineTotal();
  },

  scrollToBottom() {
    if (this.elements.logsView.classList.contains('hidden')) return;
    this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
  },

  getNextPollDelayMs() {
    const jitter = this.pollJitterMs > 0 ? Math.floor(Math.random() * this.pollJitterMs) : 0;
    const baseDelay = this.pollBaseMs + jitter;
    const backoffDelay = Math.max(0, this.pollBackoffUntilMs - Date.now());
    return Math.max(baseDelay, backoffDelay);
  },

  scheduleNextPoll(delayOverrideMs = null) {
    if (this.pollInterval) clearTimeout(this.pollInterval);
    this.pollInterval = null;

    if (!this.user || !this.isPageVisible()) {
      return;
    }

    const delay = delayOverrideMs == null
      ? this.getNextPollDelayMs()
      : Math.max(delayOverrideMs, Math.max(0, this.pollBackoffUntilMs - Date.now()));

    this.pollInterval = setTimeout(async () => {
      this.pollInterval = null;
      if (!this.user || !this.isPageVisible()) return;
      await this.loadLogs();
      this.scheduleNextPoll();
    }, delay);
  },

  startPolling() {
    this.scheduleNextPoll();
  },

  playBeep() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.audioCtx = new AudioContext();
    }

    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(ctx.destination);

    const tones = [
      { freq: 440, start: now, duration: 0.18 },
      { freq: 660, start: now + 0.22, duration: 0.14 }
    ];

    tones.forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);

      gain.gain.setValueAtTime(0.0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.start(start);
      osc.stop(start + duration);
    });
  },

  toast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    this.elements.toastContainer.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  },

  showStats() {
    const logs = Array.from(this.logsByPath.values());
    const totalLogs = logs.length;

    if (totalLogs === 0) {
      this.elements.statsContent.innerHTML = '<p>No logs yet. Start tracking your time!</p>';
      this.showModal(this.elements.statsModal);
      return;
    }

    const totalMs = logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);

    const byDate = {};
    logs.forEach(log => {
      if (!log.date) return;
      const dateKey = log.date;
      byDate[dateKey] = (byDate[dateKey] || 0) + (log.durationMs || 0);
    });

    const dates = Object.keys(byDate).sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const avgPerDay = dates.length > 0 ? (totalMs / dates.length / (1000 * 60 * 60)).toFixed(2) : 0;

    const productivityScore = Enhanced.calculateProductivityScore(logs, new Date());

    const categoryTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const category = meta?.category || 'other';
      categoryTotals[category] = (categoryTotals[category] || 0) + (log.durationMs || 0);
    });

    const categoryBreakdown = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, ms]) => {
        const catInfo = Enhanced.categories[cat] || { icon: '📌', name: cat };
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `<div class="stat-row">
          <span>${catInfo.icon} ${catInfo.name}</span>
          <span>${hours}h (${percent}%)</span>
        </div>`;
      })
      .join('');

    const projectTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const projectId = meta?.project;
      if (projectId) {
        projectTotals[projectId] = (projectTotals[projectId] || 0) + (log.durationMs || 0);
      }
    });

    const projects = Enhanced.getProjects();
    const projectBreakdown = Object.entries(projectTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([projId, ms]) => {
        const project = projects.find(p => p.id === projId);
        if (!project) return '';
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `<div class="stat-row">
          <span>📁 ${project.name}</span>
          <span>${hours}h (${percent}%)</span>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    const energyTotals = { high: 0, medium: 0, low: 0 };
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const energy = meta?.energy || 'medium';
      if (energyTotals[energy] !== undefined) {
        energyTotals[energy]++;
      }
    });

    const energyBreakdown = Object.entries(energyTotals)
      .map(([level, count]) => {
        const info = Enhanced.energyLevels[level];
        if (!info) return '';
        const percent = ((count / totalLogs) * 100).toFixed(0);
        return `<div class="stat-row">
          <span>${info.icon} ${info.name}</span>
          <span>${count} logs (${percent}%)</span>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    const topDays = Object.entries(byDate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([date, ms]) => {
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        return `<div class="stat-row"><span>${date}</span><span>${hours}h</span></div>`;
      })
      .join('');

    const insights = Enhanced.getProductivityInsights(logs, 7);
    const pomodoroInsights = Enhanced.getPomodoroInsights(7);
    const allInsights = [...insights, ...pomodoroInsights];
    const insightsHTML = allInsights.map(insight =>
      `<li>${insight.text}</li>`
    ).join('');

    const goals = Enhanced.getGoals();
    const todayMs = this.computePeriodTotalMs('daily');
    const todayHours = todayMs / (1000 * 60 * 60);
    const dailyProgress = goals.daily.enabled ?
      `<div class="progress-bar">
        <div class="progress-fill" style="width: ${Math.min(100, (todayHours / goals.daily.hours) * 100)}%"></div>
      </div>
      <div class="stat-row">
        <span>Daily Goal</span>
        <span>${todayHours.toFixed(1)}h / ${goals.daily.hours}h</span>
      </div>` : '';

    this.elements.statsContent.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-title">📊 Overview</div>
          <div class="stat-row"><span>Total logs</span><span>${totalLogs}</span></div>
          <div class="stat-row"><span>Total hours</span><span>${totalHours}h</span></div>
          <div class="stat-row"><span>Days tracked</span><span>${dates.length}</span></div>
          <div class="stat-row"><span>Avg per day</span><span>${avgPerDay}h</span></div>
          <div class="stat-row"><span>First log</span><span>${firstDate}</span></div>
          <div class="stat-row"><span>Last log</span><span>${lastDate}</span></div>
        </div>

        ${goals.daily.enabled ? `
        <div class="stat-card">
          <div class="stat-title">🎯 Today's Progress</div>
          ${dailyProgress}
          <div class="stat-row"><span>Productivity Score</span><span>${productivityScore}/100</span></div>
        </div>
        ` : ''}

        ${categoryBreakdown ? `
        <div class="stat-card">
          <div class="stat-title">📂 By Category</div>
          ${categoryBreakdown}
        </div>
        ` : ''}

        ${projectBreakdown ? `
        <div class="stat-card">
          <div class="stat-title">📁 Top Projects</div>
          ${projectBreakdown}
        </div>
        ` : ''}

        ${energyBreakdown ? `
        <div class="stat-card">
          <div class="stat-title">⚡ Energy Levels</div>
          ${energyBreakdown}
        </div>
        ` : ''}

        ${topDays ? `
        <div class="stat-card">
          <div class="stat-title">🏆 Top 5 Days</div>
          ${topDays}
        </div>
        ` : ''}

        ${insightsHTML ? `
        <div class="stat-card stat-card-full">
          <div class="stat-title">💡 Insights (Last 7 Days)</div>
          <ul style="margin: 8px 0; padding-left: 20px; line-height: 1.7;">
            ${insightsHTML}
          </ul>
        </div>
        ` : ''}
      </div>
    `;

    this.showModal(this.elements.statsModal);
  },

  showExport() {
    this.showModal(this.elements.exportModal);
  },

  exportJSON() {
    const logs = Array.from(this.logsByPath.values()).map(log => ({
      path: log.path,
      username: log.username,
      date: log.date,
      time: log.time,
      durationMs: log.durationMs,
      text: log.text,
      project: log.project || null,
      category: log.category || null,
      energy: log.energy || null,
      createdAt: log.createdAt || null
    }));

    const data = {
      version: 3,
      exportDate: new Date().toISOString(),
      timezone: Time.getTimeZone(),
      totalLogs: logs.length,
      logs: logs,
      projects: Enhanced.getProjects(),
      preferences: Enhanced.getPreferences(),
      goals: Enhanced.getGoals()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worklog-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.toast(`Exported ${logs.length} logs + projects + settings`, 'success');
  },

  exportCSV() {
    const logs = Array.from(this.logsByPath.values());

    const csvRows = [
      ['Date', 'End Time', 'Duration (hours)', 'Project', 'Category', 'Energy', 'Description'].join(',')
    ];

    logs.forEach(log => {
      const date = log.date;
      const time = log.time;
      const hours = (log.durationMs / (1000 * 60 * 60)).toFixed(2);

      let projectName = '';
      if (log.project) {
        const project = Enhanced.getProjects().find(p => p.id === log.project);
        projectName = project ? project.name : '';
      }

      const category = log.category || '';
      const energy = log.energy || '';
      const text = `"${log.text.replace(/"/g, '""')}"`;

      csvRows.push([date, time, hours, projectName, category, energy, text].join(','));
    });

    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worklog-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.toast(`Exported ${logs.length} logs to CSV`, 'success');
  },

  async importJSON() {
    const file = this.elements.importFile.files[0];
    if (!file) {
      this.toast('Please select a file first', 'error');
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.logs || !Array.isArray(data.logs)) {
        this.toast('Invalid file format', 'error');
        return;
      }

      if (data.projects && Array.isArray(data.projects)) {
        const existingProjects = Enhanced.getProjects();
        const existingIds = new Set(existingProjects.map(p => p.id));

        const newProjects = data.projects.filter(p => !existingIds.has(p.id));
        if (newProjects.length > 0) {
          Enhanced.saveProjects([...existingProjects, ...newProjects]);
        }
      }

      if (data.preferences && typeof data.preferences === 'object') {
        const currentPrefs = Enhanced.getPreferences();
        Enhanced.savePreferences({ ...currentPrefs, ...data.preferences });
      }

      if (data.goals && typeof data.goals === 'object') {
        Enhanced.saveGoals(data.goals);
      }

      let imported = 0;
      for (const logData of data.logs) {
        if (this.logsByPath.has(logData.path)) {
          continue;
        }

        const parsed = this.parseLogPath(logData.path);
        if (!parsed) continue;

        const log = this.buildLogEntry(logData.path, parsed, logData.text || '');
        log.project = logData.project || null;
        log.category = logData.category || null;
        log.energy = logData.energy || null;
        log.createdAt = logData.createdAt || new Date().toISOString();

        this.logsByPath.set(log.path, log);
        imported++;
      }

      this.logsVersion += imported;
      this.renderLogs();
      await this.syncCacheFromMemory();

      this.loadProjects();

      this.toast(`Imported ${imported} logs (${data.logs.length - imported} duplicates skipped)`, 'success');
      this.hideModal(this.elements.exportModal);
    } catch (err) {

      this.toast(`Import failed: ${err.message}`, 'error');
    }
  },

  clearAllData() {
    if (!confirm('⚠️ This will delete ALL your logs and reset the app. This cannot be undone!\n\nAre you sure?')) {
      return;
    }

    if (!confirm('Are you REALLY sure? Consider exporting your data first!')) {
      return;
    }

    localStorage.clear();

    if (this.cacheEnabled) {
      indexedDB.deleteDatabase('WorklogCache');
    }

    this.toast('All data cleared. Reloading...', 'success');
    setTimeout(() => window.location.reload(), 1000);
  },

  showPomodoroSettings() {
    this.showSettings('pomodoro');
  },

  updatePomodoroStats() {
    const stats = Enhanced.getPomodoroStats();

    if (this.elements.pomodoroTodayCount) {
      this.elements.pomodoroTodayCount.textContent = `${stats.completedToday || 0} sessions`;
    }
    if (this.elements.pomodoroTotalCount) {
      this.elements.pomodoroTotalCount.textContent = `${stats.totalSessions || 0} sessions`;
    }
    if (this.elements.pomodoroAvgCount) {
      const dateKeys = Object.keys(stats.dailyStats || {}).sort().slice(-7);
      if (dateKeys.length > 0) {
        const total = dateKeys.reduce((sum, key) =>
          sum + (stats.dailyStats[key]?.sessions || 0), 0);
        const avg = (total / dateKeys.length).toFixed(1);
        this.elements.pomodoroAvgCount.textContent = avg;
      } else {
        this.elements.pomodoroAvgCount.textContent = '0.0';
      }
    }
  },

  enablePomodoroMode(duration) {
    this.pomodoroMode = true;
    this.pomodoroSessionCount = 0;
    this.intervalMs = duration * 60 * 1000;
    this.elements.intervalInput.value = duration;

    // Show Pomodoro counter
    if (this.elements.pomodoroCounter) {
      this.elements.pomodoroCounter.classList.remove('hidden');
    }

    // Add visual indicator
    if (this.elements.pomodoroToggle) {
      this.elements.pomodoroToggle.classList.add('pomodoro-active');
    }

    this.updatePomodoroCounter();
  },

  disablePomodoroMode() {
    this.pomodoroMode = false;
    this.pomodoroInBreak = false;
    this.pomodoroSessionCount = 0;

    // Hide Pomodoro counter
    if (this.elements.pomodoroCounter) {
      this.elements.pomodoroCounter.classList.add('hidden');
    }

    // Remove visual indicator
    if (this.elements.pomodoroToggle) {
      this.elements.pomodoroToggle.classList.remove('pomodoro-active');
    }
  },

  updatePomodoroCounter() {
    if (!this.elements.pomodoroCounter) return;
    const stats = Enhanced.getPomodoroStats();
    this.elements.pomodoroCounter.textContent = `🍅 ${stats.completedToday || 0}`;
    this.elements.pomodoroCounter.title = `${stats.completedToday || 0} Pomodoro sessions completed today`;
  },

  completePomodoroSession() {
    if (!this.pomodoroMode) return;

    this.pomodoroSessionCount += 1;
    const stats = Enhanced.recordPomodoroSession();
    this.updatePomodoroCounter();

    const prefs = Enhanced.getPreferences();
    const sessionsUntilLong = 4;

    const isLongBreak = this.pomodoroSessionCount % sessionsUntilLong === 0;
    const breakDuration = isLongBreak ? prefs.pomodoroLongBreak : prefs.pomodoroBreak;

    this.toast(
      isLongBreak
        ? `🎉 Great work! Take a ${breakDuration}-minute long break.`
        : `✅ Session complete! Take a ${breakDuration}-minute break.`,
      'success'
    );

    this.pomodoroInBreak = true;
    Enhanced.recordPomodoroBreak();
  },

  showSettings(tabName = 'defaults') {
    const prefs = Enhanced.getPreferences();
    const goals = Enhanced.getGoals();
    const projects = Enhanced.getProjects();

    document.getElementById('settings-default-interval').value = prefs.defaultInterval || 60;
    document.getElementById('settings-default-energy').value = prefs.defaultEnergy || '';
    document.getElementById('settings-default-category').value = prefs.defaultCategory || '';

    const defaultProjectSelect = document.getElementById('settings-default-project');
    while (defaultProjectSelect.options.length > 1) {
      defaultProjectSelect.remove(1);
    }
    projects.filter(p => p.active).forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      defaultProjectSelect.appendChild(option);
    });
    defaultProjectSelect.value = prefs.defaultProject || '';

    document.getElementById('settings-daily-enabled').checked = goals.daily?.enabled !== false;
    document.getElementById('settings-daily-hours').value = goals.daily?.hours || 8;
    document.getElementById('settings-weekly-enabled').checked = goals.weekly?.enabled !== false;
    document.getElementById('settings-weekly-hours').value = goals.weekly?.hours || 40;
    document.getElementById('settings-monthly-enabled').checked = goals.monthly?.enabled || false;
    document.getElementById('settings-monthly-hours').value = goals.monthly?.hours || 160;

    document.getElementById('settings-pomodoro-enabled').checked = prefs.pomodoroEnabled || false;
    document.getElementById('settings-pomodoro-work').value = prefs.pomodoroDuration || 25;
    document.getElementById('settings-pomodoro-short-break').value = prefs.pomodoroBreak || 5;
    document.getElementById('settings-pomodoro-long-break').value = prefs.pomodoroLongBreak || 15;
    document.getElementById('settings-pomodoro-sessions').value = prefs.pomodoroSessions || 4;

    this.updatePomodoroStats();

    document.getElementById('settings-sound-enabled').checked = prefs.soundEnabled !== false;
    document.getElementById('settings-notifications-enabled').checked = prefs.notificationsEnabled !== false;
    document.getElementById('settings-autosave-enabled').checked = prefs.autosaveEnabled !== false;
    document.getElementById('settings-show-interval').checked = prefs.showInterval || false;
    document.getElementById('settings-track-energy').checked = prefs.trackEnergy !== false;
    document.getElementById('settings-track-category').checked = prefs.trackCategory !== false;

    this.switchSettingsTab(tabName);

    this.showModal(this.elements.settingsModal);
  },

  switchSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const targetPanel = document.getElementById(`settings-${tabName}`);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  },

  saveSettings() {
    const prefs = Enhanced.getPreferences();
    const goals = Enhanced.getGoals();

    prefs.defaultInterval = parseInt(document.getElementById('settings-default-interval').value) || 60;
    prefs.defaultEnergy = document.getElementById('settings-default-energy').value;
    prefs.defaultCategory = document.getElementById('settings-default-category').value;
    prefs.defaultProject = document.getElementById('settings-default-project').value;

    goals.daily = {
      enabled: document.getElementById('settings-daily-enabled').checked,
      hours: parseFloat(document.getElementById('settings-daily-hours').value) || 8
    };
    goals.weekly = {
      enabled: document.getElementById('settings-weekly-enabled').checked,
      hours: parseFloat(document.getElementById('settings-weekly-hours').value) || 40
    };
    goals.monthly = {
      enabled: document.getElementById('settings-monthly-enabled').checked,
      hours: parseFloat(document.getElementById('settings-monthly-hours').value) || 160
    };

    const pomodoroWasEnabled = prefs.pomodoroEnabled;
    prefs.pomodoroEnabled = document.getElementById('settings-pomodoro-enabled').checked;
    prefs.pomodoroDuration = parseInt(document.getElementById('settings-pomodoro-work').value) || 25;
    prefs.pomodoroBreak = parseInt(document.getElementById('settings-pomodoro-short-break').value) || 5;
    prefs.pomodoroLongBreak = parseInt(document.getElementById('settings-pomodoro-long-break').value) || 15;
    prefs.pomodoroSessions = parseInt(document.getElementById('settings-pomodoro-sessions').value) || 4;

    prefs.soundEnabled = document.getElementById('settings-sound-enabled').checked;
    prefs.notificationsEnabled = document.getElementById('settings-notifications-enabled').checked;
    prefs.autosaveEnabled = document.getElementById('settings-autosave-enabled').checked;
    prefs.showInterval = document.getElementById('settings-show-interval').checked;
    prefs.trackEnergy = document.getElementById('settings-track-energy').checked;
    prefs.trackCategory = document.getElementById('settings-track-category').checked;

    Enhanced.savePreferences(prefs);
    Enhanced.saveGoals(goals);

    this.intervalMs = prefs.defaultInterval * 60 * 1000;
    this.elements.intervalInput.value = prefs.defaultInterval;

    const intervalControl = this.elements.intervalInput?.closest('.interval-control');
    if (intervalControl) {
      if (prefs.showInterval) {
        intervalControl.classList.remove('hidden');
      } else {
        intervalControl.classList.add('hidden');
      }
    }

    if (prefs.pomodoroEnabled && !pomodoroWasEnabled) {
      this.enablePomodoroMode(prefs.pomodoroDuration);
    } else if (!prefs.pomodoroEnabled && pomodoroWasEnabled) {
      this.disablePomodoroMode();
    }

    this.toast('Settings saved!', 'success');
    this.hideModal(this.elements.settingsModal);
  },

  resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;

    const defaults = Enhanced.getDefaultPreferences();
    Enhanced.savePreferences(defaults);
    Enhanced.saveGoals(Enhanced.getDefaultGoals());

    this.toast('Settings reset to defaults', 'success');
    this.showSettings(); // Reload the form
  },

  // Projects management methods
  showProjects() {
    this.renderProjectsList();
    this.hideProjectForm();
    this.showModal(this.elements.projectsModal);
  },

  renderProjectsList() {
    if (!this.elements.projectsList) return;

    const projects = Enhanced.getProjects();
    this.elements.projectsList.innerHTML = '';

    if (projects.length === 0) {
      this.elements.projectsList.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">No projects yet. Create your first project!</p>';
      return;
    }

    projects.forEach(project => {
      const item = document.createElement('div');
      item.className = 'project-item';

      const colorBadge = document.createElement('div');
      colorBadge.className = 'project-color-badge';
      colorBadge.style.background = project.color;

      const info = document.createElement('div');
      info.className = 'project-info';

      const name = document.createElement('div');
      name.className = 'project-name';
      name.textContent = project.name;

      const description = document.createElement('div');
      description.className = 'project-description';
      description.textContent = project.description || 'No description';

      info.appendChild(name);
      info.appendChild(description);

      const actions = document.createElement('div');
      actions.className = 'project-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => this.editProject(project.id));

      const archiveBtn = document.createElement('button');
      archiveBtn.textContent = project.active ? 'Archive' : 'Restore';
      archiveBtn.className = project.active ? '' : 'primary';
      archiveBtn.addEventListener('click', () => this.toggleProjectArchive(project.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'danger';
      deleteBtn.addEventListener('click', () => this.deleteProjectConfirm(project.id));

      actions.appendChild(editBtn);
      actions.appendChild(archiveBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(colorBadge);
      item.appendChild(info);
      item.appendChild(actions);

      this.elements.projectsList.appendChild(item);
    });
  },

  showProjectForm(projectId = null) {
    if (!this.elements.projectForm) return;

    this.currentEditingProjectId = projectId;

    if (projectId) {
      const project = Enhanced.getProject(projectId);
      if (!project) return;

      this.elements.projectFormTitle.textContent = 'Edit Project';
      this.elements.projectName.value = project.name;
      this.elements.projectDescription.value = project.description || '';
    } else {
      this.elements.projectFormTitle.textContent = 'Create New Project';
      this.elements.projectName.value = '';
      this.elements.projectDescription.value = '';
    }

    this.elements.projectForm.classList.remove('hidden');
  },

  hideProjectForm() {
    if (!this.elements.projectForm) return;
    this.elements.projectForm.classList.add('hidden');
    this.currentEditingProjectId = null;
  },

  saveProject() {
    const name = this.elements.projectName.value.trim();
    if (!name) {
      this.toast('Project name is required', 'error');
      return;
    }

    const description = this.elements.projectDescription.value.trim();

    if (this.currentEditingProjectId) {
      // Update existing project (keep existing color)
      Enhanced.updateProject(this.currentEditingProjectId, {
        name,
        description
      });
      this.toast('Project updated!', 'success');
    } else {
      // Create new project (auto-assign color)
      Enhanced.addProject(name, description);
      this.toast('Project created!', 'success');
    }

    this.hideProjectForm();
    this.renderProjectsList();
    this.loadProjects(); // Refresh dropdowns
  },

  editProject(id) {
    this.showProjectForm(id);
  },

  toggleProjectArchive(id) {
    const project = Enhanced.getProject(id);
    if (!project) return;

    Enhanced.updateProject(id, { active: !project.active });
    this.renderProjectsList();
    this.loadProjects(); // Refresh dropdowns
    this.toast(project.active ? 'Project archived' : 'Project restored', 'success');
  },

  deleteProjectConfirm(id) {
    const project = Enhanced.getProject(id);
    if (!project) return;

    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;

    Enhanced.deleteProject(id);
    this.renderProjectsList();
    this.loadProjects(); // Refresh dropdowns
    this.toast('Project deleted', 'success');
  },

  // Edit and delete log methods
  editLog(path) {
    const log = this.logsByPath.get(path);
    if (!log) {
      this.toast('Log not found', 'error');
      return;
    }

    // Store the log being edited
    this.editingLogPath = path;

    // Populate the modal with existing values
    const date = new Date(log.dateObj || this.buildDate(log.date, log.time));
    const parts = Time.getZonedParts(date);

    // Set date/time
    if (this.elements.logDate) {
      this.elements.logDate.value = Time.formatDateValue(parts);
    }
    if (this.elements.logTime) {
      this.elements.logTime.value = Time.formatTimeValue(parts);
    }

    // Set duration
    const durationMs = log.durationMs || this.intervalMs;
    const totalMinutes = Math.round(durationMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (this.elements.logHours) {
      this.elements.logHours.value = String(hours);
    }
    if (this.elements.logMinutes) {
      this.elements.logMinutes.value = String(minutes);
    }

    // Set description
    if (this.elements.logText) {
      this.elements.logText.value = log.text || '';
    }

    // Phase 1: Read metadata from log object directly
    if (this.elements.logProject) {
      this.elements.logProject.value = log.project || '';
    }
    if (this.elements.logCategory) {
      this.elements.logCategory.value = log.category || 'other';
    }
    if (this.elements.logEnergy) {
      this.elements.logEnergy.value = log.energy || 'medium';
    }

    // Change button text
    if (this.elements.registerLog) {
      this.elements.registerLog.textContent = 'Update';
    }

    // Show the modal
    this.showModal(this.elements.logModal);
    this.validateLogTimespan();
  },

  async submitLog() {
    

    if (!this.isAwaitingLog && !this.editingLogPath && !this.manualLogMode) return;

    const text = this.elements.logText.value.trim();
    if (!text) {
      this.toast('Please enter a short description', 'error');
      this.elements.logText.focus();
      return;
    }

    const timespan = this.validateLogTimespan();
    if (!timespan) {
      return;
    }

    this.isSavingLog = true;
    this.elements.registerLog.disabled = true;
    this.elements.registerLog.textContent = this.editingLogPath ? 'Updating...' : 'Saving...';

    try {
      // Auto-adjust any overlapping logs before saving the new one
      if (!this.editingLogPath) {
        await this.adjustOverlappingLogs(timespan.startDate, timespan.endDate);
      }

      const filename = this.buildFilename(timespan.endDate, this.user.login, timespan.durationMs);
      const path = `logs/${filename}`;

      // Get enhanced metadata
      const projectId = this.elements.logProject?.value || '';
      const category = this.elements.logCategory?.value || 'other';
      const energy = this.elements.logEnergy?.value || 'medium';

      const metadata = {
        project: projectId || null,
        category: category || null,
        energy: energy || null,
        createdAt: new Date().toISOString()
      };

      if (this.editingLogPath) {
        this.logsByPath.delete(this.editingLogPath);
      }

      await this.addLogLocal(path, text, metadata);
      this.toast(this.editingLogPath ? 'Log updated!' : 'Log saved locally', 'success');

      this.elements.logText.value = '';
      localStorage.removeItem('worklog_draft');

      if (this.pomodoroMode && !this.editingLogPath && !this.manualLogMode) {
        this.completePomodoroSession();
      }

      this.editingLogPath = null;
      const wasManualMode = this.manualLogMode;
      this.manualLogMode = false;

      if (this.elements.registerLog) {
        this.elements.registerLog.textContent = 'Send';
      }

      if (!wasManualMode) {
        this.completeCurrentPendingLog();
      } else {
        this.hideModal(this.elements.logModal);
      }
    } catch (err) {
      this.toast(`Failed to save: ${err.message}`, 'error');
    } finally {
      this.isSavingLog = false;
      this.elements.registerLog.textContent = this.editingLogPath ? 'Update' : 'Send';
      if (this.isAwaitingLog || this.editingLogPath) {
        this.validateLogTimespan();
      } else {
        this.elements.registerLog.disabled = false;
      }
    }
  },

  async deleteLog(path) {
    const log = this.logsByPath.get(path);
    if (!log) {
      this.toast('Log not found', 'error');
      return;
    }

    const confirmation = confirm(
      `Delete this log?\n\nDate: ${log.date} ${log.time}\nDescription: ${log.text}\n\nThis cannot be undone.`
    );

    if (!confirmation) return;

    this.logsByPath.delete(path);
    this.logsVersion += 1;

    this.renderLogs();
    await this.syncCacheFromMemory();

    this.toast('Log deleted', 'success');
  },

  async checkAndArchiveOldLogs() {
    try {
      const logCount = await LogCache.getLogCount();
      if (logCount < 200) return;

      const oldLogs = await LogCache.getOldLogs(90); // Logs older than 90 days
      if (oldLogs.length > 100) {
        await this.archiveOldLogs(oldLogs);
      }
    } catch (err) {
      this.toast(`Import failed: ${err.message}`, 'error');
      this.toast(`Import failed: ${err.message}`, 'error');
    }
  },

  async archiveOldLogs(logs) {
    if (!logs || logs.length === 0) return;

    const dates = logs.map(l => l.date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    const archiveData = {
      version: 3,
      archiveDate: new Date().toISOString(),
      startDate,
      endDate,
      timezone: Time.getTimeZone(),
      totalLogs: logs.length,
      logs: logs,
      projects: Enhanced.getProjects(),
      preferences: Enhanced.getPreferences(),
      goals: Enhanced.getGoals()
    };

    await LogCache.saveArchive(archiveData);

    const blob = new Blob([JSON.stringify(archiveData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worklog-archive-${startDate}-to-${endDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const paths = logs.map(l => l.path);
    await LogCache.deleteLogsByPaths(paths);

    for (const path of paths) {
      this.logsByPath.delete(path);
    }

    this.logsVersion += 1;
    this.renderLogs();

    this.toast(`Archived ${logs.length} old logs (${startDate} to ${endDate})`, 'success');
  },

  showReports() {
    if (!this.reportsState) {
      this.reportsState = {
        type: 'daily', // daily, weekly, monthly
        date: new Date() // Current date for the report
      };
    }

    this.showModal(this.elements.reportsModal);
    this.renderCurrentReport();
  },

  switchReportType(type) {
    this.reportsState.type = type;

    document.querySelectorAll('.reports-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });

    this.renderCurrentReport();
  },

  navigateReport(direction) {
    const { type, date } = this.reportsState;
    const newDate = new Date(date);

    if (type === 'daily') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (type === 'weekly') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else if (type === 'monthly') {
      newDate.setMonth(newDate.getMonth() + direction);
    }

    this.reportsState.date = newDate;
    this.renderCurrentReport();
  },

  navigateReportToToday() {
    this.reportsState.date = new Date();
    this.renderCurrentReport();
  },

  renderCurrentReport() {
    const { type, date } = this.reportsState;

    this.updateReportDateDisplay();

    let reportHTML = '';
    if (type === 'daily') {
      reportHTML = this.generateDailyReport(date);
    } else if (type === 'weekly') {
      reportHTML = this.generateWeeklyReport(date);
    } else if (type === 'monthly') {
      reportHTML = this.generateMonthlyReport(date);
    }

    this.elements.reportsContent.innerHTML = reportHTML;
  },

  updateReportDateDisplay() {
    const { type, date } = this.reportsState;
    let displayText = '';

    if (type === 'daily') {
      displayText = date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } else if (type === 'weekly') {
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      displayText = `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (type === 'monthly') {
      displayText = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }

    this.elements.reportsDateDisplay.textContent = displayText;
  },

  generateDailyReport(date) {
    const logs = this.getLogsForDate(date);
    if (logs.length === 0) {
      return `<div class="report-empty">No logs for this day.</div>`;
    }
    const totalMs = logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);
    const logCount = logs.length;

    const categoryTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const category = meta?.category || 'other';
      categoryTotals[category] = (categoryTotals[category] || 0) + (log.durationMs || 0);
    });

    const categoryBreakdown = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, ms]) => {
        const catInfo = Enhanced.categories[cat] || { icon: '📌', name: cat };
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>${catInfo.icon}</span>
              <span>${catInfo.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .join('');

    const projectTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const projectId = meta?.project;
      if (projectId) {
        projectTotals[projectId] = (projectTotals[projectId] || 0) + (log.durationMs || 0);
      }
    });

    const projects = Enhanced.getProjects();
    const projectBreakdown = Object.entries(projectTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([projId, ms]) => {
        const project = projects.find(p => p.id === projId);
        if (!project) return '';
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span style="color: ${project.color};">●</span>
              <span>${project.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .filter(Boolean)
      .join('');

    const energyTotals = { high: 0, medium: 0, low: 0 };
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const energy = meta?.energy || 'medium';
      if (energyTotals[energy] !== undefined) {
        energyTotals[energy] += (log.durationMs || 0);
      }
    });

    const energyBreakdown = Object.entries(energyTotals)
      .filter(([_, ms]) => ms > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([level, ms]) => {
        const info = Enhanced.energyLevels[level];
        if (!info) return '';
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>${info.icon}</span>
              <span>${info.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .filter(Boolean)
      .join('');

    const productivityScore = Enhanced.calculateProductivityScore(logs, date);

    const goals = Enhanced.getGoals();
    const dailyGoalHtml = goals.daily.enabled ? `
      <div class="report-metric">
        <div class="report-metric-label">Daily Goal</div>
        <div class="report-metric-value">${Math.min(100, (parseFloat(totalHours) / goals.daily.hours * 100)).toFixed(0)}%</div>
        <div class="progress-bar" style="margin-top: 8px;">
          <div class="progress-fill" style="width: ${Math.min(100, (parseFloat(totalHours) / goals.daily.hours) * 100)}%"></div>
        </div>
      </div>` : '';

    return `
      <div class="report-section">
        <h3>📊 Summary</h3>
        <div class="report-summary">
          <div class="report-metric">
            <div class="report-metric-label">Total Hours</div>
            <div class="report-metric-value">${totalHours}h</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Log Count</div>
            <div class="report-metric-value">${logCount}</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Productivity</div>
            <div class="report-metric-value">${productivityScore}/100</div>
          </div>
          ${dailyGoalHtml}
        </div>
      </div>

      ${categoryBreakdown ? `
      <div class="report-section">
        <h3>📂 By Category</h3>
        <div class="report-breakdown">
          ${categoryBreakdown}
        </div>
      </div>` : ''}

      ${projectBreakdown ? `
      <div class="report-section">
        <h3>📁 By Project</h3>
        <div class="report-breakdown">
          ${projectBreakdown}
        </div>
      </div>` : ''}

      ${energyBreakdown ? `
      <div class="report-section">
        <h3>⚡ Energy Levels</h3>
        <div class="report-breakdown">
          ${energyBreakdown}
        </div>
      </div>` : ''}
    `;
  },

  generateWeeklyReport(date) {
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const logs = this.getLogsForDateRange(startOfWeek, endOfWeek);

    if (logs.length === 0) {
      return `<div class="report-empty">No logs for this week.</div>`;
    }

    const totalMs = logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);
    const logCount = logs.length;
    const avgHoursPerDay = (parseFloat(totalHours) / 7).toFixed(2);

    const dayTotals = {};
    logs.forEach(log => {
      if (!log.date) return;
      dayTotals[log.date] = (dayTotals[log.date] || 0) + (log.durationMs || 0);
    });

    const daysBreakdown = Object.entries(dayTotals)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateStr, ms]) => {
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const dayDate = new Date(dateStr + 'T00:00:00');
        const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>📅</span>
              <span>${dayName}</span>
            </div>
            <div class="report-breakdown-value">${hours}h</div>
          </div>`;
      })
      .join('');

    
  const categoryTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const category = meta?.category || 'other';
      categoryTotals[category] = (categoryTotals[category] || 0) + (log.durationMs || 0);
    });

    const categoryBreakdown = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, ms]) => {
        const catInfo = Enhanced.categories[cat] || { icon: '📌', name: cat };
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>${catInfo.icon}</span>
              <span>${catInfo.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .join('');

    
  const projectTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const projectId = meta?.project;
      if (projectId) {
        projectTotals[projectId] = (projectTotals[projectId] || 0) + (log.durationMs || 0);
      }
    });

    const projects = Enhanced.getProjects();
    const projectBreakdown = Object.entries(projectTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([projId, ms]) => {
        const project = projects.find(p => p.id === projId);
        if (!project) return '';
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span style="color: ${project.color};">●</span>
              <span>${project.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .filter(Boolean)
      .join('');

    
  const goals = Enhanced.getGoals();
    const weeklyGoalHtml = goals.weekly.enabled ? `
      <div class="report-metric">
        <div class="report-metric-label">Weekly Goal</div>
        <div class="report-metric-value">${Math.min(100, (parseFloat(totalHours) / goals.weekly.hours * 100)).toFixed(0)}%</div>
        <div class="progress-bar" style="margin-top: 8px;">
          <div class="progress-fill" style="width: ${Math.min(100, (parseFloat(totalHours) / goals.weekly.hours) * 100)}%"></div>
        </div>
      </div>` : '';

    return `
      <div class="report-section">
        <h3>📊 Summary</h3>
        <div class="report-summary">
          <div class="report-metric">
            <div class="report-metric-label">Total Hours</div>
            <div class="report-metric-value">${totalHours}h</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Avg/Day</div>
            <div class="report-metric-value">${avgHoursPerDay}h</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Log Count</div>
            <div class="report-metric-value">${logCount}</div>
          </div>
          ${weeklyGoalHtml}
        </div>
      </div>

      <div class="report-section">
        <h3>📅 Daily Breakdown</h3>
        <div class="report-breakdown">
          ${daysBreakdown}
        </div>
      </div>

      ${categoryBreakdown ? `
      <div class="report-section">
        <h3>📂 Top Categories</h3>
        <div class="report-breakdown">
          ${categoryBreakdown}
        </div>
      </div>` : ''}

      ${projectBreakdown ? `
      <div class="report-section">
        <h3>📁 Top Projects</h3>
        <div class="report-breakdown">
          ${projectBreakdown}
        </div>
      </div>` : ''}
    `;
  },

  generateMonthlyReport(date) {
    
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

    const logs = this.getLogsForDateRange(startOfMonth, endOfMonth);

    if (logs.length === 0) {
      return `<div class="report-empty">No logs for this month.</div>`;
    }

    const totalMs = logs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(2);
    const logCount = logs.length;

    
  const dayTotals = {};
    logs.forEach(log => {
      if (!log.date) return;
      dayTotals[log.date] = (dayTotals[log.date] || 0) + (log.durationMs || 0);
    });
    const workingDays = Object.keys(dayTotals).length;
    const avgHoursPerDay = workingDays > 0 ? (parseFloat(totalHours) / workingDays).toFixed(2) : 0;

    
  const weekTotals = {};
    logs.forEach(log => {
      if (!log.date) return;
      const logDate = new Date(log.date + 'T00:00:00');
      const weekStart = new Date(logDate);
      weekStart.setDate(logDate.getDate() - logDate.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      weekTotals[weekKey] = (weekTotals[weekKey] || 0) + (log.durationMs || 0);
    });

    const weeksBreakdown = Object.entries(weekTotals)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStartStr, ms]) => {
        const weekStart = new Date(weekStartStr + 'T00:00:00');
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>📅</span>
              <span>${weekLabel}</span>
            </div>
            <div class="report-breakdown-value">${hours}h</div>
          </div>`;
      })
      .join('');

    
  const categoryTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const category = meta?.category || 'other';
      categoryTotals[category] = (categoryTotals[category] || 0) + (log.durationMs || 0);
    });

    const categoryBreakdown = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, ms]) => {
        const catInfo = Enhanced.categories[cat] || { icon: '📌', name: cat };
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span>${catInfo.icon}</span>
              <span>${catInfo.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .join('');

    
  const projectTotals = {};
    logs.forEach(log => {
      const meta = this.getLogMetadata(log);
      const projectId = meta?.project;
      if (projectId) {
        projectTotals[projectId] = (projectTotals[projectId] || 0) + (log.durationMs || 0);
      }
    });

    const projects = Enhanced.getProjects();
    const projectBreakdown = Object.entries(projectTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([projId, ms]) => {
        const project = projects.find(p => p.id === projId);
        if (!project) return '';
        const hours = (ms / (1000 * 60 * 60)).toFixed(1);
        const percent = ((ms / totalMs) * 100).toFixed(0);
        return `
          <div class="report-breakdown-item">
            <div class="report-breakdown-label">
              <span style="color: ${project.color};">●</span>
              <span>${project.name}</span>
            </div>
            <div class="report-breakdown-value">${hours}h (${percent}%)</div>
          </div>`;
      })
      .filter(Boolean)
      .join('');

    
  const goals = Enhanced.getGoals();
    const monthlyGoalHtml = goals.monthly.enabled ? `
      <div class="report-metric">
        <div class="report-metric-label">Monthly Goal</div>
        <div class="report-metric-value">${Math.min(100, (parseFloat(totalHours) / goals.monthly.hours * 100)).toFixed(0)}%</div>
        <div class="progress-bar" style="margin-top: 8px;">
          <div class="progress-fill" style="width: ${Math.min(100, (parseFloat(totalHours) / goals.monthly.hours) * 100)}%"></div>
        </div>
      </div>` : '';

    return `
      <div class="report-section">
        <h3>📊 Summary</h3>
        <div class="report-summary">
          <div class="report-metric">
            <div class="report-metric-label">Total Hours</div>
            <div class="report-metric-value">${totalHours}h</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Working Days</div>
            <div class="report-metric-value">${workingDays}</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Avg/Day</div>
            <div class="report-metric-value">${avgHoursPerDay}h</div>
          </div>
          <div class="report-metric">
            <div class="report-metric-label">Log Count</div>
            <div class="report-metric-value">${logCount}</div>
          </div>
          ${monthlyGoalHtml}
        </div>
      </div>

      <div class="report-section">
        <h3>📅 Weekly Breakdown</h3>
        <div class="report-breakdown">
          ${weeksBreakdown}
        </div>
      </div>

      ${categoryBreakdown ? `
      <div class="report-section">
        <h3>📂 Top Categories</h3>
        <div class="report-breakdown">
          ${categoryBreakdown}
        </div>
      </div>` : ''}

      ${projectBreakdown ? `
      <div class="report-section">
        <h3>📁 Top Projects</h3>
        <div class="report-breakdown">
          ${projectBreakdown}
        </div>
      </div>` : ''}
    `;
  },

  getLogsForDate(date) {
    const dateStr = Time.formatDateValue({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
    return Array.from(this.logsByPath.values()).filter(log => log.date === dateStr);
  },

  getLogsForDateRange(startDate, endDate) {
    return Array.from(this.logsByPath.values()).filter(log => {
      if (!log.date) return false;
      const logDate = new Date(log.date + 'T00:00:00');
      return logDate >= startDate && logDate <= endDate;
    });
  },

  exportCurrentReport() {
    const { type, date } = this.reportsState;

    
  let reportData = {
      type,
      generatedAt: new Date().toISOString(),
      timezone: Time.getTimeZone()
    };

    if (type === 'daily') {
      const logs = this.getLogsForDate(date);
      reportData.date = date.toISOString().split('T')[0];
      reportData.logs = logs;
      reportData.totalHours = (logs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / (1000 * 60 * 60)).toFixed(2);
    } else if (type === 'weekly') {
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      const logs = this.getLogsForDateRange(startOfWeek, endOfWeek);
      reportData.startDate = startOfWeek.toISOString().split('T')[0];
      reportData.endDate = endOfWeek.toISOString().split('T')[0];
      reportData.logs = logs;
      reportData.totalHours = (logs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / (1000 * 60 * 60)).toFixed(2);
    } else if (type === 'monthly') {
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const logs = this.getLogsForDateRange(startOfMonth, endOfMonth);
      reportData.month = date.getMonth() + 1;
      reportData.year = date.getFullYear();
      reportData.logs = logs;
      reportData.totalHours = (logs.reduce((sum, log) => sum + (log.durationMs || 0), 0) / (1000 * 60 * 60)).toFixed(2);
    }

    
  const dateStr = date.toISOString().split('T')[0];
    const filename = `worklog-${type}-report-${dateStr}.json`;

    
  const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    this.toast(`Report exported: ${filename}`, 'success');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
