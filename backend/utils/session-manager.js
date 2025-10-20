import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');

// In-memory cache for fast access
const sessionCache = new Map();

// Load sessions from file on startup
async function loadSessions() {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf8');
    
    // Handle empty file or whitespace-only content
    if (!data || !data.trim()) {
      console.log('📂 Sessions file is empty, initializing...');
      await saveSessions();
      return;
    }
    
    const sessions = JSON.parse(data);
    Object.entries(sessions).forEach(([id, session]) => {
      sessionCache.set(id, session);
    });
    console.log(`📂 Loaded ${sessionCache.size} sessions from file`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, create empty sessions file
      await saveSessions();
      console.log('📂 Created new sessions file');
    } else if (error instanceof SyntaxError) {
      // JSON parsing error - reinitialize the file
      console.log('📂 Sessions file corrupted, reinitializing...');
      await saveSessions();
    } else {
      console.error('Error loading sessions:', error);
    }
  }
}

// Save sessions to file
async function saveSessions() {
  try {
    const sessions = {};
    sessionCache.forEach((value, key) => {
      sessions[key] = value;
    });
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

// Auto-save sessions every 30 seconds
setInterval(saveSessions, 30000);

// Get session by ID
export function getSession(conversationId) {
  return sessionCache.get(conversationId) || null;
}

// Create or update session
export function setSession(conversationId, sessionData) {
  sessionCache.set(conversationId, {
    ...sessionData,
    lastUpdated: new Date().toISOString()
  });
}

// Update session context (conversation history)
export function updateSessionContext(conversationId, context) {
  const session = getSession(conversationId) || {
    createdAt: new Date().toISOString()
  };
  
  session.context = context;
  session.lastUpdated = new Date().toISOString();
  
  setSession(conversationId, session);
}

// Store pending appointment details (before registration)
export function setPendingAppointment(conversationId, appointmentDetails) {
  const session = getSession(conversationId) || {
    createdAt: new Date().toISOString()
  };
  
  session.pendingAppointment = appointmentDetails;
  session.lastUpdated = new Date().toISOString();
  
  setSession(conversationId, session);
}

// Get pending appointment details
export function getPendingAppointment(conversationId) {
  const session = getSession(conversationId);
  return session?.pendingAppointment || null;
}

// Clear pending appointment after booking
export function clearPendingAppointment(conversationId) {
  const session = getSession(conversationId);
  if (session) {
    delete session.pendingAppointment;
    setSession(conversationId, session);
  }
}

// Store patient ID for the session
export function setSessionPatient(conversationId, patientId, patientName) {
  const session = getSession(conversationId) || {
    createdAt: new Date().toISOString()
  };
  
  session.patientId = patientId;
  session.patientName = patientName;
  session.lastUpdated = new Date().toISOString();
  
  setSession(conversationId, session);
}

// Get patient from session
export function getSessionPatient(conversationId) {
  const session = getSession(conversationId);
  return session ? { patientId: session.patientId, patientName: session.patientName } : null;
}

// Clean up old sessions (older than 24 hours)
function cleanupOldSessions() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let cleaned = 0;
  
  sessionCache.forEach((session, id) => {
    const lastUpdated = new Date(session.lastUpdated);
    if (lastUpdated < oneDayAgo) {
      sessionCache.delete(id);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} old sessions`);
    saveSessions();
  }
}

// Cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// Get session stats
export function getSessionStats() {
  const now = Date.now();
  const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  
  let activeLast5Min = 0;
  let activeLast1Hour = 0;
  
  sessionCache.forEach((session) => {
    const lastUpdated = new Date(session.lastUpdated);
    if (lastUpdated > fiveMinutesAgo) activeLast5Min++;
    if (lastUpdated > oneHourAgo) activeLast1Hour++;
  });
  
  return {
    totalSessions: sessionCache.size,
    activeLast5Min,
    activeLast1Hour
  };
}

// Initialize on module load
loadSessions();

// Export for graceful shutdown
export async function shutdown() {
  console.log('💾 Saving sessions before shutdown...');
  await saveSessions();
}

