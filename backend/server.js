import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import * as db from './utils/database-manager.js';
import { CORE_PROMPT, buildContext, getPracticeInfo } from './config/prompts.js';
import { analyzeConversations, recordFeedback, getInsights } from './utils/analytics.js';
import * as SessionManager from './utils/session-manager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dental-agent-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// AI Configuration - Choose your provider
const AI_PROVIDER = process.env.AI_PROVIDER || 'deepseek'; // 'deepseek' or 'gemini'

// DeepSeek Configuration
const deepseek = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com'
}) : null;

// Google Gemini Configuration
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
}) : null;

// Database is now handled by the database-manager module
// All database operations use the imported db functions

// Temporary compatibility layer for old code
async function readDatabase() {
  return await db.readAllData();
}

async function writeDatabase(data) {
  // Write each section to its respective file
  if (data.patients) await db.writeData('patients', { patients: data.patients });
  if (data.appointments) await db.writeData('appointments', { appointments: data.appointments });
  if (data.availableSlots) await db.writeData('availableSlots', { availableSlots: data.availableSlots });
  if (data.emergencyAlerts) await db.writeData('emergencyAlerts', { emergencyAlerts: data.emergencyAlerts });
}

// Store conversation contexts in memory (in production, use Redis or similar)
const conversationContexts = new Map();

// Conversation logs for support team backtracking
async function logConversation(conversationId, role, message, metadata = {}) {
  await db.addConversationLog({
    conversationId,
    role,
    message,
    timestamp: new Date().toISOString(),
    ...metadata
  });
}


// System prompt for the dental chatbot
// System prompt is now in config/prompts.js for easier maintenance
// This reduces token usage and improves AI response speed


// Enhanced validation functions for standard patient data
function validatePhoneNumber(phone) {
  if (!phone) return { valid: false, message: 'Phone number is required' };
  
  // Remove all non-digit characters
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Check if it's a valid US phone number (10 digits)
  if (cleanPhone.length === 10) {
    return { valid: true, normalized: cleanPhone };
  }
  
  // Check if it's 11 digits starting with 1 (US country code)
  if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return { valid: true, normalized: cleanPhone.substring(1) };
  }
  
  return { valid: false, message: 'Please provide a valid 10-digit US phone number' };
}

function validatePatientName(name) {
  if (!name || name.trim().length < 2) {
    return { valid: false, message: 'Please provide a valid full name (at least 2 characters)' };
  }
  
  // Check for valid name format (letters, spaces, hyphens, apostrophes)
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  if (!nameRegex.test(name.trim())) {
    return { valid: false, message: 'Name can only contain letters, spaces, hyphens, and apostrophes' };
  }
  
  return { valid: true, normalized: name.trim() };
}

function validateDateOfBirth(dob) {
  if (!dob) return { valid: false, message: 'Date of birth is required' };
  
  // Check MMDDYYYY format
  const dobRegex = /^\d{8}$/;
  if (!dobRegex.test(dob)) {
    return { valid: false, message: 'Please provide date of birth in MMDDYYYY format (e.g., 08272000)' };
  }
  
  // Validate the date
  const month = parseInt(dob.substring(0, 2));
  const day = parseInt(dob.substring(2, 4));
  const year = parseInt(dob.substring(4, 8));
  
  if (month < 1 || month > 12) {
    return { valid: false, message: 'Invalid month in date of birth' };
  }
  
  if (day < 1 || day > 31) {
    return { valid: false, message: 'Invalid day in date of birth' };
  }
  
  if (year < 1900 || year > new Date().getFullYear()) {
    return { valid: false, message: 'Invalid year in date of birth' };
  }
  
  return { valid: true, normalized: dob };
}

function validateInsurance(insurance) {
  const validInsurances = [
    'Blue Cross Blue Shield', 'Blue Cross', 'Aetna', 'Cigna', 'Delta Dental', 
    'MetLife', 'United Healthcare', 'Humana', 'Other Insurance', 'No Insurance'
  ];
  
  if (!insurance || insurance.trim().length < 2) {
    return { valid: false, message: 'Please select an insurance provider' };
  }
  
  const normalizedInsurance = insurance.trim();
  const found = validInsurances.find(ins => 
    ins.toLowerCase() === normalizedInsurance.toLowerCase()
  );
  
  if (!found) {
    return { valid: false, message: `Please select from: ${validInsurances.join(', ')}` };
  }
  
  return { valid: true, normalized: found };
}

async function searchPatient({ phone, name }) {
  let patient = null;
  
  // Enhanced phone validation
  if (phone) {
    const phoneValidation = validatePhoneNumber(phone);
    if (!phoneValidation.valid) {
      return { found: false, message: phoneValidation.message, validationError: true };
    }
    
    console.log(`🔍 Searching for patient with phone: ${phoneValidation.normalized}`);
    patient = await db.findPatientByPhone(phoneValidation.normalized);
    
    if (patient) {
      console.log(`✅ Found patient: ${patient.fullName} (ID: ${patient.id})`);
    } else {
      console.log(`❌ No patient found with phone: ${phoneValidation.normalized}`);
    }
  }
  
  if (!patient && name) {
    const allData = await db.readAllData();
    patient = allData.patients.find(p => 
      p.fullName.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(p.fullName.toLowerCase())
    );
  }
  
          if (patient) {
            const allData = await db.readAllData();
            
            console.log(`🔍 Found patient: ${patient.fullName} (${patient.id})`);
            console.log(`🔍 Total appointments in system: ${allData.appointments.length}`);
            
            // Get all appointments for this patient (both personal and family member appointments)
            const appointments = allData.appointments.filter(a => 
              a.patientId === patient.id && a.status !== 'cancelled'
            );
            
            console.log(`🔍 Patient's total appointments: ${appointments.length}`);
            appointments.forEach(apt => {
              console.log(`  • ${apt.patientName} - ${apt.date} at ${apt.time} - ${apt.type} (${apt.status})`);
            });
    
    // No need to separate family appointments - they're all in the appointments array
    const familyAppointments = [];
    const familyMembers = patient.familyMembers || [];
    
    return { found: true, patient, appointments, familyAppointments, familyMembers };
  }
  
  return { found: false, message: 'No patient found with that information' };
}

