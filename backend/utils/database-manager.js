import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to data files
const DATA_DIR = path.join(__dirname, '../data');
const PATHS = {
  patients: path.join(DATA_DIR, 'patients.json'),
  appointments: path.join(DATA_DIR, 'appointments.json'),
  availableSlots: path.join(DATA_DIR, 'available-slots.json'),
  conversationLogs: path.join(DATA_DIR, 'conversation-logs.json'),
  emergencyAlerts: path.join(DATA_DIR, 'emergency-alerts.json')
};

/**
 * Read a specific data file
 * @param {string} type - Type of data (patients, appointments, etc.)
 * @returns {Promise<Object>}
 */
export async function readData(type) {
  try {
    const filePath = PATHS[type];
    if (!filePath) {
      throw new Error(`Unknown data type: ${type}`);
    }
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${type}:`, error.message);
    // Return empty structure if file doesn't exist
    return { [type]: [] };
  }
}

/**
 * Write data to a specific file
 * @param {string} type - Type of data
 * @param {Object} data - Data to write
 * @returns {Promise<void>}
 */
export async function writeData(type, data) {
  try {
    const filePath = PATHS[type];
    if (!filePath) {
      throw new Error(`Unknown data type: ${type}`);
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error writing ${type}:`, error.message);
    throw error;
  }
}

/**
 * Read all database files
 * @returns {Promise<Object>}
 */
export async function readAllData() {
  try {
    const [patients, appointments, availableSlots, conversationLogs, emergencyAlerts] = await Promise.all([
      readData('patients'),
      readData('appointments'),
      readData('availableSlots'),
      readData('conversationLogs'),
      readData('emergencyAlerts')
    ]);

    return {
      patients: patients.patients || [],
      appointments: appointments.appointments || [],
      availableSlots: availableSlots.availableSlots || [],
      conversationLogs: conversationLogs.conversationLogs || [],
      emergencyAlerts: emergencyAlerts.emergencyAlerts || []
    };
  } catch (error) {
    console.error('Error reading all data:', error.message);
    throw error;
  }
}

/**
 * Add a new patient
 * @param {Object} patient - Patient data
 * @returns {Promise<Object>}
 */
export async function addPatient(patient) {
  const data = await readData('patients');
  data.patients.push(patient);
  await writeData('patients', data);
  return patient;
}

/**
 * Find patient by phone
 * @param {string} phone - Phone number (normalized)
 * @returns {Promise<Object|null>}
 */
export async function findPatientByPhone(phone) {
  const data = await readData('patients');
  // Use the same normalization logic as server.js validatePhoneNumber function
  const normalizePhone = (p) => {
    if (!p) return '';
    // Remove all non-digit characters
    const cleanPhone = p.replace(/\D/g, '');
    // Handle 11 digits starting with 1 (US country code)
    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      return cleanPhone.substring(1);
    }
    return cleanPhone;
  };
  const normalized = normalizePhone(phone);
  return data.patients.find(p => normalizePhone(p.phone) === normalized) || null;
}

/**
 * Find patient by ID
 * @param {string} patientId - Patient ID
 * @returns {Promise<Object|null>}
 */
export async function findPatientById(patientId) {
  const data = await readData('patients');
  return data.patients.find(p => p.id === patientId) || null;
}

/**
 * Add a new appointment
 * @param {Object} appointment - Appointment data
 * @returns {Promise<Object>}
 */
export async function addAppointment(appointment) {
  const data = await readData('appointments');
  data.appointments.push(appointment);
  await writeData('appointments', data);
  return appointment;
}

/**
 * Get available slots for a date range
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>}
 */
export async function getAvailableSlots(startDate, endDate) {
  const data = await readData('availableSlots');
  return data.availableSlots.filter(slot => {
    return slot.date >= startDate && slot.date <= endDate;
  });
}

/**
 * Remove a time slot (when booked)
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} time - Time slot
 * @returns {Promise<void>}
 */
export async function removeTimeSlot(date, time) {
  const data = await readData('availableSlots');
  const dateSlot = data.availableSlots.find(s => s.date === date);
  if (dateSlot) {
    dateSlot.slots = dateSlot.slots.filter(t => t !== time);
    await writeData('availableSlots', data);
  }
}

/**
 * Add conversation log entry
 * @param {Object} logEntry - Log entry
 * @returns {Promise<void>}
 */
export async function addConversationLog(logEntry) {
  const data = await readData('conversationLogs');
  data.conversationLogs.push(logEntry);
  await writeData('conversationLogs', data);
}

/**
 * Add emergency alert
 * @param {Object} alert - Emergency alert
 * @returns {Promise<void>}
 */
export async function addEmergencyAlert(alert) {
  const data = await readData('emergencyAlerts');
  data.emergencyAlerts.push(alert);
  await writeData('emergencyAlerts', data);
}

/**
 * Get conversation logs by conversation ID
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Array>}
 */
export async function getConversationLogs(conversationId) {
  const data = await readData('conversationLogs');
  return data.conversationLogs.filter(log => log.conversationId === conversationId);
}

/**
 * Get conversation summary (for support/debugging)
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Object>}
 */
export async function getConversationSummary(conversationId) {
  const logs = await getConversationLogs(conversationId);
  
  if (logs.length === 0) {
    return null;
  }
  
  const userMessages = logs.filter(l => l.role === 'user');
  const assistantMessages = logs.filter(l => l.role === 'assistant');
  const errors = logs.filter(l => l.role === 'system' && l.message?.includes('ERROR'));
  
  return {
    conversationId,
    startTime: logs[0]?.timestamp,
    endTime: logs[logs.length - 1]?.timestamp,
    totalMessages: logs.length,
    userMessages: userMessages.length,
    assistantMessages: assistantMessages.length,
    errors: errors.length,
    hasErrors: errors.length > 0,
    lastMessage: logs[logs.length - 1]?.message
  };
}

/**
 * Get recent conversations (last N)
 * @param {number} limit - Number of conversations to retrieve
 * @returns {Promise<Array>}
 */
export async function getRecentConversations(limit = 20) {
  const data = await readData('conversationLogs');
  const conversationMap = new Map();
  
  // Group by conversationId and get latest timestamp
  data.conversationLogs.forEach(log => {
    if (!conversationMap.has(log.conversationId)) {
      conversationMap.set(log.conversationId, {
        conversationId: log.conversationId,
        lastTimestamp: log.timestamp
      });
    } else {
      const existing = conversationMap.get(log.conversationId);
      if (log.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = log.timestamp;
      }
    }
  });
  
  // Sort by last timestamp and limit
  return Array.from(conversationMap.values())
    .sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp))
    .slice(0, limit);
}

/**
 * Get all emergency alerts
 * @param {string} status - Filter by status (optional)
 * @returns {Promise<Array>}
 */
export async function getEmergencyAlerts(status = null) {
  const data = await readData('emergencyAlerts');
  if (status) {
    return data.emergencyAlerts.filter(alert => alert.status === status);
  }
  return data.emergencyAlerts;
}
