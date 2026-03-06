// Enhanced features for Worklog - Projects, Categories, Analytics
const Enhanced = {
  // Category definitions with color coding
  categories: {
    coding: { name: 'Coding', color: '#3b82f6', icon: '💻' },
    meeting: { name: 'Meeting', color: '#8b5cf6', icon: '👥' },
    research: { name: 'Research', color: '#10b981', icon: '🔍' },
    review: { name: 'Code Review', color: '#f59e0b', icon: '👀' },
    documentation: { name: 'Documentation', color: '#6366f1', icon: '📝' },
    planning: { name: 'Planning', color: '#ec4899', icon: '📋' },
    debugging: { name: 'Debugging', color: '#ef4444', icon: '🐛' },
    testing: { name: 'Testing', color: '#14b8a6', icon: '🧪' },
    learning: { name: 'Learning', color: '#a855f7', icon: '📚' },
    break: { name: 'Break', color: '#64748b', icon: '☕' },
    other: { name: 'Other', color: '#6b7280', icon: '📌' }
  },

  // Energy level tracking
  energyLevels: {
    high: { name: 'High Energy', value: 3, icon: '⚡', color: '#10b981' },
    medium: { name: 'Medium Energy', value: 2, icon: '🔋', color: '#f59e0b' },
    low: { name: 'Low Energy', value: 1, icon: '🪫', color: '#ef4444' }
  },

  // Storage keys
  storage: {
    projects: 'worklog_projects',
    logMetadata: 'worklog_log_metadata',
    goals: 'worklog_goals',
    preferences: 'worklog_preferences',
    pomodoroStats: 'worklog_pomodoro_stats'
  },

  // Pomodoro tracking
  pomodoroState: {
    enabled: false,
    inBreak: false,
    sessionCount: 0,
    completedToday: 0,
    lastSessionEnd: null
  },

  // Get all projects
  getProjects() {
    try {
      const data = localStorage.getItem(this.storage.projects);
      return data ? JSON.parse(data) : [];
    } catch (err) {
      console.error('Failed to load projects', err);
      return [];
    }
  },

  // Save projects
  saveProjects(projects) {
    try {
      localStorage.setItem(this.storage.projects, JSON.stringify(projects));
      return true;
    } catch (err) {
      console.error('Failed to save projects', err);
      return false;
    }
  },

  // Add a new project
  addProject(name, description = '', color = null) {
    const projects = this.getProjects();
    const id = Date.now().toString();
    const project = {
      id,
      name,
      description,
      color: color || this.generateProjectColor(projects.length),
      createdAt: new Date().toISOString(),
      active: true
    };
    projects.push(project);
    this.saveProjects(projects);
    return project;
  },

  // Update an existing project
  updateProject(id, updates) {
    const projects = this.getProjects();
    const index = projects.findIndex(p => p.id === id);
    if (index === -1) return null;

    projects[index] = {
      ...projects[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveProjects(projects);
    return projects[index];
  },

  // Delete a project
  deleteProject(id) {
    const projects = this.getProjects();
    const filtered = projects.filter(p => p.id !== id);
    this.saveProjects(filtered);
    return true;
  },

  // Archive a project (soft delete)
  archiveProject(id) {
    return this.updateProject(id, { active: false });
  },

  // Get a single project by ID
  getProject(id) {
    const projects = this.getProjects();
    return projects.find(p => p.id === id) || null;
  },

  // Generate a project color from a palette
  generateProjectColor(index) {
    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1',
      '#f97316', '#06b6d4', '#84cc16', '#a855f7'
    ];
    return colors[index % colors.length];
  },

  // Get log metadata
  getLogMetadata(logPath) {
    try {
      const data = localStorage.getItem(this.storage.logMetadata);
      const metadata = data ? JSON.parse(data) : {};
      return metadata[logPath] || null;
    } catch (err) {
      console.error('Failed to load log metadata', err);
      return null;
    }
  },

  // Get all log metadata
  getAllLogMetadata() {
    try {
      const data = localStorage.getItem(this.storage.logMetadata);
      return data ? JSON.parse(data) : {};
    } catch (err) {
      console.error('Failed to load all log metadata', err);
      return {};
    }
  },

  // Save log metadata
  saveLogMetadata(logPath, metadata) {
    try {
      const data = localStorage.getItem(this.storage.logMetadata);
      const allMetadata = data ? JSON.parse(data) : {};
      allMetadata[logPath] = {
        ...metadata,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem(this.storage.logMetadata, JSON.stringify(allMetadata));
      return true;
    } catch (err) {
      console.error('Failed to save log metadata', err);
      return false;
    }
  },

  // Get user preferences
  getPreferences() {
    try {
      const data = localStorage.getItem(this.storage.preferences);
      return data ? JSON.parse(data) : this.getDefaultPreferences();
    } catch (err) {
      console.error('Failed to load preferences', err);
      return this.getDefaultPreferences();
    }
  },

  // Default preferences
  getDefaultPreferences() {
    return {
      pomodoroEnabled: false,
      pomodoroDuration: 25,
      pomodoroBreak: 5,
      pomodoroLongBreak: 15,
      pomodoroSessions: 4,
      dailyGoalHours: 8,
      weeklyGoalHours: 40,
      monthlyGoalHours: 160,
      trackEnergy: true,
      trackCategory: true,
      autoBreakReminder: true,
      breakReminderInterval: 90,
      soundEnabled: true,
      notificationsEnabled: true,
      autosaveEnabled: true,
      showInterval: false,
      defaultProject: '',
      defaultCategory: '',
      defaultEnergy: 'medium',
      defaultInterval: 60,
      theme: 'light'
    };
  },

  // Save preferences
  savePreferences(preferences) {
    try {
      localStorage.setItem(this.storage.preferences, JSON.stringify(preferences));
      return true;
    } catch (err) {
      console.error('Failed to save preferences', err);
      return false;
    }
  },

  // Get goals
  getGoals() {
    try {
      const data = localStorage.getItem(this.storage.goals);
      return data ? JSON.parse(data) : this.getDefaultGoals();
    } catch (err) {
      console.error('Failed to load goals', err);
      return this.getDefaultGoals();
    }
  },

  // Default goals
  getDefaultGoals() {
    return {
      daily: { hours: 8, enabled: true },
      weekly: { hours: 40, enabled: true },
      monthly: { hours: 160, enabled: false }
    };
  },

  // Save goals
  saveGoals(goals) {
    try {
      localStorage.setItem(this.storage.goals, JSON.stringify(goals));
      return true;
    } catch (err) {
      console.error('Failed to save goals', err);
      return false;
    }
  },

  // Calculate productivity score (0-100)
  calculateProductivityScore(logs, date = new Date()) {
    const prefs = this.getPreferences();
    const goals = this.getGoals();

    // Filter logs for the given date
    const dayLogs = logs.filter(log => {
      if (!log.date || !log.endTime) return false;
      const logDate = new Date(log.endTime);
      return logDate.toDateString() === date.toDateString();
    });

    if (dayLogs.length === 0) return 0;

    // Calculate total hours
    const totalMs = dayLogs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = totalMs / (1000 * 60 * 60);

    // Goal achievement (40% weight)
    const goalHours = goals.daily.hours;
    const goalScore = Math.min(100, (totalHours / goalHours) * 100) * 0.4;

    // Category distribution (30% weight)
    const categoryCount = new Set(dayLogs.map(log => {
      const meta = this.getLogMetadata(log.path);
      return meta?.category || 'other';
    })).size;
    const categoryScore = Math.min(100, (categoryCount / 5) * 100) * 0.3;

    // Energy levels (30% weight)
    const energyTotal = dayLogs.reduce((sum, log) => {
      const meta = this.getLogMetadata(log.path);
      const energyLevel = meta?.energy || 'medium';
      return sum + (this.energyLevels[energyLevel]?.value || 2);
    }, 0);
    const avgEnergy = energyTotal / dayLogs.length;
    const energyScore = (avgEnergy / 3) * 100 * 0.3;

    return Math.round(goalScore + categoryScore + energyScore);
  },

  // Get productivity insights
  getProductivityInsights(logs, days = 7) {
    const insights = [];
    const now = new Date();
    const startDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

    // Filter recent logs
    const recentLogs = logs.filter(log => {
      if (!log.endTime) return false;
      const logDate = new Date(log.endTime);
      return logDate >= startDate;
    });

    if (recentLogs.length === 0) {
      insights.push({ type: 'info', text: 'No recent activity to analyze' });
      return insights;
    }

    // Total hours
    const totalMs = recentLogs.reduce((sum, log) => sum + (log.durationMs || 0), 0);
    const totalHours = totalMs / (1000 * 60 * 60);
    const avgHoursPerDay = totalHours / days;

    insights.push({
      type: 'metric',
      text: `Average ${avgHoursPerDay.toFixed(1)}h per day over last ${days} days`
    });

    // Most productive category
    const categoryTotals = {};
    recentLogs.forEach(log => {
      const meta = this.getLogMetadata(log.path);
      const category = meta?.category || 'other';
      categoryTotals[category] = (categoryTotals[category] || 0) + (log.durationMs || 0);
    });

    const topCategory = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])[0];

    if (topCategory) {
      const categoryHours = topCategory[1] / (1000 * 60 * 60);
      const categoryName = this.categories[topCategory[0]]?.name || topCategory[0];
      insights.push({
        type: 'category',
        text: `Most time on ${categoryName}: ${categoryHours.toFixed(1)}h`
      });
    }

    // Energy pattern
    const energyByHour = {};
    recentLogs.forEach(log => {
      if (!log.endTime) return;
      const hour = new Date(log.endTime).getHours();
      const meta = this.getLogMetadata(log.path);
      const energy = meta?.energy || 'medium';
      if (!energyByHour[hour]) energyByHour[hour] = [];
      energyByHour[hour].push(this.energyLevels[energy]?.value || 2);
    });

    const bestHours = Object.entries(energyByHour)
      .map(([hour, values]) => ({
        hour: parseInt(hour),
        avgEnergy: values.reduce((a, b) => a + b, 0) / values.length
      }))
      .sort((a, b) => b.avgEnergy - a.avgEnergy)
      .slice(0, 3);

    if (bestHours.length > 0) {
      const topHour = bestHours[0].hour;
      insights.push({
        type: 'energy',
        text: `Peak energy around ${topHour}:00 - schedule important work then`
      });
    }

    return insights;
  },

  // Export enhanced data
  exportEnhanced() {
    return {
      projects: this.getProjects(),
      metadata: this.getAllLogMetadata(),
      preferences: this.getPreferences(),
      goals: this.getGoals(),
      exportedAt: new Date().toISOString()
    };
  },

  // Import enhanced data
  importEnhanced(data) {
    try {
      if (data.projects) this.saveProjects(data.projects);
      if (data.metadata) {
        localStorage.setItem(this.storage.logMetadata, JSON.stringify(data.metadata));
      }
      if (data.preferences) this.savePreferences(data.preferences);
      if (data.goals) this.saveGoals(data.goals);
      return true;
    } catch (err) {
      console.error('Failed to import enhanced data', err);
      return false;
    }
  },

  // Pomodoro methods
  getPomodoroStats() {
    try {
      const data = localStorage.getItem(this.storage.pomodoroStats);
      return data ? JSON.parse(data) : {
        totalSessions: 0,
        totalBreaks: 0,
        completedToday: 0,
        lastSessionDate: null,
        dailyStats: {}
      };
    } catch (err) {
      console.error('Failed to load Pomodoro stats', err);
      return {
        totalSessions: 0,
        totalBreaks: 0,
        completedToday: 0,
        lastSessionDate: null,
        dailyStats: {}
      };
    }
  },

  savePomodoroStats(stats) {
    try {
      localStorage.setItem(this.storage.pomodoroStats, JSON.stringify(stats));
      return true;
    } catch (err) {
      console.error('Failed to save Pomodoro stats', err);
      return false;
    }
  },

  recordPomodoroSession(date = new Date()) {
    const stats = this.getPomodoroStats();
    const dateKey = date.toISOString().split('T')[0];

    // Check if it's a new day
    if (stats.lastSessionDate !== dateKey) {
      stats.completedToday = 0;
      stats.lastSessionDate = dateKey;
    }

    // Update stats
    stats.totalSessions += 1;
    stats.completedToday += 1;

    // Update daily stats
    if (!stats.dailyStats[dateKey]) {
      stats.dailyStats[dateKey] = { sessions: 0, breaks: 0 };
    }
    stats.dailyStats[dateKey].sessions += 1;

    this.savePomodoroStats(stats);
    return stats;
  },

  recordPomodoroBreak(date = new Date()) {
    const stats = this.getPomodoroStats();
    const dateKey = date.toISOString().split('T')[0];

    stats.totalBreaks += 1;

    // Update daily stats
    if (!stats.dailyStats[dateKey]) {
      stats.dailyStats[dateKey] = { sessions: 0, breaks: 0 };
    }
    stats.dailyStats[dateKey].breaks += 1;

    this.savePomodoroStats(stats);
    return stats;
  },

  getPomodoroInsights(days = 7) {
    const stats = this.getPomodoroStats();
    const insights = [];

    if (stats.totalSessions === 0) {
      return insights;
    }

    // Calculate averages
    const dateKeys = Object.keys(stats.dailyStats).sort().slice(-days);
    if (dateKeys.length === 0) return insights;

    const totalSessions = dateKeys.reduce((sum, key) =>
      sum + (stats.dailyStats[key]?.sessions || 0), 0);
    const avgPerDay = (totalSessions / dateKeys.length).toFixed(1);

    insights.push({
      type: 'pomodoro',
      text: `Average ${avgPerDay} Pomodoro sessions per day (last ${days} days)`
    });

    // Today's count
    if (stats.completedToday > 0) {
      insights.push({
        type: 'pomodoro',
        text: `Completed ${stats.completedToday} Pomodoro sessions today`
      });
    }

    // Best day
    const bestDay = dateKeys.reduce((best, key) => {
      const sessions = stats.dailyStats[key]?.sessions || 0;
      return sessions > (stats.dailyStats[best]?.sessions || 0) ? key : best;
    }, dateKeys[0]);

    if (bestDay && stats.dailyStats[bestDay]) {
      insights.push({
        type: 'pomodoro',
        text: `Best day: ${bestDay} with ${stats.dailyStats[bestDay].sessions} sessions`
      });
    }

    return insights;
  }
};