// Helper function to parse subjective dates like "later next week", "early next month"
function parseSubjectiveDate(dateString) {
  const now = new Date('2025-10-19'); // Current date context
  const lower = dateString.toLowerCase();
  
  if (lower.includes('later this week') || lower.includes('end of this week')) {
    const start = new Date(now);
    start.setDate(now.getDate() + 2);
    const end = new Date(now);
    end.setDate(now.getDate() + 7);
    return { start, end };
  }
  
  if (lower.includes('next week')) {
    const start = new Date(now);
    start.setDate(now.getDate() + 7);
    const end = new Date(now);
    end.setDate(now.getDate() + 14);
    if (lower.includes('early')) {
      end.setDate(start.getDate() + 3);
    } else if (lower.includes('late')) {
      start.setDate(start.getDate() + 4);
    }
    return { start, end };
  }
  
  if (lower.includes('next month')) {
    const start = new Date('2025-11-01');
    const end = new Date('2025-11-30');
    if (lower.includes('early')) {
      end.setDate(7);
    } else if (lower.includes('late')) {
      start.setDate(20);
    }
    return { start, end };
  }
  
  if (lower.includes('asap') || lower.includes('soonest')) {
    const start = new Date(now);
    const end = new Date(now);
    end.setDate(now.getDate() + 3);
    return { start, end };
  }
  
  const start = new Date(now);
  const end = new Date(now);
  end.setDate(now.getDate() + 7);
  return { start, end };
}

async function getAvailableSlots({ startDate, endDate, preferredTimes, subjectiveDate }) {
  const allData = await db.readAllData();
  
  let start, end;
  
  // Handle subjective dates
  if (subjectiveDate) {
    const parsed = parseSubjectiveDate(subjectiveDate);
    start = parsed.start;
    end = parsed.end;
  } else {
    start = new Date(startDate);
    end = new Date(endDate);
    if (start.getFullYear() !== 2025) start.setFullYear(2025);
    if (end.getFullYear() !== 2025) end.setFullYear(2025);
  }
  
  // If dates are invalid, use default range
  if (isNaN(start.getTime())) {
    start = new Date('2025-10-21');
  }
  if (isNaN(end.getTime())) {
    end = new Date('2025-11-05');
  }
  
  const availableSlots = allData.availableSlots.filter(slot => {
    const slotDate = new Date(slot.date);
    return slotDate >= start && slotDate <= end && slot.slots.length > 0;
  });
  
  // Filter by preferred times if specified
  if (preferredTimes && preferredTimes.length > 0 && !preferredTimes.includes('any')) {
    return availableSlots.map(slot => {
      const filteredSlots = slot.slots.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        const isPM = time.includes('PM');
        const hour24 = isPM && hour !== 12 ? hour + 12 : hour === 12 && !isPM ? 0 : hour;
        
        if (preferredTimes.includes('morning') && hour24 < 12) return true;
        if (preferredTimes.includes('afternoon') && hour24 >= 12 && hour24 < 17) return true;
        if (preferredTimes.includes('evening') && hour24 >= 17) return true;
        return false;
      });
      return { ...slot, slots: filteredSlots };
    }).filter(slot => slot.slots.length > 0);
  }
  
  return availableSlots;
}

async function bookAppointment({ patientId, patientName, date, time, type, emergencyDetails }) {
  console.log(`🔧 bookAppointment called with:`, { patientId, patientName, date, time, type });
  
  const db = await readDatabase();
  
  // Validate that patient exists in database
  const patient = db.patients.find(p => p.id === patientId);
  if (!patient) {
    console.log(`❌ Patient not found: ${patientId}`);
    return { 
      success: false, 
      message: `Patient with ID ${patientId} not found. Please register the patient first using register_new_patient function.` 
    };
  }
  
  // Validate that patient name matches
  if (patient.fullName !== patientName) {
    console.log(`⚠️ Patient name mismatch: expected "${patient.fullName}", got "${patientName}"`);
    return {
      success: false,
      message: `Patient name mismatch. Expected "${patient.fullName}" but got "${patientName}". Please use the correct patient name.`
    };
  }
  
  console.log(`✅ Validated patient: ${patient.fullName} (${patient.id})`);
  
  // Overwrite any existing same-day appointments for this patient
  const sameDayAppointments = db.appointments.filter(a => 
    a.patientId === patientId && a.date === date && a.status !== 'cancelled'
  );
  if (sameDayAppointments.length > 0) {
    console.log(`🔄 Overwriting ${sameDayAppointments.length} existing appointment(s) for ${patient.fullName} on ${date}`);
    const sameDaySlots = db.availableSlots.find(s => s.date === date);
    for (const a of sameDayAppointments) {
      // Return old slot to availability
      if (sameDaySlots && !sameDaySlots.slots.includes(a.time)) {
        sameDaySlots.slots.push(a.time);
        sameDaySlots.slots.sort();
      }
      a.status = 'cancelled';
      a.cancelledAt = new Date().toISOString();
      a.cancelReason = 'overwritten_by_new_booking';
    }
  }

  // Check if slot is still available
  const daySlots = db.availableSlots.find(s => s.date === date);
  if (!daySlots || !daySlots.slots.includes(time)) {
    return { success: false, message: 'This time slot is no longer available' };
  }
  
  // Create appointment
  const appointment = {
    id: `a${String(db.appointments.length + 1).padStart(3, '0')}`,
    patientId,
    patientName,
    date,
    time,
    type,
    status: 'scheduled',
    emergencyDetails: emergencyDetails || null,
    createdAt: new Date().toISOString()
  };
  
  db.appointments.push(appointment);
  
  // Remove slot from available slots
  daySlots.slots = daySlots.slots.filter(s => s !== time);
  
  await writeDatabase(db);
  
  return { success: true, appointment };
}

async function registerNewPatient({ fullName, phone, dateOfBirth, insurance }) {
  // Validate all required fields using validation functions
  const nameValidation = validatePatientName(fullName);
  if (!nameValidation.valid) {
    return { success: false, message: nameValidation.message };
  }
  
  const phoneValidation = validatePhoneNumber(phone);
  if (!phoneValidation.valid) {
    return { success: false, message: phoneValidation.message };
  }
  
  const dobValidation = validateDateOfBirth(dateOfBirth);
  if (!dobValidation.valid) {
    return { success: false, message: dobValidation.message };
  }
  
  const insuranceValidation = validateInsurance(insurance);
  if (!insuranceValidation.valid) {
    return { success: false, message: insuranceValidation.message };
  }
  
  // Check if patient already exists using normalized phone
  const existing = await searchPatient({ phone: phoneValidation.normalized });
  if (existing.found) {
    return { 
      success: false, 
      message: `A patient with phone number ${phoneValidation.normalized} already exists`, 
      patient: existing.patient,
      duplicateError: true 
    };
  }
  
  // Create new patient with validated and normalized data
  const allData = await db.readAllData();
  const patient = {
    id: `p${String(allData.patients.length + 1).padStart(3, '0')}`,
    fullName: nameValidation.normalized,
    phone: phoneValidation.normalized,
    dateOfBirth: dobValidation.normalized,
    insurance: insuranceValidation.normalized,
    registeredDate: new Date().toISOString().split('T')[0],
    familyMembers: []
  };
  
  await db.addPatient(patient);
  
  return { success: true, patient };
}

async function cancelAppointment({ appointmentId }) {
  console.log(`🔧 Cancelling appointment: ${appointmentId}`);
  
  const db = await readDatabase();
  
  const appointment = db.appointments.find(a => a.id === appointmentId);
  if (!appointment) {
    console.log(`❌ Appointment not found: ${appointmentId}`);
    return { success: false, message: 'Appointment not found' };
  }
  
  console.log(`📅 Found appointment: ${appointment.patientName} - ${appointment.date} at ${appointment.time}`);
  
  // Check if appointment is already cancelled
  if (appointment.status === 'cancelled') {
    console.log(`⚠️ Appointment already cancelled: ${appointmentId}`);
    return { success: false, message: 'Appointment is already cancelled' };
  }
  
  // Return slot to available slots
  const daySlots = db.availableSlots.find(s => s.date === appointment.date);
  if (daySlots) {
    if (!daySlots.slots.includes(appointment.time)) {
      daySlots.slots.push(appointment.time);
      daySlots.slots.sort();
      console.log(`✅ Returned slot ${appointment.time} to availability for ${appointment.date}`);
    } else {
      console.log(`ℹ️ Slot ${appointment.time} already available for ${appointment.date}`);
    }
  } else {
    console.log(`⚠️ No available slots found for date ${appointment.date}`);
  }
  
  // Update appointment status to cancelled
  appointment.status = 'cancelled';
  appointment.cancelledAt = new Date().toISOString();
  
  console.log(`✅ Updated appointment status to cancelled`);
  
  await writeDatabase(db);
  
  console.log(`💾 Saved changes to database`);
  
  return { 
    success: true, 
    message: 'Appointment cancelled successfully', 
    appointment: {
      id: appointment.id,
      patientName: appointment.patientName,
      date: appointment.date,
      time: appointment.time,
      type: appointment.type,
      status: appointment.status
    }
  };
}

// New function to cancel all appointments for a patient
async function cancelAllAppointments({ patientId }) {
  console.log(`🔧 Cancelling all appointments for patient: ${patientId}`);
  
  const db = await readDatabase();
  
  // Find all active appointments for the patient
  const appointments = db.appointments.filter(a => 
    a.patientId === patientId && a.status !== 'cancelled'
  );
  
  console.log(`📅 Found ${appointments.length} active appointments to cancel`);
  
  if (appointments.length === 0) {
    console.log(`⚠️ No active appointments found for patient ${patientId}`);
    return { success: false, message: 'No active appointments found to cancel' };
  }
  
  // Cancel each appointment
  const cancelledAppointments = [];
  for (const appointment of appointments) {
    console.log(`🔄 Cancelling appointment: ${appointment.patientName} - ${appointment.date} at ${appointment.time}`);
    
    // Return slot to available slots
    const daySlots = db.availableSlots.find(s => s.date === appointment.date);
    if (daySlots) {
      if (!daySlots.slots.includes(appointment.time)) {
        daySlots.slots.push(appointment.time);
        daySlots.slots.sort();
        console.log(`✅ Returned slot ${appointment.time} to availability for ${appointment.date}`);
      } else {
        console.log(`ℹ️ Slot ${appointment.time} already available for ${appointment.date}`);
      }
    } else {
      console.log(`⚠️ No available slots found for date ${appointment.date}`);
    }
    
    // Update appointment status
    appointment.status = 'cancelled';
    appointment.cancelledAt = new Date().toISOString();
    
    cancelledAppointments.push({
      id: appointment.id,
      patientName: appointment.patientName,
      date: appointment.date,
      time: appointment.time,
      type: appointment.type
    });
  }
  
  console.log(`✅ Successfully cancelled ${cancelledAppointments.length} appointment(s)`);
  console.log(`💾 Saving changes to database`);
  
  await writeDatabase(db);
  
  return { 
    success: true, 
    message: `Successfully cancelled ${cancelledAppointments.length} appointment(s)`,
    cancelledAppointments 
  };
}

async function rescheduleAppointment({ appointmentId, newDate, newTime }) {
  const db = await readDatabase();
  
  const appointment = db.appointments.find(a => a.id === appointmentId);
  if (!appointment) {
    return { success: false, message: 'Appointment not found' };
  }
  
  // Check if new slot is available
  const newDaySlots = db.availableSlots.find(s => s.date === newDate);
  if (!newDaySlots || !newDaySlots.slots.includes(newTime)) {
    return { success: false, message: 'The requested time slot is not available' };
  }
  
  // Return old slot to available slots
  const oldDaySlots = db.availableSlots.find(s => s.date === appointment.date);
  if (oldDaySlots && !oldDaySlots.slots.includes(appointment.time)) {
    oldDaySlots.slots.push(appointment.time);
    oldDaySlots.slots.sort();
  }
  
  // Remove new slot from available slots
  newDaySlots.slots = newDaySlots.slots.filter(s => s !== newTime);
  
  // Update appointment
  const oldDate = appointment.date;
  const oldTime = appointment.time;
  appointment.date = newDate;
  appointment.time = newTime;
  appointment.rescheduledFrom = { date: oldDate, time: oldTime };
  appointment.rescheduledAt = new Date().toISOString();
  
  await writeDatabase(db);
  
  return { success: true, message: 'Appointment rescheduled successfully', appointment };
}

async function notifyStaffEmergency({ patientName, emergencyDetails, contactPhone }) {
  // Validate emergency data
  const nameValidation = validatePatientName(patientName);
  if (!nameValidation.valid) {
    return { success: false, message: nameValidation.message };
  }
  
  const phoneValidation = validatePhoneNumber(contactPhone);
  if (!phoneValidation.valid) {
    return { success: false, message: phoneValidation.message };
  }
  
  if (!emergencyDetails || emergencyDetails.trim().length < 5) {
    return { success: false, message: 'Please provide details about the emergency (at least 5 characters)' };
  }
  
  // In a real system, this would send email/SMS to staff
  const timestamp = new Date().toLocaleString();
  
  // Log to database for staff to see
  const db = await readDatabase();
  // Guard: Avoid duplicate emergency alerts with same phone in last 10 minutes
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const recentlyAlerted = (db.emergencyAlerts || []).some(alert => 
    alert.contactPhone === phoneValidation.normalized &&
    new Date(alert.alertedAt).getTime() >= tenMinutesAgo
  );
  if (recentlyAlerted) {
    return { success: true, message: '🚨 Emergency already reported recently. Our team is on it.' };
  }
  if (!db.emergencyAlerts) db.emergencyAlerts = [];
  
  db.emergencyAlerts.push({
    id: `emg_${Date.now()}`,
    patientName: nameValidation.normalized,
    emergencyDetails: emergencyDetails.trim(),
    contactPhone: phoneValidation.normalized,
    timestamp,
    status: 'pending',
    alertedAt: new Date().toISOString()
  });
  
  await writeDatabase(db);
  
  return { 
    success: true, 
    message: `🚨 EMERGENCY ALERT: Our dental team has been notified about ${nameValidation.normalized}'s emergency (${emergencyDetails.trim()}). They are preparing to provide immediate care.`
  };
}

async function bookFamilyAppointments({ primaryPatientId, familyMembers, preferredDate, timing = 'back-to-back', primaryPatientAppointmentType = 'Cleaning' }) {
  console.log(`🔧 bookFamilyAppointments called with:`, { primaryPatientId, familyMembers, preferredDate, timing, primaryPatientAppointmentType });
  
  const db = await readDatabase();
  
  // Find primary patient
  const primaryPatient = db.patients.find(p => p.id === primaryPatientId);
  if (!primaryPatient) {
    console.log(`❌ Primary patient not found: ${primaryPatientId}`);
    return { success: false, message: 'Primary patient not found' };
  }
  
  console.log(`✅ Found primary patient: ${primaryPatient.fullName} (${primaryPatient.id})`);
  
  // Validate family members data
  if (!familyMembers || familyMembers.length === 0) {
    return { success: false, message: 'Family members information is required' };
  }
  
  // Validate each family member
  for (const member of familyMembers) {
    if (!member.name || member.name.trim().length < 2) {
      return { success: false, message: `Invalid name for family member: ${member.name || 'unnamed'}` };
    }
    if (!member.relationship || member.relationship.trim().length < 2) {
      return { success: false, message: `Invalid relationship for ${member.name}` };
    }
    if (!member.appointmentType || member.appointmentType.trim().length < 2) {
      return { success: false, message: `Invalid appointment type for ${member.name}` };
    }
  }
  
  // Initialize familyMembers array if it doesn't exist
  if (!primaryPatient.familyMembers) {
    primaryPatient.familyMembers = [];
  }
  
  // Get available slots for the date
  const dateSlots = db.availableSlots.find(s => s.date === preferredDate);
  const totalSlotsNeeded = familyMembers.length + 1; // +1 for primary patient
  
  // Overwrite any existing same-day appointments for primary and listed family members
  const candidatesToOverwrite = new Set([primaryPatientId]);
  for (const member of familyMembers) {
    const existing = db.patients.find(p => p.fullName.toLowerCase() === member.name.toLowerCase() && p.phone === primaryPatient.phone);
    if (existing) candidatesToOverwrite.add(existing.id);
  }
  const sameDayAppointments = db.appointments.filter(a => a.date === preferredDate && a.status !== 'cancelled' && candidatesToOverwrite.has(a.patientId));
  if (sameDayAppointments.length > 0) {
    console.log(`🔄 Overwriting ${sameDayAppointments.length} existing same-day appointment(s) before family booking on ${preferredDate}`);
    const sameDaySlots = db.availableSlots.find(s => s.date === preferredDate);
    for (const a of sameDayAppointments) {
      if (sameDaySlots && !sameDaySlots.slots.includes(a.time)) {
        sameDaySlots.slots.push(a.time);
        sameDaySlots.slots.sort();
      }
      a.status = 'cancelled';
      a.cancelledAt = new Date().toISOString();
      a.cancelReason = 'overwritten_by_family_booking';
    }
  }

  if (!dateSlots || dateSlots.slots.length < totalSlotsNeeded) {
    // Find next available date with enough slots
    const nextAvailable = db.availableSlots.find(s => {
      const slotDate = new Date(s.date);
      const preferDate = new Date(preferredDate);
      return slotDate > preferDate && s.slots.length >= totalSlotsNeeded;
    });
    
    if (nextAvailable) {
      return {
        success: false,
        insufficientSlots: true,
        availableSlots: dateSlots?.slots || [],
        nextAvailableDate: nextAvailable.date,
        nextAvailableSlots: nextAvailable.slots.slice(0, totalSlotsNeeded),
        message: `Only ${dateSlots?.slots.length || 0} slot(s) available on ${preferredDate}. Need ${totalSlotsNeeded} slots for you and ${familyMembers.length} family members. Next available date is ${nextAvailable.date}.`
      };
    }
    
    return { 
      success: false, 
      message: `Not enough consecutive slots available. Please book earlier times or contact us at 555-DENTAL.` 
    };
  }
  
  const bookedAppointments = [];
  let currentSlotIndex = 0;
  
  // FIRST: Book appointment for primary patient
  const primaryAppointmentId = `a${Date.now()}_primary`;
  const primaryAppointment = {
    id: primaryAppointmentId,
    patientId: primaryPatientId,
    patientName: primaryPatient.fullName,
    date: preferredDate,
    time: dateSlots.slots[currentSlotIndex],
    type: primaryPatientAppointmentType,
    status: 'confirmed',
    bookedAt: new Date().toISOString()
  };
  
  bookedAppointments.push(primaryAppointment);
  db.appointments.push(primaryAppointment);
  currentSlotIndex++;
  
  console.log(`✅ Booked primary patient appointment: ${primaryPatient.fullName} - ${preferredDate} at ${primaryAppointment.time}`);
  
  // SECOND: Book appointments for each family member (create separate patient records)
  for (const member of familyMembers) {
    if (currentSlotIndex >= dateSlots.slots.length) break;
    
    // Check if family member already exists as a patient
    let familyMemberPatient = db.patients.find(p => 
      p.fullName.toLowerCase() === member.name.toLowerCase() && 
      p.phone === primaryPatient.phone // Same phone number as primary patient
    );
    
    // If family member doesn't exist as a patient, create a new patient record
    if (!familyMemberPatient) {
      const newPatientId = `p${String(db.patients.length + 1).padStart(3, '0')}`;
      familyMemberPatient = {
        id: newPatientId,
        fullName: member.name,
        phone: primaryPatient.phone, // Use primary patient's phone
        dateOfBirth: primaryPatient.dateOfBirth, // Use primary patient's DOB as default
        insurance: primaryPatient.insurance, // Use primary patient's insurance
        registeredDate: new Date().toISOString().split('T')[0],
        familyMembers: []
      };
      
      db.patients.push(familyMemberPatient);
      console.log(`✅ Created new patient record for family member: ${member.name} (${newPatientId})`);
    }
    
    // Book appointment for family member with their own patient ID
    const appointmentId = `a${Date.now()}_${currentSlotIndex}`;
    const appointment = {
      id: appointmentId,
      patientId: familyMemberPatient.id, // Use family member's own patient ID
      patientName: member.name, // Family member's name
      relationship: member.relationship, // Store relationship for display
      date: preferredDate,
      time: dateSlots.slots[currentSlotIndex],
      type: member.appointmentType || 'General Checkup',
      status: 'confirmed',
      bookedAt: new Date().toISOString()
    };
    
    bookedAppointments.push(appointment);
    db.appointments.push(appointment);
    
    // Add family member to primary patient's familyMembers array (just store name and relationship)
    const existingMember = primaryPatient.familyMembers.find(fm => fm.name === member.name);
    if (!existingMember) {
      primaryPatient.familyMembers.push({
        name: member.name,
        relationship: member.relationship || 'family',
        addedDate: new Date().toISOString().split('T')[0]
      });
      console.log(`✅ Added family member to primary patient record: ${member.name} - ${member.relationship}`);
    } else {
      console.log(`ℹ️ Family member already exists: ${member.name}`);
    }
    
    currentSlotIndex++;
  }
  
  // Remove used slots
  dateSlots.slots = dateSlots.slots.slice(bookedAppointments.length);
  
  console.log(`💾 Saving to database:`, { 
    appointmentsAdded: bookedAppointments.length, 
    familyMembersAdded: primaryPatient.familyMembers.length,
    primaryPatient: primaryPatient.fullName,
    familyMembers: primaryPatient.familyMembers.map(fm => `${fm.name} (${fm.relationship})`)
  });
  
  await writeDatabase(db);
  
  console.log(`✅ Family booking completed successfully!`);
  
  return {
    success: true,
    appointments: bookedAppointments,
    familyMembersAdded: familyMembers.length,
    message: `✅ Successfully booked ${bookedAppointments.length} appointments for you and your family!`,
    details: bookedAppointments.map(a => `${a.patientName} - ${a.date} at ${a.time} - ${a.type}`)
  };
}

// Execute function calls
async function executeFunctionCall(functionName, args) {
  switch (functionName) {
    case 'search_patient':
      return await searchPatient(args);
    case 'get_available_slots':
      return await getAvailableSlots(args);
    case 'book_appointment':
      return await bookAppointment(args);
    case 'register_new_patient':
      return await registerNewPatient(args);
    case 'cancel_appointment':
      return await cancelAppointment(args);
    case 'cancel_all_appointments':
      return await cancelAllAppointments(args);
    case 'reschedule_appointment':
      return await rescheduleAppointment(args);
    case 'notify_staff_emergency':
      return await notifyStaffEmergency(args);
    case 'book_family_appointments':
      console.log(`🔧 Executing book_family_appointments with args:`, args);
      return await bookFamilyAppointments(args);
    default:
      return { error: 'Unknown function' };
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Dental Chatbot API is running' });
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await analyzeConversations();
    const insights = await getInsights();
    res.json({
      success: true,
      analytics,
      insights
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to generate analytics' });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { messageId, conversationId, feedback, comment } = req.body;

    if (!messageId || !conversationId || !feedback) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await recordFeedback(messageId, conversationId, feedback, comment);
    
    res.json(result);
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// Get practice info
app.get('/api/practice-info', async (req, res) => {
  try {
    const db = await readDatabase();
    res.json(db.practiceInfo);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch practice info' });
  }
});

// Helper function to call AI based on provider
async function callAI(messages, useProvider = AI_PROVIDER) {
  
  if (useProvider === 'gemini' && gemini) {
    // Build full conversation for Gemini
    let conversationText = '';
    let systemPrompt = '';
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        conversationText += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant' && msg.content) {
        conversationText += `Assistant: ${msg.content}\n`;
      }
    }
    
    const fullPrompt = systemPrompt 
      ? `${systemPrompt}\n\n${conversationText}Assistant:`
      : `${conversationText}Assistant:`;
    
    // Call Gemini
    const response = await gemini.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: fullPrompt,
    });
    
    return { content: response.text };
    
      } else if (useProvider === 'deepseek' && deepseek) {
        // DeepSeek API call (OpenAI-compatible)
        const response = await deepseek.chat.completions.create({
          model: 'deepseek-chat',
          messages: messages,
          temperature: 0.3, // Lower for faster, more focused responses
          max_tokens: 400, // Shorter responses = faster
          top_p: 0.9
        });

        return { content: response.choices[0].message.content };
      } else {
    throw new Error(`AI provider ${useProvider} not configured. Please check your .env file.`);
  }
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Get or create conversation context
    const convId = conversationId || uuidv4();
    
    // Load session (with context from file if server restarted)
    const session = SessionManager.getSession(convId);
    let context = session?.context || conversationContexts.get(convId) || [];
    
    // Add user message to context
    context.push({
      role: 'user',
      content: message
    });
    
    // Log user message
    await logConversation(convId, 'user', message);
    
    // Build dynamic context based on conversation state (SAVES TOKENS!)
    const messageLower = message.toLowerCase();
    const contextHistory = context.map(m => m.content?.toLowerCase() || '').join(' ');
    
    // More precise emergency detection - avoid false positives
    const isEmergency = (messageLower.includes('emergency') || messageLower.includes('urgent') ||
                        messageLower.includes('accident') || messageLower.includes('broken') ||
                        messageLower.includes('severe pain') || messageLower.includes('bleeding') ||
                        messageLower.includes('trauma') || messageLower.includes('injury')) &&
                        !messageLower.includes('appointment') && !messageLower.includes('schedule');
    
    console.log(`🔍 Emergency detection: message="${messageLower}", contextHistory="${contextHistory}", isEmergency=${isEmergency}`);
    
    const conversationState = {
      // Emergency detection - check current message, context history, and conversation history
      isEmergency,
      
      // First message detection
      isFirstMessage: context.length === 0 || context.length === 1,
      
      // Phone number detection
      hasPhoneNumber: /\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(message),
      
      // New patient detection - asking for name, DOB, or insurance (registration flow)
      isNewPatient: (contextHistory.includes("let's get you registered") || 
                     contextHistory.includes("what's your full name") ||
                     contextHistory.includes("date of birth") ||
                     contextHistory.includes("insurance")) &&
                    !contextHistory.includes('welcome back'),
      
      // Family booking detection
      isFamilyBooking: messageLower.includes('family') || messageLower.includes('roommate') ||
                       messageLower.includes('spouse') || messageLower.includes('kid') ||
                       contextHistory.includes('family'),
      hasMultiplePeople: (message.match(/,/g) || []).length >= 2, // Multiple names
      
      // Cancellation detection
      isCancellation: messageLower.includes('cancel') || contextHistory.includes('cancel'),
      
      // Booking detection
      isBooking: messageLower.includes('book') || messageLower.includes('schedule') ||
                 messageLower.includes('appointment'),
      userConfirmed: messageLower.includes('yes') || messageLower.includes('confirm') ||
                     messageLower.includes('sure') || messageLower.includes('ok')
    };
    
    const systemPrompt = buildContext(conversationState);
    
    // Prepare messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...context
    ];
    

    // Call AI
    const aiResponse = await callAI(messages);
    let responseText = aiResponse.content;
    
    // Parse and execute any actions in the response
    const actionRegex = /\[ACTION:\s*(\w+)\((.*?)\)\]/g;
    let match;
    const actionsExecuted = [];
    
    // Declare searchPatientAction at function scope for later use
    let searchPatientAction = null;
    
    while ((match = actionRegex.exec(responseText)) !== null) {
      const functionName = match[1];
      const argsStr = match[2];
      
      console.log(`🔧 Executing function: ${functionName} with args: ${argsStr}`);
      
      try {
        let functionArgs = {};
        try {
          functionArgs = JSON.parse(argsStr);
        } catch (e) {
          console.error('Failed to parse function args:', argsStr);
          continue;
        }
        
        // 🚨 CRITICAL: Override patient ID for family booking if session has correct data
        if (functionName === 'book_family_appointments' && req.session && req.session.patientId) {
          const originalPatientId = functionArgs.primaryPatientId;
          functionArgs.primaryPatientId = req.session.patientId;
          console.log(`🔧 OVERRIDE: Changed primaryPatientId from "${originalPatientId}" to "${req.session.patientId}" (${req.session.patientName})`);
        }
        
        const functionResult = await executeFunctionCall(functionName, functionArgs);
        actionsExecuted.push({ functionName, result: functionResult });
        
        // Store searchPatientAction for later use
        if (functionName === 'search_patient') {
          searchPatientAction = { functionName, result: functionResult };
        }
        
        // Dynamic result handling based on function type
        if (functionName === 'search_patient') {
          if (functionResult.found) {
            console.log(`✅ Found patient: ${functionResult.patient.fullName} (ID: ${functionResult.patient.id})`);
          } else {
            console.log(`❌ No patient found: ${functionResult.message}`);
          }
        } else if (functionName === 'book_appointment' || functionName === 'book_family_appointments') {
          if (functionResult.success) {
            console.log(`✅ Appointment booked successfully`);
          } else {
            console.log(`❌ Booking failed: ${functionResult.message}`);
          }
        } else if (functionName === 'register_new_patient') {
          if (functionResult.success) {
            console.log(`✅ Patient registered: ${functionResult.patient.fullName} (ID: ${functionResult.patient.id})`);
          } else {
            console.log(`❌ Registration failed: ${functionResult.message}`);
          }
        } else {
          console.log(`✅ Function ${functionName} executed successfully`);
        }
      } catch (err) {
        console.error('❌ Function execution error:', err);
        actionsExecuted.push({ functionName, error: err.message });
      }
    }
    
    // Remove ALL action markers from the response (don't show them to user)
    responseText = responseText.replace(/\[ACTION:\s*\w+\(.*?\)\]/g, '').trim();
    
    // Debug: Log if no actions were executed but we expected family booking
    if (actionsExecuted.length === 0 && message.toLowerCase().includes('family') && message.toLowerCase().includes('member')) {
      console.log(`⚠️ No actions executed for family booking request: "${message}"`);
    }
    
    // Also remove any [Function results: ...] that might appear
    responseText = responseText.replace(/\[Function results:.*?\]\]/g, '').trim();
    
    // Remove "Result: [....]" lines that the AI might add (handles nested brackets)
    responseText = responseText.replace(/Result:\s*\[[\s\S]*?\]\s*\n?/g, '').trim();
    
    // Remove lines that start with "(Function returns:" 
    responseText = responseText.replace(/\(Function returns:[\s\S]*?\)\s*\n?/g, '').trim();
    
    // Clean up any extra whitespace or newlines left after removing actions
    responseText = responseText.replace(/\n\n\n+/g, '\n\n').trim();
    
    // 🚨 FALLBACK: Detect if AI confirmed booking without calling function
    const bookingConfirmationPatterns = /✅\s*(Booked|Appointment\s+(Confirmed|Scheduled|Set))/i;
    if (bookingConfirmationPatterns.test(responseText) && actionsExecuted.length === 0) {
      console.log('⚠️ WARNING: AI confirmed booking but did NOT call booking function!');
      console.log('This booking will NOT be saved. AI needs to call [ACTION: book_appointment(...)]');
      
      // Add a warning to the response
      responseText += '\n\n⚠️ Note: Please confirm your appointment details by calling us at 555-DENTAL (555-336-8251) to ensure it\'s properly scheduled.';
    }
    
    // Dynamic response generation based on function results
    if (!responseText && actionsExecuted.length > 0) {
      console.log('🔄 Generating response based on function results...');
      console.log('Actions executed:', actionsExecuted.map(a => ({ functionName: a.functionName, success: !!a.result })));
      
      const lastAction = actionsExecuted[actionsExecuted.length - 1];
      const functionName = lastAction.functionName;
      const result = lastAction.result;
      
      // Generate human-like responses based on function result
      if (functionName === 'search_patient') {
        // Check if this is an emergency context - don't override AI response during emergencies
        console.log(`🔍 Checking emergency context: isEmergency=${conversationState.isEmergency}, messageLower="${messageLower}", contextHistory="${contextHistory}"`);
        if (conversationState.isEmergency) {
          console.log(`🚨 Emergency context detected - not overriding AI response for search_patient`);
          // Let the AI handle the emergency flow instead of overriding
          // Don't generate any response text - let the AI response stand
        } else if (result.found) {
          responseText = `Welcome back, ${result.patient.fullName}!`;
          if (result.appointments && result.appointments.length > 0) {
          responseText += `\n\nHere are your upcoming appointments:\n`;
          result.appointments.forEach(apt => {
            const relationshipText = apt.relationship ? ` (${apt.relationship})` : '';
            responseText += `• ${apt.patientName}${relationshipText} - ${apt.date} at ${apt.time} - ${apt.type}\n`;
          });
          } else {
            responseText += `\n\nYou don't have any upcoming appointments scheduled.`;
          }
          responseText += `\n\nWhat would you like to do today?\n- Schedule a new appointment\n- Ask a question\n- Update your information\n- Cancel any existing appointments`;
        } else {
          responseText = `I don't see you in our system yet. Let's get you registered!\n\nWhat's your full name?`;
        }
        
        // Store patient info in session for later use
        if (searchPatientAction?.result?.found && req.session) {
          req.session.patientId = searchPatientAction.result.patient.id;
          req.session.patientName = searchPatientAction.result.patient.fullName;
          console.log(`💾 Stored patient info in session: ${req.session.patientName} (${req.session.patientId})`);
        } else if (searchPatientAction?.result?.found) {
          console.log(`⚠️ Patient found but no session available: ${searchPatientAction.result.patient.fullName} (${searchPatientAction.result.patient.id})`);
        }
      } else if (functionName === 'book_appointment') {
        if (result.success) {
          responseText = `Appointment confirmed!\n\nYour ${result.appointment.type.toLowerCase()} is scheduled for:\n• Date: ${result.appointment.date}\n• Time: ${result.appointment.time}\n\nWe'll send you a reminder text 24 hours before your appointment. See you then!`;
        } else {
          // Check if it's a patient ID mismatch and try to fix it
          if (result.message.includes('Patient name mismatch') && req.session.patientId) {
            console.log(`🔧 Detected patient ID mismatch, attempting to fix with session data`);
            console.log(`Session patient: ${req.session.patientName} (${req.session.patientId})`);
            
            // Try to rebook with correct patient ID
            const lastAction = actionsExecuted[actionsExecuted.length - 1];
            if (lastAction && lastAction.functionName === 'book_appointment') {
              const originalArgs = JSON.parse(lastAction.args || '{}');
              originalArgs.patientId = req.session.patientId;
              originalArgs.patientName = req.session.patientName;
              
              console.log(`🔧 Retrying booking with correct patient info:`, originalArgs);
              
              // Retry the booking with correct patient info
              const retryResult = await executeFunctionCall('book_appointment', originalArgs);
              if (retryResult.success) {
                responseText = `Appointment confirmed!\n\nYour ${retryResult.appointment.type.toLowerCase()} is scheduled for:\n• Date: ${retryResult.appointment.date}\n• Time: ${retryResult.appointment.time}\n\nWe'll send you a reminder text 24 hours before your appointment. See you then!`;
              } else {
                responseText = `❌ Booking failed: ${retryResult.message}`;
              }
            } else {
              responseText = `❌ Booking failed: ${result.message}`;
            }
          } else {
            responseText = `❌ Booking failed: ${result.message}`;
          }
        }
      } else if (functionName === 'book_family_appointments') {
        if (result.success) {
          responseText = `All appointments confirmed!\n\nYour family appointments are scheduled:\n`;
          result.appointments.forEach(apt => {
            const relationshipText = apt.relationship ? ` (${apt.relationship})` : '';
            responseText += `• ${apt.patientName}${relationshipText} - ${apt.date} at ${apt.time} - ${apt.type}\n`;
          });
          responseText += `\nWe'll send reminders to everyone 24 hours before their appointments. See you all then!`;
        } else if (result.insufficientSlots) {
          responseText = `I found ${result.availableSlots.length} available slot(s) on your preferred date, but you need ${familyMembers.length} slots for your family.\n\n`;
          if (result.nextAvailableDate) {
            responseText += `The next available date with enough slots is ${result.nextAvailableDate}:\n`;
            result.nextAvailableSlots.forEach((slot, index) => {
              responseText += `• ${slot}\n`;
            });
            responseText += `\nWould you like to book for ${result.nextAvailableDate} instead?`;
          } else {
            responseText += `Please contact us at 555-DENTAL to find the best available times for your family.`;
          }
        } else {
          responseText = `❌ Family booking failed: ${result.message}`;
        }
      } else if (functionName === 'register_new_patient') {
        if (result.success) {
          responseText = `✅ Registration complete! Welcome to our practice! 🎉\n\nWhat type of appointment would you like to book?\n- Cleaning & Check-up\n- Filling\n- Crown/Bridge\n- Emergency/Dental Pain\n- Other`;
        } else {
          // Handle validation errors with helpful messages
          if (result.message.includes('name')) {
            responseText = `Please provide a valid full name (at least 2 characters, letters only). What's your full name?`;
          } else if (result.message.includes('date of birth') || result.message.includes('MMDDYYYY')) {
            responseText = `Please provide your date of birth in MMDDYYYY format (e.g., 08272000). What's your date of birth?`;
          } else if (result.message.includes('insurance')) {
            responseText = `Please select an insurance provider from the list:\n- Blue Cross\n- Aetna\n- Cigna\n- Delta Dental\n- MetLife\n- United Healthcare\n- Humana\n- Other Insurance\n- No Insurance\n\nWhich insurance provider do you have?`;
          } else if (result.message.includes('phone number') || result.message.includes('10-digit')) {
            responseText = `Please provide a valid 10-digit US phone number. What's your phone number?`;
          } else {
            responseText = `❌ Registration failed: ${result.message}`;
          }
        }
      } else if (functionName === 'get_available_slots') {
        if (result && result.length > 0) {
          responseText = `Perfect! Let me check our available slots. 📅\n\nHere are our available appointments for the next week:\n`;
          result.forEach(slot => {
            const date = new Date(slot.date);
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            responseText += `\n${dayName}:\n`;
            slot.slots.forEach(time => {
              responseText += `• ${time}\n`;
            });
          });
          responseText += `Which date and time works best for you?`;
        } else {
          responseText = `I don't see any available slots in that date range. Would you like me to check other dates or would you prefer to call us at 555-DENTAL to find the best available times?`;
        }
      } else {
        // Generic response for other functions
        responseText = result.message || 'Action completed successfully.';
      }
    }
    
    // 🚨 CRITICAL: Always override AI response when search_patient was called
    // This prevents AI from hallucinating patient data
    // searchPatientAction is already declared above
    if (searchPatientAction) {
      console.log('🔍 Search patient action detected - overriding AI response with database results');
      
      // Check if emergency functions were also called - if so, don't override
      const emergencyFunctionsCalled = actionsExecuted.some(action => 
        action.functionName === 'notify_staff_emergency'
      );
      
      if (emergencyFunctionsCalled) {
        console.log('🚨 Emergency functions were called - not overriding AI response');
        // Let the AI handle the emergency flow
      } else if (searchPatientAction.result?.found) {
        console.log('✅ Patient found in database - using exact data');
        const result = searchPatientAction.result;
        responseText = `Welcome back, ${result.patient.fullName}! 😊`;
        
        if (result.appointments && result.appointments.length > 0) {
          responseText += `\n\nHere are your upcoming appointments:\n`;
          result.appointments.forEach(apt => {
            const relationshipText = apt.relationship ? ` (${apt.relationship})` : '';
            responseText += `• ${apt.patientName}${relationshipText} - ${apt.date} at ${apt.time} - ${apt.type}\n`;
          });
        } else {
          responseText += `\n\nYou don't have any upcoming appointments scheduled.`;
        }
        responseText += `\n\nWhat would you like to do today?\n- Schedule a new appointment\n- Ask a question\n- Update your information\n- Cancel any existing appointments`;
      } else {
        console.log('❌ Patient not found in database - using exact message');
        responseText = `I don't see you in our system yet. Let's get you registered!\n\nWhat's your full name?`;
      }
    }
    
    
    // Generate unique message ID for feedback tracking
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Add final assistant message to context
    context.push({
      role: 'assistant',
      content: responseText
    });
    
    // Log assistant response WITH messageId for feedback tracking
    await logConversation(convId, 'assistant', responseText, { messageId });
    
    
    // Store updated context (keep last 20 messages to avoid token limits)
    if (context.length > 20) {
      context = context.slice(-20);
    }
    conversationContexts.set(convId, context);
    
    // Persist session to file
    SessionManager.updateSessionContext(convId, context);
    
    res.json({ 
      message: responseText,
      conversationId: convId,
      messageId, // For feedback tracking
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    
    // Log error for support team (use conversationId if available)
    const errorConvId = req.body.conversationId || 'error_' + Date.now();
    await logConversation(errorConvId, 'system', `ERROR: ${error.message}`, { error: error.stack });
    
    // User-friendly error message with escalation
    const fallbackMessage = "I apologize, but I'm experiencing technical difficulties right now. Please:\n\n" +
      "- Try again in a moment\n" +
      "- Call us directly at 555-DENTAL (555-336-8251)\n" +
      "- Visit us at 123 Main Street, Suite 200\n\n" +
      "Our team is available Mon-Sat, 8 AM - 6 PM. We're here to help!";
    
    res.status(200).json({ 
      message: fallbackMessage,
      conversationId: errorConvId,
      escalated: true
    });
  }
});

// Get all appointments (for testing/admin)
app.get('/api/appointments', async (req, res) => {
  try {
    const db = await readDatabase();
    res.json(db.appointments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get all patients (for testing/admin)
app.get('/api/patients', async (req, res) => {
  try {
    const db = await readDatabase();
    res.json(db.patients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get session stats (for monitoring)
app.get('/api/sessions/stats', (req, res) => {
  try {
    const stats = SessionManager.getSessionStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session stats' });
  }
});

// Get conversation history by session ID
app.get('/api/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const logs = await db.getConversationLogs(conversationId);
    const session = SessionManager.getSession(conversationId);
    
    res.json({
      conversationId,
      messageCount: logs.length,
      session: session || null,
      messages: logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

// Get all active conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const allData = await db.readAllData();
    const logs = allData.conversationLogs;
    
    // Group by conversationId
    const conversations = {};
    logs.forEach(log => {
      if (!conversations[log.conversationId]) {
        conversations[log.conversationId] = {
          conversationId: log.conversationId,
          startTime: log.timestamp,
          lastMessageTime: log.timestamp,
          messageCount: 0,
          lastMessage: '',
          feedbackCount: { helpful: 0, notHelpful: 0 }
        };
      }
      conversations[log.conversationId].messageCount++;
      conversations[log.conversationId].lastMessageTime = log.timestamp;
      if (log.role === 'user' || log.role === 'assistant') {
        conversations[log.conversationId].lastMessage = log.message?.substring(0, 100);
      }
      // Count feedback
      if (log.feedback) {
        if (log.feedback === 'helpful') {
          conversations[log.conversationId].feedbackCount.helpful++;
        } else if (log.feedback === 'not-helpful') {
          conversations[log.conversationId].feedbackCount.notHelpful++;
        }
      }
    });
    
    // Convert to array and sort by last message time
    const conversationList = Object.values(conversations)
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    
    res.json({
      total: conversationList.length,
      conversations: conversationList
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🦷 Dental Chatbot Backend running on port ${PORT}`);
  console.log(`📍 API available at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await SessionManager.shutdown();
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  await SessionManager.shutdown();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

